"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import type {
  SeriesConfig,
  SeriesFilters,
  TrendMetric,
  DimensionOptions,
} from "@/lib/analytics/types";

const METRIC_OPTIONS: { value: TrendMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "transactions", label: "Transactions" },
  { value: "avg_basket_value", label: "Avg Basket Value" },
  { value: "booking_fee", label: "Booking Fee" },
];

interface SeriesRowProps {
  series: SeriesConfig;
  onUpdate: (id: string, patch: Partial<SeriesConfig>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
  dimensionOptions: DimensionOptions | null;
}

export function SeriesRow({
  series,
  onUpdate,
  onRemove,
  canRemove,
  dimensionOptions,
}: SeriesRowProps) {
  function setFilter<K extends keyof SeriesFilters>(
    key: K,
    values: string[],
  ) {
    const nextFilters: SeriesFilters = { ...series.filters };
    if (values.length === 0) {
      delete nextFilters[key];
    } else {
      nextFilters[key] = values;
    }
    onUpdate(series.id, { filters: nextFilters });
  }

  const locationOptions = (dimensionOptions?.locations ?? []).map((l) => ({
    value: l.id,
    label: l.outletCode ? `${l.name} (${l.outletCode})` : l.name,
  }));
  const productOptions = (dimensionOptions?.products ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const hotelGroupOptions = (dimensionOptions?.hotelGroups ?? []).map((g) => ({
    value: g.id,
    label: g.name,
  }));
  const regionOptions = (dimensionOptions?.regions ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  }));
  const locationGroupOptions = (dimensionOptions?.locationGroups ?? []).map(
    (g) => ({ value: g.id, label: g.name }),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      {/* Color swatch */}
      <div
        className="size-4 shrink-0 rounded-full"
        style={{ backgroundColor: series.color }}
        title={series.color}
      />

      {/* Metric select */}
      <Select
        value={series.metric}
        onValueChange={(v) =>
          onUpdate(series.id, { metric: v as TrendMetric })
        }
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {METRIC_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Per-series filters */}
      <MultiSelectFilter
        label="Locations"
        options={locationOptions}
        selected={series.filters.locationIds ?? []}
        onChange={(v) => setFilter("locationIds", v)}
        placeholder="Search locations..."
      />
      <MultiSelectFilter
        label="Products"
        options={productOptions}
        selected={series.filters.productIds ?? []}
        onChange={(v) => setFilter("productIds", v)}
        placeholder="Search products..."
      />
      <MultiSelectFilter
        label="Hotel Groups"
        options={hotelGroupOptions}
        selected={series.filters.hotelGroupIds ?? []}
        onChange={(v) => setFilter("hotelGroupIds", v)}
        placeholder="Search hotel groups..."
      />
      <MultiSelectFilter
        label="Regions"
        options={regionOptions}
        selected={series.filters.regionIds ?? []}
        onChange={(v) => setFilter("regionIds", v)}
        placeholder="Search regions..."
      />
      <MultiSelectFilter
        label="Location Groups"
        options={locationGroupOptions}
        selected={series.filters.locationGroupIds ?? []}
        onChange={(v) => setFilter("locationGroupIds", v)}
        placeholder="Search location groups..."
      />

      {/* Label input */}
      <Input
        className="h-8 flex-1 min-w-[120px] text-xs"
        value={series.label}
        onChange={(e) =>
          onUpdate(series.id, { label: e.target.value, labelEdited: true })
        }
        placeholder="Series label"
      />

      {/* Remove button */}
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={() => onRemove(series.id)}
        >
          <X className="size-3.5" />
          <span className="sr-only">Remove series</span>
        </Button>
      )}
    </div>
  );
}
