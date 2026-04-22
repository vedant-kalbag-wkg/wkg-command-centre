import { ChartCard } from "@/components/ui/chart-card";
import { getOutletTiersCached } from "@/lib/analytics/queries/portfolio";
import { getThresholds } from "@/lib/analytics/thresholds-server";
import { OutletTiersRefresher } from "./outlet-tiers-refresher";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";
import type { LocationFlag } from "@/lib/analytics/types";

interface Props {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
  flags: LocationFlag[];
}

export async function OutletTiersIsland({ canonical, scopeKey, flags }: Props) {
  const [data, thresholdConfig] = await Promise.all([
    getOutletTiersCached(canonical, scopeKey),
    getThresholds(),
  ]);

  const empty = data.length === 0;

  return (
    <ChartCard
      title="Outlet Tiers"
      description="Performance banding across outlets"
      className="gap-0 py-0 lg:col-span-12"
      loading={false}
      empty={empty}
      emptyMessage="No outlet data for selected filters"
      collapsible
    >
      {!empty && (
        <OutletTiersRefresher
          data={data}
          thresholdConfig={thresholdConfig}
          flags={flags}
        />
      )}
    </ChartCard>
  );
}
