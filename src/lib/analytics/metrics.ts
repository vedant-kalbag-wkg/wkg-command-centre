import { toLocalISODate } from "@/lib/analytics/formatters";
import type { OutletTier } from "@/lib/analytics/types";

// ─── Period Change ────────────────────────────────────────────────────────────

export function calculatePeriodChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// ─── Previous Period Dates ────────────────────────────────────────────────────

export function getPreviousPeriodDates(
  dateFrom: string,
  dateTo: string,
): { prevFrom: string; prevTo: string } {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const durationMs = to.getTime() - from.getTime() + 24 * 60 * 60 * 1000;
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - durationMs + 24 * 60 * 60 * 1000);
  return {
    prevFrom: toLocalISODate(prevFrom),
    prevTo: toLocalISODate(prevTo),
  };
}

// ─── Comparison Dates ────────────────────────────────────────────────────────

export function getComparisonDates(
  dateFrom: string,
  dateTo: string,
  mode: "mom" | "yoy",
): { prevFrom: string; prevTo: string } {
  if (mode === "yoy") {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    from.setFullYear(from.getFullYear() - 1);
    to.setFullYear(to.getFullYear() - 1);
    return {
      prevFrom: from.toISOString().split("T")[0],
      prevTo: to.toISOString().split("T")[0],
    };
  }
  return getPreviousPeriodDates(dateFrom, dateTo);
}

// ─── Composite Score ──────────────────────────────────────────────────────────

type WeightedMetric = {
  value: number | null;
  weight: number;
};

export function calculateCompositeScore(metrics: WeightedMetric[]): number {
  const available = metrics.filter((m) => m.value !== null) as Array<{
    value: number;
    weight: number;
  }>;
  if (available.length === 0) return 0;
  const totalAvailableWeight = available.reduce((sum, m) => sum + m.weight, 0);
  if (totalAvailableWeight === 0) return 0;
  return available.reduce((score, m) => {
    const adjustedWeight = m.weight / totalAvailableWeight;
    return score + m.value * adjustedWeight;
  }, 0);
}

// ─── Capacity Metrics ─────────────────────────────────────────────────────────

export function calculateRevenuePerRoom(
  revenue: number,
  rooms: number | null,
): number | null {
  if (!rooms || rooms === 0) return null;
  return revenue / rooms;
}

export function calculateTxnPerKiosk(
  transactions: number,
  kiosks: number | null,
): number | null {
  if (!kiosks || kiosks === 0) return null;
  return transactions / kiosks;
}

export function calculateAvgBasketValue(
  revenue: number,
  transactions: number,
): number | null {
  if (transactions === 0) return null;
  return revenue / transactions;
}

// ─── Outlet Tier Classification ───────────────────────────────────────────────

export function classifyOutletTier(percentile: number): OutletTier {
  if (percentile >= 80) return "Premium";
  if (percentile >= 50) return "Standard";
  if (percentile >= 20) return "Developing";
  return "Emerging";
}

// ─── Percentile Rank ──────────────────────────────────────────────────────────

export function calculatePercentile(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0;
  const rank = allValues.filter((v) => v <= value).length;
  return (rank / allValues.length) * 100;
}
