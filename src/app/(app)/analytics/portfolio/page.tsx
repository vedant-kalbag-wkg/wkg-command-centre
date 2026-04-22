import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DataIslandError } from "@/components/analytics/data-island-error";
import { parseAnalyticsFiltersFromSearchParams } from "@/lib/analytics/parse-filters-from-search-params";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import { fetchLocationFlags } from "@/app/(app)/analytics/flags/actions";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";
import type { ComparisonMode } from "@/lib/analytics/types";

import { KpiStripIsland } from "./islands/kpi-strip-island";
import { CategoryPerformanceIsland } from "./islands/category-performance-island";
import { TopProductsIsland } from "./islands/top-products-island";
import { DailyTrendsIsland } from "./islands/daily-trends-island";
import { HourlyDistributionIsland } from "./islands/hourly-distribution-island";
import { OutletTiersIsland } from "./islands/outlet-tiers-island";
import { HighPerformerIsland } from "./islands/high-performer-island";
import { LowPerformerIsland } from "./islands/low-performer-island";
import { KpiStripSkeleton, ChartCardSkeleton } from "./islands/skeletons";
import { ThresholdEditor } from "./threshold-editor";
import { ComparisonModeToggle } from "./comparison-mode-toggle";
import { FlagsSheetTrigger } from "./flags-sheet-trigger";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseAnalyticsFiltersFromSearchParams(sp);
  const canonical = canonicaliseFilters(filters);
  const scopeKey = (await getCacheScopeKey()) as CachedQueryScope;
  const comparisonRaw = Array.isArray(sp.comparison)
    ? sp.comparison[0]
    : sp.comparison;
  const comparisonMode: ComparisonMode =
    comparisonRaw === "yoy" ? "yoy" : "mom";

  // Fetched once at the page level so the header count and the outlet-tiers
  // island share the same list. If contention becomes a concern this can move
  // into its own Suspense boundary.
  const flags = await fetchLocationFlags();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Portfolio"
        description="Cross-portfolio performance overview"
        actions={<ComparisonModeToggle current={comparisonMode} />}
        toolbar={
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Filters are set in the sticky filter bar above. Active comparison:
              <span className="font-medium text-foreground ml-1">
                {comparisonMode === "mom"
                  ? "Month-over-month"
                  : "Year-over-year"}
              </span>
            </p>
            <FlagsSheetTrigger flags={flags} />
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* KPI strip */}
        <Suspense fallback={<KpiStripSkeleton />}>
          <ErrorBoundary fallback={<DataIslandError section="KPIs" />}>
            <KpiStripIsland
              canonical={canonical}
              scopeKey={scopeKey}
              comparisonMode={comparisonMode}
            />
          </ErrorBoundary>
        </Suspense>

        {/* Threshold editor drives the performer cards (client state) */}
        <ThresholdEditor />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Suspense fallback={<ChartCardSkeleton title="High Performer Patterns" />}>
            <ErrorBoundary fallback={<DataIslandError section="High performer patterns" />}>
              <HighPerformerIsland filters={filters} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Low Performer Patterns" />}>
            <ErrorBoundary fallback={<DataIslandError section="Low performer patterns" />}>
              <LowPerformerIsland filters={filters} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Daily Trends" />}>
            <ErrorBoundary fallback={<DataIslandError section="Daily trends" />}>
              <DailyTrendsIsland canonical={canonical} scopeKey={scopeKey} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Category Performance" />}>
            <ErrorBoundary fallback={<DataIslandError section="Category performance" />}>
              <CategoryPerformanceIsland canonical={canonical} scopeKey={scopeKey} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Top Products" />}>
            <ErrorBoundary fallback={<DataIslandError section="Top products" />}>
              <TopProductsIsland canonical={canonical} scopeKey={scopeKey} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Hourly Distribution" />}>
            <ErrorBoundary fallback={<DataIslandError section="Hourly distribution" />}>
              <HourlyDistributionIsland canonical={canonical} scopeKey={scopeKey} />
            </ErrorBoundary>
          </Suspense>

          <Suspense fallback={<ChartCardSkeleton title="Outlet Tiers" />}>
            <ErrorBoundary fallback={<DataIslandError section="Outlet tiers" />}>
              <OutletTiersIsland
                canonical={canonical}
                scopeKey={scopeKey}
                flags={flags}
              />
            </ErrorBoundary>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
