"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLocationGroupsList, fetchLocationGroupDetail } from "./actions";
import { LocationSelector } from "./location-selector";
import { LocationMetrics } from "./location-metrics";
import { CapacityMetrics } from "./capacity-metrics";
import { PeerAnalysis } from "./peer-analysis";
import { HotelBreakdown } from "./hotel-breakdown";
import type { LocationGroupData, LocationGroupDetail } from "@/lib/analytics/types";

export default function LocationGroupsPage() {
  const filters = useAnalyticsFilters();
  const [groups, setGroups] = useState<LocationGroupData[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LocationGroupDetail | null>(null);
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
      const result = await fetchLocationGroupsList(parsed);
      if (!controller.signal.aborted) {
        setGroups(result);
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
          err instanceof Error ? err.message : "Failed to load location groups",
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
      const result = await fetchLocationGroupDetail([selectedGroupId], parsed);
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

  const emptyDetail: LocationGroupDetail = {
    metrics: { revenue: 0, transactions: 0, hotelCount: 0, totalRooms: null },
    capacityMetrics: {
      revenuePerRoom: null,
      txnPerRoom: null,
      txnPerKiosk: null,
      avgBasketValue: 0,
      totalRooms: null,
      totalKiosks: null,
    },
    peerAnalysis: [],
    hotelBreakdown: [],
    previousMetrics: null,
  };

  const groupDetail = detail ?? emptyDetail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Location Groups
        </h1>
        <p className="text-sm text-muted-foreground">
          Performance analysis by location group with capacity metrics
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <SectionAccordion title="Location Groups">
        <LocationSelector
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
              <LocationMetrics detail={groupDetail} />
            )}
          </SectionAccordion>

          <SectionAccordion title="Capacity Metrics">
            {detailLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : (
              <CapacityMetrics capacityMetrics={groupDetail.capacityMetrics} />
            )}
          </SectionAccordion>

          <SectionAccordion title="Peer Analysis">
            {detailLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : (
              <PeerAnalysis data={groupDetail.peerAnalysis} />
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
              <HotelBreakdown hotels={groupDetail.hotelBreakdown} />
            )}
          </SectionAccordion>
        </>
      )}
    </div>
  );
}
