"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MapPin } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { PageHeader } from "@/components/layout/page-header";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchRegionsList, fetchRegionDetail } from "./actions";
import { RegionSelector } from "./region-selector";
import { RegionMetrics } from "./region-metrics";
import { HotelGroupBreakdown } from "./hotel-group-breakdown";
import { LocationGroupBreakdown } from "./location-group-breakdown";
import type { RegionData, RegionDetail } from "@/lib/analytics/types";

function parseIdParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function RegionsPage() {
  const filters = useAnalyticsFilters();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrlRegionIds = parseIdParam(searchParams?.get("region") ?? null);
  const [regionsList, setRegionsList] = useState<RegionData[]>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>(
    initialUrlRegionIds,
  );
  const [detail, setDetail] = useState<RegionDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  // Load regions list when filters change
  const loadRegions = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setListLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchRegionsList(parsed);
      if (!controller.signal.aborted) {
        setRegionsList(result);
        // Drop any previously selected ids that fell out of the filtered set.
        // Do NOT auto-select a default — the user must pick regions explicitly,
        // which drives the "no region selected" EmptyState below.
        const validIds = new Set(result.map((r) => r.id));
        setSelectedRegionIds((prev) => {
          const kept = prev.filter((id) => validIds.has(id));
          if (kept.length !== prev.length && kept.length === 0) {
            setDetail(null);
          }
          return kept;
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load regions",
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
    loadRegions();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadRegions]);

  // Load detail when selected regions change
  const selectedKey = selectedRegionIds.join(",");
  const loadDetail = useCallback(async () => {
    if (selectedRegionIds.length === 0) {
      setDetail(null);
      return;
    }

    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setDetailLoading(true);

    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchRegionDetail(selectedRegionIds, parsed);
      if (!controller.signal.aborted) {
        setDetail(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load region detail",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, filtersJson]);

  useEffect(() => {
    loadDetail();
    return () => {
      detailAbortRef.current?.abort();
    };
  }, [loadDetail]);

  const emptyDetail: RegionDetail = {
    metrics: { revenue: 0, transactions: 0, hotelGroupCount: 0, locationGroupCount: 0 },
    hotelGroupBreakdown: [],
    locationGroupBreakdown: [],
    previousMetrics: null,
  };

  const regionDetail = detail ?? emptyDetail;

  function handleSelectionChange(ids: string[]) {
    setSelectedRegionIds(ids);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (ids.length === 0) {
      params.delete("region");
    } else {
      params.set("region", ids.join(","));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Regions"
        description="Performance analysis by geographic region"
        count={regionsList.length}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <SectionAccordion title="Regions">
          <RegionSelector
            regions={regionsList}
            selected={selectedRegionIds}
            onChange={handleSelectionChange}
            loading={listLoading}
          />
        </SectionAccordion>

        {selectedRegionIds.length === 0 && !listLoading && regionsList.length > 0 && (
          <EmptyState
            icon={MapPin}
            title="No region selected"
            description="Select a region to see its performance metrics."
          />
        )}

        {selectedRegionIds.length > 0 && (
          <>
            <SectionAccordion title="Region Metrics">
              {detailLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-lg" />
                  ))}
                </div>
              ) : (
                <RegionMetrics detail={regionDetail} />
              )}
            </SectionAccordion>

            <SectionAccordion title="Hotel Groups in Region">
              {detailLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : (
                <HotelGroupBreakdown data={regionDetail.hotelGroupBreakdown} />
              )}
            </SectionAccordion>

            <SectionAccordion title="Location Groups in Region">
              {detailLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : (
                <LocationGroupBreakdown data={regionDetail.locationGroupBreakdown} />
              )}
            </SectionAccordion>
          </>
        )}
      </div>
    </div>
  );
}
