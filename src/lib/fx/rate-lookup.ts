/**
 * Carry-forward GBP rate lookup for `(currency, isoDate)`.
 *
 * Implements:
 * - D-04: GBP returns the identity { rate: 1.0, ..., staleDays: 0 } WITHOUT
 *   touching the database. The Wave 0 unit test (`rate-lookup.test.ts:117-121`)
 *   asserts this via a `dbCallCount` counter on the `vi.mock("@/db")` chain —
 *   the GBP-majority backfill cannot afford a DB roundtrip per row.
 * - D-05: most-recent `rate_date <= isoDate` (carry-forward across BoE
 *   weekend / UK bank-holiday gaps).
 * - D-07 substrate: returns `staleDays` so the *caller* (Azure ETL) can
 *   enforce the 7-day ceiling and emit `fx_rate_stale`. The lookup itself
 *   does NOT throw — that policy lives at the call site (RESEARCH §"Pitfall 3").
 * - D-03 substrate: returns `null` when no rate row exists at-or-before
 *   `isoDate`. The caller (sales ETL) hard-fails on `null` — no silent GBP
 *   fallback.
 *
 * Pure-function shape: no global state, no caching, no side effects beyond
 * the single drizzle SELECT.
 */

import { and, desc, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { exchangeRates } from "@/db/schema";

export type RateLookupResult = {
  rate: number;
  rateDate: string;
  staleDays: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Look up the GBP rate for `currency` on `isoDate`.
 *
 * @param currency ISO 4217 code (must be a member of
 *   {@link import("./currencies").BOE_SUPPORTED_CURRENCIES} for non-null
 *   results outside GBP — this function does not validate, the caller does).
 * @param isoDate `YYYY-MM-DD` (the row's `transaction_date` for ETL stamping).
 * @returns
 *   - GBP: `{ rate: 1.0, rateDate: isoDate, staleDays: 0 }` without DB call (D-04).
 *   - Non-GBP, rate found: `{ rate, rateDate, staleDays }` where `staleDays`
 *     is `floor((isoDate - rateDate) / 1d)` — caller hard-fails on `> 7` per D-07.
 *   - Non-GBP, no rate at-or-before `isoDate`: `null` — caller hard-fails per D-03.
 */
export async function getRateForDate(
  currency: string,
  isoDate: string,
): Promise<RateLookupResult | null> {
  if (currency === "GBP") {
    return { rate: 1.0, rateDate: isoDate, staleDays: 0 };
  }

  // Plain `.select()` (no projection map) returns all columns under their
  // drizzle property names — `rateToGbp`, `rateDate`, etc. Avoids a column-
  // aliasing mismatch with the unit-test mock (which returns SEED rows
  // verbatim) while remaining a single carry-forward query in production.
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.rateDate, isoDate)))
    .orderBy(desc(exchangeRates.rateDate))
    .limit(1);

  if (!row) return null;

  // Defensive: the unit-test mock filter is a no-op (it returns the seed
  // verbatim regardless of the WHERE clause), so we re-check the
  // rate_date <= isoDate invariant in JS. In production this is a no-op too
  // because the SQL `lte` already enforced it; the cost is one string compare.
  if (row.rateDate > isoDate) return null;

  const staleDays = Math.floor((Date.parse(isoDate) - Date.parse(row.rateDate)) / MS_PER_DAY);

  return {
    rate: Number(row.rateToGbp),
    rateDate: row.rateDate,
    staleDays,
  };
}
