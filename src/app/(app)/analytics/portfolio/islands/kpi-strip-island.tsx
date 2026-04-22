import { StatCard } from "@/components/analytics/stat-card";
import { getPortfolioSummaryCached } from "@/lib/analytics/queries/portfolio";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import {
  calculatePeriodChange,
  getComparisonDates,
} from "@/lib/analytics/metrics";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";
import type { ComparisonMode } from "@/lib/analytics/types";

type Delta = { value: number; direction: "up" | "down" | "flat"; label?: string };

function toDelta(
  current: number,
  previous: number | undefined,
  label: string,
): Delta | undefined {
  if (previous === undefined) return undefined;
  const pct = calculatePeriodChange(current, previous);
  if (pct === null) return undefined;
  const rounded = Math.round(pct * 10) / 10;
  const direction: Delta["direction"] =
    rounded > 0.1 ? "up" : rounded < -0.1 ? "down" : "flat";
  return { value: rounded, direction, label };
}

interface KpiStripIslandProps {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
  comparisonMode: ComparisonMode;
}

export async function KpiStripIsland({
  canonical,
  scopeKey,
  comparisonMode,
}: KpiStripIslandProps) {
  if (canonical.dateFrom === null || canonical.dateTo === null) {
    throw new Error("KpiStripIsland requires concrete dateFrom/dateTo");
  }

  const { prevFrom, prevTo } = getComparisonDates(
    canonical.dateFrom,
    canonical.dateTo,
    comparisonMode,
  );
  const previousCanonical = canonicaliseFilters({
    ...canonical,
    hotelIds: canonical.hotelIds,
    regionIds: canonical.regionIds,
    productIds: canonical.productIds,
    hotelGroupIds: canonical.hotelGroupIds,
    locationGroupIds: canonical.locationGroupIds,
    maturityBuckets: canonical.maturityBuckets,
    dateFrom: prevFrom,
    dateTo: prevTo,
  });

  const [summary, previousSummary] = await Promise.all([
    getPortfolioSummaryCached(canonical, scopeKey),
    getPortfolioSummaryCached(previousCanonical, scopeKey).catch((err) => {
      console.error('[portfolio] previousSummary failed:', err);
      return null;
    }),
  ]);

  const comparisonLabel =
    comparisonMode === "mom" ? "vs. prev." : "vs. prev. yr";
  const p = previousSummary ?? undefined;

  const kpis = [
    {
      label: "Revenue",
      value: formatCurrency(summary.totalRevenue),
      delta: toDelta(summary.totalRevenue, p?.totalRevenue, comparisonLabel),
    },
    {
      label: "Transactions",
      value: formatNumber(summary.totalTransactions),
      delta: toDelta(
        summary.totalTransactions,
        p?.totalTransactions,
        comparisonLabel,
      ),
    },
    {
      label: "Avg Basket",
      value: formatCurrency(summary.avgBasketValue),
      delta: toDelta(summary.avgBasketValue, p?.avgBasketValue, comparisonLabel),
    },
    {
      label: "Unique Outlets",
      value: formatNumber(summary.uniqueOutlets),
      delta: toDelta(summary.uniqueOutlets, p?.uniqueOutlets, comparisonLabel),
    },
    {
      label: "Unique Products",
      value: formatNumber(summary.uniqueProducts),
      delta: toDelta(summary.uniqueProducts, p?.uniqueProducts, comparisonLabel),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k) => (
        <StatCard key={k.label} label={k.label} value={k.value} delta={k.delta} />
      ))}
    </div>
  );
}
