import { toLocalISODate } from "@/lib/analytics/formatters";
import type { OutletTier } from "@/lib/analytics/types";
import type { OutletTierConfig } from "@/lib/analytics/thresholds";

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
    return {
      prevFrom: shiftYearISO(dateFrom, -1),
      prevTo: shiftYearISO(dateTo, -1),
    };
  }
  return getPreviousPeriodDates(dateFrom, dateTo);
}

// Task 2.11 — Feb 29 + setFullYear rolls over to Mar 1 in non-leap years
// (e.g. 2024-02-29 → 2023-03-01). Clamp the day to the target month's length
// so YoY comparison lands on Feb 28 in non-leap years.
function shiftYearISO(iso: string, deltaYears: number): string {
  const d = new Date(iso);
  const targetYear = d.getUTCFullYear() + deltaYears;
  const targetMonth = d.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(d.getUTCDate(), lastDayOfTargetMonth);
  return `${targetYear.toString().padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
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
//
// Phase 6 plan 06-05 — config-driven cutoffs. Caller injects the loaded
// `OutletTierConfig` (defaults 80/50/20) so the thresholds can be edited from
// `/settings/thresholds` without a redeploy. Defaults preserved here as a
// belt-and-braces fallback — the form layer enforces `top > mid > bottom`.

export function classifyOutletTier(
  percentile: number,
  config: OutletTierConfig,
): OutletTier {
  if (percentile >= config.top) return "Premium";
  if (percentile >= config.mid) return "Standard";
  if (percentile >= config.bottom) return "Developing";
  return "Emerging";
}

// ─── Percentile Rank ──────────────────────────────────────────────────────────

export function calculatePercentile(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 0;
  const rank = allValues.filter((v) => v <= value).length;
  return (rank / allValues.length) * 100;
}
