import { ChartCard } from "@/components/ui/chart-card";
import { HourlyDistribution } from "../hourly-distribution";
import { getHourlyDistributionCached } from "@/lib/analytics/queries/portfolio";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";

interface Props {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
}

export async function HourlyDistributionIsland({ canonical, scopeKey }: Props) {
  const data = await getHourlyDistributionCached(canonical, scopeKey);
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Hourly Distribution"
      description="Revenue by hour of day"
      className="gap-0 py-0 lg:col-span-12"
      loading={false}
      empty={empty}
      emptyMessage="No hourly data for selected filters"
      collapsible
    >
      {!empty && <HourlyDistribution data={data} />}
    </ChartCard>
  );
}
