"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { getDimensionOptions } from "@/app/(app)/analytics/actions";
import {
  useAnalyticsFilterStore,
  filtersToSearchParams,
  searchParamsToFilters,
} from "@/lib/stores/analytics-filter-store";
import { MultiSelectFilter } from "./multi-select-filter";
import { DateRangePicker } from "./date-range-picker";
import { Button } from "@/components/ui/button";
import type { DimensionOptions } from "@/lib/analytics/types";
import { MATURITY_BUCKETS } from "@/lib/analytics/maturity";

export function AnalyticsFilterBar({
  fetchOptions = getDimensionOptions,
}: {
  fetchOptions?: () => Promise<DimensionOptions>;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<DimensionOptions | null>(null);
  const [, startTransition] = useTransition();

  const store = useAnalyticsFilterStore();
  // Track mount so the initial store state (post URL hydration) does not
  // immediately stomp the URL on first render.
  const hasHydratedRef = useRef(false);

  // Load dimension options on mount
  useEffect(() => {
    startTransition(async () => {
      const opts = await fetchOptions();
      setOptions(opts);
    });
  }, [fetchOptions]);

  // Hydrate store from URL on mount
  useEffect(() => {
    const parsed = searchParamsToFilters(searchParams);
    if (parsed) {
      useAnalyticsFilterStore.setState(parsed);
    }
    hasHydratedRef.current = true;
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-apply filters: when any filter slice changes, debounce a URL replace.
  // Serialized deps keep the effect stable across reference-only re-renders.
  const filterSignature = JSON.stringify({
    from: store.dateRange.from,
    to: store.dateRange.to,
    hotel: store.hotelFilter,
    product: store.productFilter,
    hotelGroup: store.hotelGroupFilter,
    region: store.regionFilter,
    locationGroup: store.locationGroupFilter,
    maturity: store.maturityFilter,
  });

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const id = setTimeout(() => {
      const params = filtersToSearchParams(
        useAnalyticsFilterStore.getState() as Parameters<typeof filtersToSearchParams>[0]
      );
      router.replace(`?${params.toString()}`);
    }, 150);
    return () => clearTimeout(id);
  }, [filterSignature, router]);

  function handleReset() {
    store.clearAllFilters();
    router.replace("?");
  }

  const locationOptions = (options?.locations ?? []).map((l) => ({
    value: l.id,
    label: l.outletCode ? `${l.name} (${l.outletCode})` : l.name,
  }));

  const productOptions = (options?.products ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const hotelGroupOptions = (options?.hotelGroups ?? []).map((g) => ({
    value: g.id,
    label: g.name,
  }));

  const regionOptions = (options?.regions ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  const locationGroupOptions = (options?.locationGroups ?? []).map((g) => ({
    value: g.id,
    label: g.name,
  }));

  return (
    <div className="sticky top-14 z-20 flex items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-4 py-2.5">
      <div className="flex items-center gap-3 overflow-x-auto flex-1 min-w-0">
        <DateRangePicker
          from={store.dateRange.from}
          to={store.dateRange.to}
          onRangeChange={(from, to) => store.setDateRange({ from, to })}
        />

        <MultiSelectFilter
          label="Locations"
          options={locationOptions}
          selected={store.hotelFilter}
          onChange={(values) => store.setFilter("hotelFilter", values)}
          placeholder="Search locations..."
        />

        <MultiSelectFilter
          label="Products"
          options={productOptions}
          selected={store.productFilter}
          onChange={(values) => store.setFilter("productFilter", values)}
          placeholder="Search products..."
        />

        <MultiSelectFilter
          label="Hotel Groups"
          options={hotelGroupOptions}
          selected={store.hotelGroupFilter}
          onChange={(values) => store.setFilter("hotelGroupFilter", values)}
          placeholder="Search hotel groups..."
        />

        <MultiSelectFilter
          label="Regions"
          options={regionOptions}
          selected={store.regionFilter}
          onChange={(values) => store.setFilter("regionFilter", values)}
          placeholder="Search regions..."
        />

        <MultiSelectFilter
          label="Location Groups"
          options={locationGroupOptions}
          selected={store.locationGroupFilter}
          onChange={(values) => store.setFilter("locationGroupFilter", values)}
          placeholder="Search location groups..."
        />

        <MultiSelectFilter
          label="Maturity"
          options={MATURITY_BUCKETS.map((b) => ({ value: b.value, label: b.label }))}
          selected={store.maturityFilter}
          onChange={(values) => store.setFilter("maturityFilter", values)}
          placeholder="Filter by maturity..."
        />
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleReset}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
