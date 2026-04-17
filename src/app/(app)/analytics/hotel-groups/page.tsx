"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchHotelGroupsList, fetchHotelGroupDetail } from "./actions";
import { GroupSelector } from "./group-selector";
import { GroupMetrics } from "./group-metrics";
import { HotelList } from "./hotel-list";
import { TemporalCharts } from "./temporal-charts";
import type { HotelGroupData, HotelGroupDetail } from "@/lib/analytics/types";

export default function HotelGroupsPage() {
  const filters = useAnalyticsFilters();
  const [groups, setGroups] = useState<HotelGroupData[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
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
        // Auto-select first group if none selected or selection no longer valid
        if (result.length > 0) {
          const stillValid = result.some((g) => g.id === selectedGroupId);
          if (!stillValid) {
            setSelectedGroupId(result[0].id);
          }
        } else {
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hotel Groups
        </h1>
        <p className="text-sm text-muted-foreground">
          Performance analysis by hotel group
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <SectionAccordion title="Hotel Groups">
        <GroupSelector
          groups={groups}
          selectedId={selectedGroupId}
          onSelect={setSelectedGroupId}
          loading={listLoading}
        />
      </SectionAccordion>

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
  );
}
