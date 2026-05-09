// Phase 9.1 Plan 09.1-01 Task 3 — RED-stage integration test for the
// daily BoE fetch cron. Drives FX-01 (D-02 idempotent upsert + D-06/D-08
// fetch-failed alert + audit-log writeback). Wave 2 plan 09.1-04 ships
// `src/inngest/functions/fx-rates-fetch-daily.ts` and turns these GREEN.
//
// Analog: tests/admin/performance-alerts.integration.test.ts — same
// vi.hoisted/vi.mock("@/inngest/client") + vi.mock("@/db") + Testcontainers
// shape. The Testcontainers spin-up takes ~15s on first run; vitest config
// allots 180s hookTimeout for the integration project.
//
// Vitest project routing (Wave 2 follow-up): `vitest.config.ts` integration
// project includes `tests/**/*.integration.test.ts`. This file's path
// (`src/inngest/functions/fx-rates-fetch-daily.test.ts`) was specified by
// `09.1-01-PLAN.md` Task 3 `<files>`. Wave 2 plan 09.1-04 must EITHER:
//   (a) move this file to `tests/inngest/fx-rates-fetch-daily.integration.test.ts`
//       (preferred — matches existing glob), OR
//   (b) extend `vitest.config.ts` integration include to cover
//       `src/**/*.integration.test.ts`.
// Without one of those, `--project integration` will skip the file. The
// RED state is still observable today via `npx vitest run --project unit
// src/inngest/functions/fx-rates-fetch-daily.test.ts` because the failing
// import (`./fx-rates-fetch-daily` does not exist) surfaces before any
// project-specific setup.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vi.hoisted — must run before SUT imports `@/inngest/client` at module scope.
const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSendMock },
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
import { setupTestDb, teardownTestDb, type TestDbContext } from "../../../tests/helpers/test-db";

// SUT — does not exist yet (Wave 2 plan 09.1-04). Module-not-found is the
// RED gate.
import { _handleFxRatesFetchDaily } from "./fx-rates-fetch-daily";

// `exchangeRates` is added in Wave 1 plan 09.1-02 migration 0046+. Until
// then this import additionally fails — the RED gate is layered.
import { exchangeRates } from "@/db/schema";

const FIXTURE_CSV = readFileSync(
  join(__dirname, "../../lib/fx/__fixtures__/boe-2026-05-07.csv"),
  "utf8",
);

// Minimal step-shim: `step.run(name, fn)` immediately invokes `fn()`. The
// real Inngest SDK memoises across retries, but for unit-of-cron we just
// want to drive the handler body once.
const stepShim = {
  run: async <T,>(_name: string, fn: () => Promise<T>) => fn(),
  sendEvent: async (_id: string, _events: unknown[]) => ({ ids: [] }),
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

  it("D-02: upserts >= 6 rows from the fixture CSV (one per series code)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(FIXTURE_CSV, { status: 200, headers: { "content-type": "text/csv" } }) as never,
    );
    const result = await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-1" });
    expect(result.upserted).toBeGreaterThanOrEqual(6);

    const rows = await ctx.db.select().from(exchangeRates);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("D-02 idempotency: re-running the same handler against the same fixture is a no-op (ON CONFLICT DO NOTHING)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(FIXTURE_CSV, { status: 200 }) as never,
    );
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-2a" });
    const firstCount = (await ctx.db.select().from(exchangeRates)).length;
    expect(firstCount).toBeGreaterThanOrEqual(6);

    // Re-run — same fixture, same (currency, rate_date) keys.
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-2b" });
    const secondCount = (await ctx.db.select().from(exchangeRates)).length;
    expect(secondCount).toBe(firstCount);
  });

  it("D-06/D-08: when fetch throws, emits inngest.send with kind=fx_rate_fetch_failed exactly once", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("BoE outage"));
    await expect(
      _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-3" }),
    ).rejects.toThrow();

    // Even on failure, the handler must emit exactly one fx_rate_fetch_failed
    // event so the operator gets an email. The event name follows Phase 8's
    // "email/send.requested" wire-shape (src/inngest/events.ts).
    expect(inngestSendMock).toHaveBeenCalledOnce();
    const [evt] = inngestSendMock.mock.calls[0];
    expect(evt.name).toBe("email/send.requested");
    expect(evt.data.kind).toBe("fx_rate_fetch_failed");
  });

  it("audit-log writeback: a row is written with entityType='fx_rate_fetch_run' for every run (success or failure)", async () => {
    // Mirrors the weekly-poc-alerts pattern (entityType='performance_alert_run').
    // Operators read the run history off audit_logs.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(FIXTURE_CSV, { status: 200 }) as never,
    );
    await _handleFxRatesFetchDaily({ step: stepShim, runId: "test-run-4" });

    const rows = await ctx.db.execute(
      sql`SELECT entity_type, action FROM audit_logs WHERE entity_type = 'fx_rate_fetch_run'`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
  });
});
