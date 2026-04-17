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
    return { ...point, value: Math.round(avg * 100) / 100 };
  });
}
