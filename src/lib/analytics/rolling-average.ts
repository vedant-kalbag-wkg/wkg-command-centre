import type { TrendDataPoint } from "@/lib/analytics/types";

export type RollingWindow = 7 | 30 | null;

export function applyRollingAverage(
  data: TrendDataPoint[],
  windowSize: number,
): TrendDataPoint[] {
  if (data.length === 0) return data;

  // Sort by date ascending
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((point, i) => {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = sorted.slice(windowStart, i + 1);
    const avg = window.reduce((sum, p) => sum + p.value, 0) / window.length;
    const out: TrendDataPoint = {
      ...point,
      value: Math.round(avg * 100) / 100,
    };
    // For avg_basket_value points the numerator/denominator participate in
    // weighted bucketing downstream (Task 2.7). Keep them in lockstep with
    // `value` by averaging them across the same window — otherwise the
    // weighted bucket re-derives a non-rolling mean and the rolling-avg
    // toggle silently no-ops on avg_basket_value series.
    if (point.numerator !== undefined && point.denominator !== undefined) {
      const numAvg =
        window.reduce((sum, p) => sum + (p.numerator ?? 0), 0) / window.length;
      const denomAvg =
        window.reduce((sum, p) => sum + (p.denominator ?? 0), 0) /
        window.length;
      out.numerator = numAvg;
      out.denominator = denomAvg;
    }
    return out;
  });
}
