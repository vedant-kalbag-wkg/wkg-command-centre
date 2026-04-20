"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Building2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
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

export default function HotelGroupsPage() {
  const filters = useAnalyticsFilters();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlGroupId = searchParams?.get("group") ?? null;
  const [groups, setGroups] = useState<HotelGroupData[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    urlGroupId,
  );
  const [detail, setDetail] = useState<HotelGroupDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  // Load groups list when filters change
  const loadGroups = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setListLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchHotelGroupsList(parsed);
      if (!controller.signal.aborted) {
        setGroups(result);
        // Do NOT auto-select — the user must pick a group explicitly, which
        // drives the "no group selected" EmptyState below. Clear selection
        // only if it is no longer in the filtered result set.
        const stillValid = result.some((g) => g.id === selectedGroupId);
        if (!stillValid) {
          setSelectedGroupId(null);
          setDetail(null);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load hotel groups",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setListLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersJson]);

  useEffect(() => {
    loadGroups();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadGroups]);

  // Load detail when selected group changes
  const loadDetail = useCallback(async () => {
    if (!selectedGroupId) {
      setDetail(null);
      return;
    }

    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setDetailLoading(true);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchHotelGroupDetail([selectedGroupId], parsed);
      if (!controller.signal.aborted) {
        setDetail(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load group detail",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
      }
    }
  }, [selectedGroupId, filtersJson]);

  useEffect(() => {
    loadDetail();
    return () => {
      detailAbortRef.current?.abort();
    };
  }, [loadDetail]);

  const emptyDetail: HotelGroupDetail = {
    metrics: { revenue: 0, transactions: 0, hotelCount: 0, avgRevenuePerHotel: 0 },
    hotels: [],
    trends: [],
    previousMetrics: null,
  };

  const groupDetail = detail ?? emptyDetail;

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
            selectedId={selectedGroupId}
            onSelect={(id) => {
              setSelectedGroupId(id);
              // Preserve URL-based selection.
              const params = new URLSearchParams(searchParams?.toString() ?? "");
              params.set("group", id);
              router.replace(`?${params.toString()}`, { scroll: false });
            }}
            loading={listLoading}
          />
        </SectionAccordion>

        {!selectedGroupId && !listLoading && groups.length > 0 && (
          <EmptyState
            icon={Building2}
            title="No hotel group selected"
            description="Select a hotel group to view reports"
          />
        )}

        {selectedGroupId && (
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
