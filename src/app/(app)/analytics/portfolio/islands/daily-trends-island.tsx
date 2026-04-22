import { ChartCard } from "@/components/ui/chart-card";
import { DailyTrends } from "../daily-trends";
import { getDailyTrendsCached } from "@/lib/analytics/queries/portfolio";
import { getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { EVENT_CATEGORIES } from "@/lib/stores/trend-store";
import type { CanonicalFilters } from "@/lib/analytics/canonicalise-filters";
import type { CachedQueryScope } from "@/lib/analytics/cached-query";
import type { BusinessEventDisplay } from "@/lib/analytics/types";

interface Props {
  canonical: CanonicalFilters;
  scopeKey: CachedQueryScope;
}

export async function DailyTrendsIsland({ canonical, scopeKey }: Props) {
  if (canonical.dateFrom === null || canonical.dateTo === null) {
    throw new Error("DailyTrendsIsland requires concrete dateFrom/dateTo");
  }

  const userCtx = await getUserCtx();

  const [data, events] = await Promise.all([
    getDailyTrendsCached(canonical, scopeKey),
    userCtx.userType === "external"
      ? Promise.resolve<BusinessEventDisplay[]>([])
      : getBusinessEvents(canonical.dateFrom, canonical.dateTo).catch((err) => {
          console.error("[portfolio] getBusinessEvents failed:", err);
          return [] as BusinessEventDisplay[];
        }),
  ]);

  const activeEventCategories = EVENT_CATEGORIES.map((c) => c.name);
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Daily Trends"
      description="Revenue and transactions over time"
      className="gap-0 py-0 lg:col-span-12"
      loading={false}
      empty={empty}
      emptyMessage="No trend data for selected filters"
      collapsible
    >
      {!empty && (
        <DailyTrends
          data={data}
          events={events}
          activeEventCategories={activeEventCategories}
        />
      )}
    </ChartCard>
  );
}
