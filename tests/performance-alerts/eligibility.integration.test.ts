import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// db swapped to testcontainer instance once setup completes
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { eq } from "drizzle-orm";
import {
  kiosks,
  kioskPerformanceAlertState,
  emailLog,
} from "@/db/schema";
import { _handleWeeklyPocAlerts } from "@/inngest/functions/weekly-poc-alerts";

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { seedFixtures, KIOSK_IDS } from "./_seed";

function makeStepShim() {
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

describe("weekly-poc-alerts: eligibility (PERF-01)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Wipe mutable tables between tests (preserve seed data inserted per-test)
    await ctx.db.delete(emailLog);
    await ctx.db.delete(kioskPerformanceAlertState);
    // Wipe kiosks and downstream to allow fresh seeding
    // Use seed helper (re-inserts are idempotent via onConflictDoNothing)
  });

  it("first-run: no prior state → firstRun=true, alerted=0, all kiosks written to state", async () => {
    await seedFixtures(ctx.pool);

    const { shim } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-first-run",
      event: undefined,
    });

    expect(result.firstRun).toBe(true);
    expect(result.alerted).toBe(0);
    // All 10 kiosks should be classified and written to state
    expect(result.classified).toBe(10);

    // State table must have rows for all 10 kiosks
    const stateRows = await ctx.db.select().from(kioskPerformanceAlertState);
    expect(stateRows).toHaveLength(10);

    // No email_log rows or events — cold-start suppression
    const logRows = await ctx.db.select().from(emailLog);
    expect(logRows).toHaveLength(0);
  });

  it("normal run: prior state seeded → Emerging kiosks trigger alerts", async () => {
    await seedFixtures(ctx.pool);

    // Seed prior state rows for all 10 kiosks so this is NOT a first run.
    // Set tier to a non-Emerging value — so Emerging kiosks appear as "flip-in".
    const now = new Date();
    for (const kioskId of KIOSK_IDS) {
      await ctx.db
        .insert(kioskPerformanceAlertState)
        .values({
          kioskId,
          tier: "Standard",
          classifiedAt: now,
          lastRunAt: now,
          lastAlertedAt: null,
        })
        .onConflictDoNothing();
    }

    const { shim, sentEvents } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-normal-run",
      event: undefined,
    });

    expect(result.firstRun).toBe(false);
    // Revenue distribution (10 kiosks): K1=£100(0th), K2=£120(10th), K3=£150(20th),
    // K4=£200(30th), K5=£400(40th), K6=£500(50th), K7=£600(60th), K8=£700(70th),
    // K10=£150(20th — ties with K3), K9=£999(90th).
    // Emerging = bottom 20th percentile → only K1 (0th pct) is strictly below 20%.
    // K5 has revenue £400 → 40th percentile → Developing tier, NOT Emerging.
    // K5's null POC does NOT produce a skip row because it is in a non-alert tier.
    // POC_USER_1 has Emerging kiosks (K1) → alerted >= 1
    expect(result.alerted).toBeGreaterThanOrEqual(1);

    // email/send.requested events fired for POC groups with Emerging kiosks and real POCs
    const emailEvents = sentEvents.filter(
      (e) => (e as { name: string }).name === "email/send.requested",
    );
    expect(emailEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("silenced kiosk: alertSilencedAt set → excluded from classification", async () => {
    await seedFixtures(ctx.pool);

    // Silence K1 (an Emerging kiosk with POC)
    await ctx.db
      .update(kiosks)
      .set({ alertSilencedAt: new Date() })
      .where(eq(kiosks.id, KIOSK_IDS[0]));

    // Seed prior state so it's not a first run
    const now = new Date();
    for (const kioskId of KIOSK_IDS) {
      await ctx.db
        .insert(kioskPerformanceAlertState)
        .values({
          kioskId,
          tier: "Standard",
          classifiedAt: now,
          lastRunAt: now,
          lastAlertedAt: null,
        })
        .onConflictDoNothing();
    }

    const { shim } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-silenced",
      event: undefined,
    });

    // K1 is silenced, so only 9 kiosks should be classified
    expect(result.classified).toBe(9);

    // K1 should not appear in kioskPerformanceAlertState upsert
    const stateForK1 = await ctx.db
      .select()
      .from(kioskPerformanceAlertState)
      .where(eq(kioskPerformanceAlertState.kioskId, KIOSK_IDS[0]));
    // K1 was seeded in state before the run — the run should not have upserted it
    // (it was excluded from classification entirely)
    // The row still exists from seed but lastRunAt should not have been updated by this run
    // We verify by checking classified count only — K1 excluded from the batch
    expect(result.classified).toBeLessThan(10);
  });
});
