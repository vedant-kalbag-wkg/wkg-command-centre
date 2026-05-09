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
  locations,
  locationPerformanceAlertState,
  emailLog,
} from "@/db/schema";
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

describe("weekly-poc-alerts: eligibility (PERF-01, hotel-level)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Wipe mutable tables between tests; seed is idempotent via onConflictDoNothing
    await ctx.db.delete(emailLog);
    await ctx.db.delete(locationPerformanceAlertState);
  });

  it("first-run: no prior state → firstRun=true, alerted=0, all hotels written to state", async () => {
    await seedFixtures(ctx.pool);

    const { shim } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-first-run",
      event: undefined,
    });

    expect(result.firstRun).toBe(true);
    expect(result.alerted).toBe(0);
    // All 10 hotels classified and written to state
    expect(result.classified).toBe(10);

    const stateRows = await ctx.db.select().from(locationPerformanceAlertState);
    expect(stateRows).toHaveLength(10);

    // No email_log rows or events — cold-start suppression
    const logRows = await ctx.db.select().from(emailLog);
    expect(logRows).toHaveLength(0);
  });

  it("normal run: prior state seeded → Emerging hotels trigger alerts", async () => {
    await seedFixtures(ctx.pool);

    // Seed prior state for all 10 hotels with a non-Emerging tier so this is
    // NOT a first run AND the Emerging-flip-in path fires for hotels that
    // classify into Emerging on this run.
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

    const { shim, sentEvents } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-normal-run",
      event: undefined,
    });

    expect(result.firstRun).toBe(false);
    // Composite-score distribution (revenue dominates, txn/kiosk-count
    // collapse to 0): hotels H1–H3 land in Emerging (composite < 20).
    // H1 has POC=null → skip row; H2/H3 have a real POC → at least one alert.
    expect(result.alerted).toBeGreaterThanOrEqual(1);

    const emailEvents = sentEvents.filter(
      (e) => (e as { name: string }).name === "email/send.requested",
    );
    expect(emailEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("silenced location: alertSilencedAt set → excluded from classification", async () => {
    await seedFixtures(ctx.pool);

    // Silence H1 (an Emerging hotel)
    await ctx.db
      .update(locations)
      .set({ alertSilencedAt: new Date() })
      .where(eq(locations.id, LOCATION_IDS[0]));

    // Seed prior state for the remaining hotels so this is not a first run.
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

    const { shim } = makeStepShim();
    const result = await _handleWeeklyPocAlerts({
      step: shim,
      runId: "test-silenced",
      event: undefined,
    });

    // H1 is silenced → only 9 hotels in the eligible cohort.
    expect(result.classified).toBe(9);
    expect(result.classified).toBeLessThan(10);

    // Reset to leave the table clean for the next test (silenced hotel
    // would otherwise leak into the next describe block via beforeEach,
    // which only wipes state — not locations.alertSilencedAt).
    await ctx.db
      .update(locations)
      .set({ alertSilencedAt: null })
      .where(eq(locations.id, LOCATION_IDS[0]));
  });
});
