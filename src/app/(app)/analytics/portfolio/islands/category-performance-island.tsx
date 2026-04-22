import { ChartCard } from "@/components/ui/chart-card";
import { CategoryPerformance } from "../category-performance";
import { getCategoryPerformanceCached } from "@/lib/analytics/queries/portfolio";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";

interface Props {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
}

export async function CategoryPerformanceIsland({ canonical, scopeKey }: Props) {
  const data = await getCategoryPerformanceCached(canonical, scopeKey);
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Category Performance"
      description="Revenue by product category"
      className="gap-0 py-0 lg:col-span-12"
      loading={false}
      empty={empty}
      emptyMessage="No category data for selected filters"
      collapsible
    >
      {!empty && <CategoryPerformance data={data} />}
    </ChartCard>
  );
}
