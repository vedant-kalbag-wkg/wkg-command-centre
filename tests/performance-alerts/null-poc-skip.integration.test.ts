import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// db swapped to testcontainer instance once setup completes
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { eq } from "drizzle-orm";
import { emailLog, locationPerformanceAlertState } from "@/db/schema";
import { _handleWeeklyPocAlerts } from "@/inngest/functions/weekly-poc-alerts";

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { seedFixtures, LOCATION_IDS } from "./_seed";

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

describe("weekly-poc-alerts: null POC skip path (PERF-02, hotel-level)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    await seedFixtures(ctx.pool);

    // Seed prior state rows so this is NOT a first run.
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
    await ctx.db.delete(emailLog);
  });

  it("H1 has internalPocId=null on locations → skip row written, no email event for H1", async () => {
    const { shim, sentEvents } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-null-poc",
      event: undefined,
    });

    expect(result.firstRun).toBe(false);

    // H1 has the lowest revenue (100) → composite=0 → Emerging tier →
    // included in alertable set → null POC → skip row written.
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const skipRows = await ctx.db
      .select()
      .from(emailLog)
      .where(eq(emailLog.recipient, "[skip:no-poc]"));

    expect(skipRows.length).toBeGreaterThanOrEqual(1);
    expect(skipRows[0].kind).toBe("underperforming_poc");
    expect(skipRows[0].status).toBe("skipped");
    expect(skipRows[0].payloadHash).toBeNull();

    // No email/send.requested event should reference H1 — it has no POC and
    // groupByPoc routes it into the null-POC bucket which the cron skips.
    const emailEventsForH1 = sentEvents.filter((e) => {
      const ev = e as {
        name: string;
        data?: {
          templateProps?: { hotels?: Array<{ locationId: string }> };
        };
      };
      if (ev.name !== "email/send.requested") return false;
      const hotelsInEmail = ev.data?.templateProps?.hotels ?? [];
      return hotelsInEmail.some((h) => h.locationId === LOCATION_IDS[0]);
    });
    expect(emailEventsForH1).toHaveLength(0);
  });
});
