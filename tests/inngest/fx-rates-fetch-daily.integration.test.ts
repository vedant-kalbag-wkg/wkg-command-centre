// Phase 9.1 Plan 09.1-01 Task 3 / Plan 09.1-04 — integration test for the
// daily BoE fetch cron. Drives FX-01 (D-02 idempotent upsert + D-06/D-08
// fetch-failed alert + audit-log writeback). Plan 09.1-04 turned RED → GREEN
// and moved this file from src/inngest/functions/ to tests/inngest/ (option
// (a) per the original RED-stage header) so the integration project's
// `tests/**/*.integration.test.ts` glob picks it up.
//
// Analog: tests/admin/performance-alerts.integration.test.ts — same
// vi.hoisted / vi.mock("@/inngest/client") + vi.mock("@/db") + Testcontainers
// shape. The Testcontainers spin-up takes ~15s on first run; vitest config
// allots 180s hookTimeout for the integration project.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vi.hoisted — must run before SUT imports `@/inngest/client` at module scope.
// `createFunction` is stubbed with a no-op (returns the config it was given) so
// the SUT's top-level `inngest.createFunction(...)` registration call doesn't
// crash; we don't exercise the registered function here, only the extracted
// handler `_handleFxRatesFetchDaily`.
const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: inngestSendMock,
    createFunction: (config: unknown, _handler: unknown) => config,
  },
}));

// db is real (Testcontainers). Bind via getter so beforeAll can wire ctx.db
// after vi.mock has registered.
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// SUT — Plan 09.1-04 ships `src/inngest/functions/fx-rates-fetch-daily.ts`.
import { _handleFxRatesFetchDaily } from "@/inngest/functions/fx-rates-fetch-daily";

// `exchangeRates` is added in Wave 1 plan 09.1-02 migration 0046+.
import { exchangeRates } from "@/db/schema";

const FIXTURE_CSV = readFileSync(
  join(__dirname, "../../src/lib/fx/__fixtures__/boe-2026-05-07.csv"),
  "utf8",
);

// Minimal step-shim: `step.run(name, fn)` immediately invokes `fn()`; the
// real Inngest SDK memoises across retries, but for unit-of-cron we just
// want to drive the handler body once. `sendEvent` is wired to the same
// `inngestSendMock` so D-06/D-08 fan-out assertions land on a single recorder
// regardless of whether the SUT routes via `inngest.send` or `step.sendEvent`
// (the SUT's correct path is the latter, mirroring weekly-poc-alerts).
const stepShim = {
  run: async <T,>(_name: string, fn: () => Promise<T>) => fn(),
  sendEvent: async (id: string, events: unknown[]) => {
    // Spread each event into its own recorder call so
    // `expect(inngestSendMock).toHaveBeenCalledOnce()` matches the
    // single-event fan-out the SUT performs.
    for (const evt of events) inngestSendMock(evt);
    return { ids: events.map((_, i) => `${id}:${i}`) };
  },
};

describe("fx-rates-fetch-daily integration (Wave 0 RED scaffolding)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    inngestSendMock.mockReset();
    inngestSendMock.mockResolvedValue({ ids: [] });
    // Clear exchange_rates between tests so idempotency assertions start
    // from a known empty state.
    await ctx.db.execute(sql`TRUNCATE TABLE exchange_rates`);
  });

  // Each test mocks `fetch` via `mockImplementation` so a fresh Response (with
  // an unconsumed body) is returned per call. `mockResolvedValue` reuses a
  // single Response instance, and `Response.text()` consumes the body, which
  // breaks the second handler call in the idempotency test with
  // `Body is unusable: Body has already been read`.
  it("D-02: upserts >= 6 rows from the fixture CSV (one per series code)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(FIXTURE_CSV, { status: 200, headers: { "content-type": "text/csv" } }) as never,
    );
    const result = await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-1" });
    expect(result.upserted).toBeGreaterThanOrEqual(6);

    const rows = await ctx.db.select().from(exchangeRates);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("D-02 idempotency: re-running the same handler against the same fixture is a no-op (ON CONFLICT DO NOTHING)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(FIXTURE_CSV, { status: 200 }) as never,
    );
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-2a" });
    const firstCount = (await ctx.db.select().from(exchangeRates)).length;
    expect(firstCount).toBeGreaterThanOrEqual(6);

    // Re-run — same fixture, same (currency, rate_date) keys.
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-2b" });
    const secondCount = (await ctx.db.select().from(exchangeRates)).length;
    expect(secondCount).toBe(firstCount);
  });

  it("D-06/D-08: when fetch throws, emits a fx_rate_fetch_failed fan-out exactly once", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("BoE outage"));
    await expect(
      _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-3" }),
    ).rejects.toThrow();

    // Even on failure, the handler must emit exactly one fx_rate_fetch_failed
    // event so the operator gets an email. The event name follows Phase 8's
    // "email/send.requested" wire-shape (src/inngest/events.ts). The SUT
    // routes via `step.sendEvent` (mirroring weekly-poc-alerts.ts:280-297);
    // the step-shim above forwards each event to `inngestSendMock`.
    expect(inngestSendMock).toHaveBeenCalledOnce();
    const evt = inngestSendMock.mock.calls[0][0] as {
      name: string;
      data: { kind: string };
    };
    expect(evt.name).toBe("email/send.requested");
    expect(evt.data.kind).toBe("fx_rate_fetch_failed");
  });

  it("audit-log writeback: a row is written with entityType='fx_rate_fetch_run' for every run (success or failure)", async () => {
    // Mirrors the weekly-poc-alerts pattern (entityType='performance_alert_run').
    // Operators read the run history off audit_logs.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(FIXTURE_CSV, { status: 200 }) as never,
    );
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-4" });

    const rows = await ctx.db.execute(
      sql`SELECT entity_type, action FROM audit_logs WHERE entity_type = 'fx_rate_fetch_run'`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
  });
});
