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
    // Non-fee branch uses isBookingFee + the netsuite_code IN list (until 1.3).
    expect(sqlText).toContain('"sales_records"."is_booking_fee" = true');
    expect(sqlText).toContain("'9991'");
    expect(sqlText).toContain("'9992'");
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

  it("buildNonFeeCondition: still references is_booking_fee + netsuite_code", () => {
    const sqlText = render(buildNonFeeCondition());
    expect(sqlText).toContain('"sales_records"."is_booking_fee"');
    expect(sqlText).toContain("'9991'");
    expect(sqlText).toContain("'9992'");
  });
});
