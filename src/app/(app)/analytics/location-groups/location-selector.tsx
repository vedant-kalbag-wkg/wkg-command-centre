"use client";

import { useMemo } from "react";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type { LocationGroupData } from "@/lib/analytics/types";

interface LocationSelectorProps {
  groups: LocationGroupData[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}

function groupLabel(group: LocationGroupData): string {
  const locations = `${formatNumber(group.hotelCount)} location${group.hotelCount === 1 ? "" : "s"}`;
  return `${group.name} · ${locations} · ${formatCurrency(group.revenue)}`;
}

export function LocationSelector({
  groups,
  selected,
  onChange,
  loading = false,
}: LocationSelectorProps) {
  const options = useMemo(
    () => groups.map((g) => ({ value: g.id, label: groupLabel(g) })),
    [groups],
  );

  if (loading) {
    return <Skeleton className="h-9 w-full max-w-md rounded-lg" />;
  }

  if (groups.length === 0) {
    return <EmptyState message="No location groups found for selected filters" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        Select one or more location groups
      </label>
      <MultiSelectFilter
        label="Select location group"
        options={options}
        selected={selected}
        onChange={onChange}
        placeholder="Search location groups..."
      />
    </div>
  );
}
