import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  buildNonReversalCondition,
  buildSalesTxnCondition,
  buildCancellationCondition,
  buildPartialReversalCondition,
  buildOrphanReversalCondition,
  buildNonFeeCondition,
  pickRevenueDisplay,
} from "./shared";

// Drizzle SQL fragments aren't string-comparable directly; serialise via the
// query builder so tests can assert the rendered predicate. Connection string
// is unused — toSQL() never opens the socket.
const fakeDb = drizzle("postgres://noop");

function render(fragment: ReturnType<typeof buildNonReversalCondition>): string {
  return fakeDb.select({ v: sql`1` }).from(sql`sales_records`).where(fragment).toSQL().sql;
}

describe("reversal helpers (shared.ts)", () => {
  it("buildNonReversalCondition: is_reversal = false", () => {
    const sqlText = render(buildNonReversalCondition());
    expect(sqlText).toContain('"sales_records"."is_reversal" = false');
  });

  it("buildSalesTxnCondition: combines non-fee and non-reversal", () => {
    const sqlText = render(buildSalesTxnCondition());
    // Non-fee branch is a single column check post-D10.
    expect(sqlText).toContain('"sales_records"."is_weknow_fee" = false');
    // Reversal branch.
    expect(sqlText).toContain('"sales_records"."is_reversal" = false');
    // The two branches are AND-joined.
    expect(sqlText).toMatch(/AND/);
  });

  it("buildCancellationCondition: is_reversal AND NOT is_partial_reversal AND original_record_id NOT NULL", () => {
    const sqlText = render(buildCancellationCondition());
    expect(sqlText).toContain('"sales_records"."is_reversal" = true');
    expect(sqlText).toContain('"sales_records"."is_partial_reversal" = false');
    expect(sqlText).toContain('"sales_records"."original_record_id" IS NOT NULL');
  });

  it("buildPartialReversalCondition: is_reversal AND is_partial_reversal AND original_record_id NOT NULL", () => {
    const sqlText = render(buildPartialReversalCondition());
    expect(sqlText).toContain('"sales_records"."is_reversal" = true');
    expect(sqlText).toContain('"sales_records"."is_partial_reversal" = true');
    expect(sqlText).toContain('"sales_records"."original_record_id" IS NOT NULL');
  });

  it("buildOrphanReversalCondition: is_reversal AND original_record_id IS NULL", () => {
    const sqlText = render(buildOrphanReversalCondition());
    expect(sqlText).toContain('"sales_records"."is_reversal" = true');
    expect(sqlText).toContain('"sales_records"."original_record_id" IS NULL');
  });

  it("buildNonFeeCondition: single-column predicate post-D10", () => {
    const sqlText = render(buildNonFeeCondition());
    expect(sqlText).toContain('"sales_records"."is_weknow_fee" = false');
  });
});

// Phase 9.1 / FX-03 — D-10 dispatch helper. Consumers (renderer in plan
// 09.1-07) call this once per row to pick which side of the dual-emit shape
// to render. Single-currency cohort → native; multi-currency cohort → GBP.
describe("pickRevenueDisplay (D-10 dispatch)", () => {
  it("single-currency cohort: returns native value + currency_key", () => {
    const out = pickRevenueDisplay({
      revenue_native: "1234.56",
      revenue_gbp: "987.65",
      currency_key: "EUR",
    });
    expect(out).toEqual({ value: 1234.56, currency: "EUR" });
  });

  it("multi-currency cohort: returns GBP value + 'GBP'", () => {
    const out = pickRevenueDisplay({
      revenue_native: "0",
      revenue_gbp: "5000.00",
      currency_key: null,
    });
    expect(out).toEqual({ value: 5000, currency: "GBP" });
  });

  it("coerces string-shaped numerics to JS numbers (Postgres numeric → text)", () => {
    const out = pickRevenueDisplay({
      revenue_native: "12.345",
      revenue_gbp: "10.000",
      currency_key: "USD",
    });
    expect(out.value).toBeCloseTo(12.345, 3);
    expect(out.currency).toBe("USD");
  });
});
