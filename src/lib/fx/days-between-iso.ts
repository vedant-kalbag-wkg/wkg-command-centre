/**
 * Phase 9.1 gap closure (CR-04) — pure calendar-day arithmetic over ISO date
 * strings. Replaces the `Math.floor((Date.parse(a) - Date.parse(b)) / 86_400_000)`
 * pattern in rate-lookup.ts and scripts/backfill-net-amount-gbp.ts.
 *
 * `Date.parse("YYYY-MM-DD")` returns UTC midnight in V8, so the arithmetic
 * happens to produce the right calendar-day delta today even across UK DST
 * transitions. The risk is a future change feeding inputs through a localised
 * Date intermediate — `new Date(yyyy, mm-1, dd)` is local-zone — which would
 * produce 23h or 25h boundary cases that miscompare against `> 7`. Going pure-
 * string + Date.UTC eliminates the footgun entirely.
 *
 * Both inputs MUST be `YYYY-MM-DD` (zero-padded, no time component, no zone
 * suffix). Throws on malformed input naming the value.
 *
 * @param isoFrom ISO YYYY-MM-DD start date.
 * @param isoTo ISO YYYY-MM-DD end date.
 * @returns Signed integer day delta `isoTo - isoFrom`. Callers MUST pass
 *   `isoFrom <= isoTo` if they expect a non-negative result; the function
 *   does not assert ordering because every current call site (rate-lookup,
 *   backfill) enforces it via the upstream SQL `lte` predicate. A reversed
 *   pair returns a negative integer rather than throwing — interpret the
 *   sign at the call site.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function daysBetweenIso(isoFrom: string, isoTo: string): number {
  if (!ISO_DATE_RE.test(isoFrom)) {
    throw new Error("Invalid ISO date: " + JSON.stringify(isoFrom));
  }
  if (!ISO_DATE_RE.test(isoTo)) {
    throw new Error("Invalid ISO date: " + JSON.stringify(isoTo));
  }
  const [yFrom, mFrom, dFrom] = isoFrom.split("-").map(Number);
  const [yTo, mTo, dTo] = isoTo.split("-").map(Number);
  const a = Date.UTC(yFrom, mFrom - 1, dFrom);
  const b = Date.UTC(yTo, mTo - 1, dTo);
  return Math.floor((b - a) / 86_400_000);
}
