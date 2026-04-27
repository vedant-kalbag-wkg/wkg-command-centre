import { dateToBucket, type Granularity } from "@/lib/analytics/formatters";
import type { SeriesConfig, TrendDataPoint } from "@/lib/analytics/types";

export type MergedRow = { date: string; [seriesId: string]: string | number };

/**
 * Bucket per-series daily data points into the requested granularity.
 *
 * Additive metrics (`revenue`, `transactions`, `booking_fee`) are SUM-ed
 * within each bucket. `avg_basket_value` cannot be summed — it is a ratio,
 * so we accumulate the per-day numerator (non-fee revenue) and denominator
 * (sales-txn count) separately and emit `numerator / denominator` per
 * bucket. This produces the correct weighted weekly/monthly mean (Task 2.7).
 *
 * Pre-fix behaviour: weekly avg_basket of three daily means £10/£20/£30
 * came out as £60. Post-fix: it is the volume-weighted mean of the three
 * days, e.g. (100 + 200 + 600) / (10 + 10 + 20) = £22.50.
 */
export function mergeSeriesData(
  allData: Map<string, TrendDataPoint[]>,
  appliedSeries: SeriesConfig[],
  granularity: Granularity,
): MergedRow[] {
  const dateMap = new Map<string, MergedRow>();
  // Parallel accumulators for weighted-average series, keyed by `${bucket}|${seriesId}`.
  const numerators = new Map<string, number>();
  const denominators = new Map<string, number>();

  for (const series of appliedSeries) {
    const isWeighted = series.metric === "avg_basket_value";
    const points = allData.get(series.id) ?? [];

    for (const pt of points) {
      const bucket = dateToBucket(pt.date, granularity);
      if (!dateMap.has(bucket)) {
        dateMap.set(bucket, { date: bucket });
      }
      const row = dateMap.get(bucket)!;

      if (isWeighted) {
        const key = `${bucket}|${series.id}`;
        // If the upstream point is missing num/denom (defensive — shouldn't
        // happen for avg_basket_value coming from getTrendSeriesData), fall
        // back to a pseudo-weighting that uses the value as both num and a
        // unit denom so the bucket still produces a plain mean.
        const num = pt.numerator ?? pt.value;
        const denom = pt.denominator ?? (pt.numerator !== undefined ? 0 : 1);
        numerators.set(key, (numerators.get(key) ?? 0) + num);
        denominators.set(key, (denominators.get(key) ?? 0) + denom);
        const totalDenom = denominators.get(key)!;
        row[series.id] = totalDenom > 0 ? numerators.get(key)! / totalDenom : 0;
      } else {
        const existing = (row[series.id] as number | undefined) ?? 0;
        row[series.id] = existing + pt.value;
      }
    }
  }

  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
