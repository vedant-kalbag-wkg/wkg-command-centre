"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
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

export function AnalyticsFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<DimensionOptions | null>(null);
  const [isPending, startTransition] = useTransition();

  const store = useAnalyticsFilterStore();

  // Load dimension options on mount
  useEffect(() => {
    startTransition(async () => {
      const opts = await getDimensionOptions();
      setOptions(opts);
    });
  }, []);

  // Hydrate store from URL on mount
  useEffect(() => {
    const parsed = searchParamsToFilters(searchParams);
    if (parsed) {
      useAnalyticsFilterStore.setState(parsed);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply() {
    const params = filtersToSearchParams(
      useAnalyticsFilterStore.getState() as Parameters<typeof filtersToSearchParams>[0]
    );
    router.replace(`?${params.toString()}`);
  }

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

  const categoryOptions = (options?.categories ?? []).map((c) => ({
    value: c,
    label: c,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <SlidersHorizontal className="size-4 text-muted-foreground" />

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
        label="Categories"
        options={categoryOptions}
        selected={store.categoryFilter}
        onChange={(values) => store.setFilter("categoryFilter", values)}
        placeholder="Search categories..."
      />

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleReset}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
        <Button
          size="sm"
          className="h-8"
          onClick={handleApply}
          disabled={isPending}
        >
          Apply Filters
        </Button>
      </div>
    </div>
  );
}
