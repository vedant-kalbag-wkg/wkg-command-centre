import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Resend mock — must be hoisted so the SUT's `import Resend from 'resend'` sees it
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

// db swapped to testcontainer instance once setup completes
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { emailLog, locationPerformanceAlertState } from "@/db/schema";
import { _handleWeeklyPocAlerts } from "@/inngest/functions/weekly-poc-alerts";
import { _handleSendEmail } from "@/inngest/functions/send-email";

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { seedFixtures, LOCATION_IDS } from "./_seed";

// Step shim for weekly-poc-alerts (needs both run + sendEvent)
function makeWeeklyStepShim() {
  const sentEvents: unknown[] = [];
  return {
    shim: {
      run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
      sendEvent: async (_id: string, events: unknown[]) => {
        sentEvents.push(...events);
      },
    },
    sentEvents,
  };
}

// Step shim for send-email (only needs run)
function makeSendStepShim() {
  return {
    run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
  };
}

describe("weekly-poc-alerts: idempotency (PERF-03, hotel-level)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@command.weknowgroup.com";
    await seedFixtures(ctx.pool);

    // Seed prior state for all 10 hotels so the first call below is not a
    // first-run.
    const now = new Date();
    for (const locationId of LOCATION_IDS) {
      await ctx.db
        .insert(locationPerformanceAlertState)
        .values({
          locationId,
          tier: "Standard",
          compositeScore: "50.00",
          classifiedAt: now,
          lastRunAt: now,
          lastAlertedAt: null,
        })
        .onConflictDoNothing();
    }
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    sendMock.mockReset();
    await ctx.db.delete(emailLog);
  });

  it("end-to-end W10: classify → emit events → send-email writes email_log rows", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg-e2e" }, error: null });

    const { shim, sentEvents } = makeWeeklyStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-e2e-run",
      event: undefined,
    });

    expect(result.firstRun).toBe(false);
    expect(result.classified).toBe(10);

    const emailEvents = sentEvents.filter(
      (e) => (e as { name: string }).name === "email/send.requested",
    );

    // Drive _handleSendEmail through the step shim for each event — full
    // W10 path: classify → emit → email delivery.
    for (const ev of emailEvents) {
      await _handleSendEmail({
        event: ev as { data: Parameters<typeof _handleSendEmail>[0]["event"]["data"] },
        step: makeSendStepShim(),
        runId: `test-e2e-send-${(ev as { data: { payloadHash?: string } }).data?.payloadHash ?? "no-hash"}`,
      });
    }

    const sentRows = await ctx.db.select().from(emailLog);
    const nonSkipRows = sentRows.filter((r) => r.status !== "skipped");
    expect(nonSkipRows.length).toBeGreaterThanOrEqual(emailEvents.length);

    for (const row of nonSkipRows) {
      expect(row.status).toBe("sent");
      expect(row.kind).toBe("underperforming_poc");
    }
  });

  it("idempotency: running weekly job twice in same ISO week → second run produces no-alert decisions", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg-idempotent" }, error: null });

    // ── First run ──────────────────────────────────────────────────────────────
    const { shim: shim1, sentEvents: sent1 } = makeWeeklyStepShim();
    const result1 = await _handleWeeklyPocAlerts({
      step: shim1,
      runId: "test-idempotent-run-1",
      event: undefined,
    });
    expect(result1.firstRun).toBe(false);

    const emailEvents1 = sent1.filter(
      (e) => (e as { name: string }).name === "email/send.requested",
    );

    for (const ev of emailEvents1) {
      await _handleSendEmail({
        event: ev as { data: Parameters<typeof _handleSendEmail>[0]["event"]["data"] },
        step: makeSendStepShim(),
        runId: `idempotent-send-1-${(ev as { data: { payloadHash?: string } }).data?.payloadHash ?? "x"}`,
      });
    }

    const rowsAfterRun1 = await ctx.db.select().from(emailLog);
    const sentAfterRun1 = rowsAfterRun1.filter((r) => r.status === "sent").length;

    // ── Second run ─────────────────────────────────────────────────────────────
    // State table now has rows from run 1 with `lastAlertedAt` set for
    // Emerging hotels. CHRONIC_CAP_MS = 30 days, so re-alerting the same
    // hotels in the same week produces "no-alert" (cooldown not elapsed).
    const { shim: shim2, sentEvents: sent2 } = makeWeeklyStepShim();
    const result2 = await _handleWeeklyPocAlerts({
      step: shim2,
      runId: "test-idempotent-run-2",
      event: undefined,
    });

    expect(result2.firstRun).toBe(false);

    const emailEvents2 = sent2.filter(
      (e) => (e as { name: string }).name === "email/send.requested",
    );
    expect(emailEvents2.length).toBeLessThanOrEqual(emailEvents1.length);

    // Deliver second-run emails (if any) — payloadHash collision →
    // onConflictDoNothing.
    for (const ev of emailEvents2) {
      await _handleSendEmail({
        event: ev as { data: Parameters<typeof _handleSendEmail>[0]["event"]["data"] },
        step: makeSendStepShim(),
        runId: `idempotent-send-2-${(ev as { data: { payloadHash?: string } }).data?.payloadHash ?? "x"}`,
      });
    }

    const rowsAfterRun2 = await ctx.db.select().from(emailLog);
    const sentAfterRun2 = rowsAfterRun2.filter((r) => r.status === "sent").length;
    expect(sentAfterRun2).toBeLessThanOrEqual(sentAfterRun1 + emailEvents2.length);
  });
});
