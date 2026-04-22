import { ChartCard } from "@/components/ui/chart-card";
import { TopProducts } from "../top-products";
import { getTopProductsCached } from "@/lib/analytics/queries/portfolio";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";

interface Props {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
}

export async function TopProductsIsland({ canonical, scopeKey }: Props) {
  const data = await getTopProductsCached(canonical, scopeKey);
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Top Products"
      description="Best-selling products by revenue"
      className="gap-0 py-0 lg:col-span-12"
      loading={false}
      empty={empty}
      emptyMessage="No product data for selected filters"
      collapsible
    >
      {!empty && <TopProducts data={data} />}
    </ChartCard>
  );
}
