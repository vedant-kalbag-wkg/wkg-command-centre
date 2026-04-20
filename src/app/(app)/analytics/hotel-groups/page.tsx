"use client";

import { useEffect, useState, useCallback } from "react";
import { Building2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { useAbortableAction } from "@/lib/analytics/use-abortable-action";
import { PageHeader } from "@/components/layout/page-header";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchHotelGroupsList, fetchHotelGroupDetail } from "./actions";
import { GroupSelector } from "./group-selector";
import { GroupMetrics } from "./group-metrics";
import { HotelList } from "./hotel-list";
import { TemporalCharts } from "./temporal-charts";
import type { HotelGroupData, HotelGroupDetail } from "@/lib/analytics/types";

function parseIdParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function HotelGroupsPage() {
  const filters = useAnalyticsFilters();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrlGroupIds = parseIdParam(searchParams?.get("group") ?? null);
  const [groups, setGroups] = useState<HotelGroupData[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    initialUrlGroupIds,
  );
  const [detail, setDetail] = useState<HotelGroupDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);

  // Discard stale server-action results on unmount / newer dispatch.
  const fetchList = useAbortableAction(fetchHotelGroupsList);
  const fetchDetail = useAbortableAction(fetchHotelGroupDetail);

  // Load groups list when filters change
  const loadGroups = useCallback(async () => {
    setListLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchList(parsed);
      if (result === null) return;
      setGroups(result);
      // Do NOT auto-select — the user must pick groups explicitly, which
      // drives the "no group selected" EmptyState below. Drop any previously
      // selected ids that fell out of the filtered result set.
      const validIds = new Set(result.map((g) => g.id));
      setSelectedGroupIds((prev) => {
        const kept = prev.filter((id) => validIds.has(id));
        if (kept.length !== prev.length && kept.length === 0) {
          setDetail(null);
        }
        return kept;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load hotel groups",
      );
    } finally {
      setListLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersJson, fetchList]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Load detail when selected groups change
  const selectedKey = selectedGroupIds.join(",");
  const loadDetail = useCallback(async () => {
    if (selectedGroupIds.length === 0) {
      setDetail(null);
      return;
    }

    setDetailLoading(true);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchDetail(selectedGroupIds, parsed);
      if (result === null) return;
      setDetail(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load group detail",
      );
    } finally {
      setDetailLoading(false);
    }
  // selectedKey captures array identity without re-running on reference flips.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, filtersJson, fetchDetail]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const emptyDetail: HotelGroupDetail = {
    metrics: { revenue: 0, transactions: 0, hotelCount: 0, avgRevenuePerHotel: 0 },
    hotels: [],
    trends: [],
    previousMetrics: null,
  };

  const groupDetail = detail ?? emptyDetail;

  function handleSelectionChange(ids: string[]) {
    setSelectedGroupIds(ids);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (ids.length === 0) {
      params.delete("group");
    } else {
      params.set("group", ids.join(","));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Hotel Groups"
        description="Performance analysis by hotel group"
        count={groups.length}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <SectionAccordion title="Hotel Groups">
          <GroupSelector
            groups={groups}
            selected={selectedGroupIds}
            onChange={handleSelectionChange}
            loading={listLoading}
          />
        </SectionAccordion>

        {selectedGroupIds.length === 0 && !listLoading && groups.length > 0 && (
          <EmptyState
            icon={Building2}
            title="No hotel group selected"
            description="Select a hotel group to view reports"
          />
        )}

        {selectedGroupIds.length > 0 && (
          <>
            <SectionAccordion title="Group Metrics">
              {detailLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-lg" />
                  ))}
                </div>
              ) : (
                <GroupMetrics detail={groupDetail} />
              )}
            </SectionAccordion>

            <SectionAccordion title="Hotels in Group">
              {detailLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : (
                <HotelList hotels={groupDetail.hotels} />
              )}
            </SectionAccordion>

            <SectionAccordion title="Daily Trends">
              <TemporalCharts
                data={groupDetail.trends}
                loading={detailLoading}
              />
            </SectionAccordion>
          </>
        )}
      </div>
    </div>
  );
}
