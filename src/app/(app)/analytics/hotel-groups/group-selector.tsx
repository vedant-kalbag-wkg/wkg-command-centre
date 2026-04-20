"use client";

import { useMemo } from "react";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCompactNumber, formatNumber } from "@/lib/analytics/formatters";
import type { HotelGroupData } from "@/lib/analytics/types";

interface GroupSelectorProps {
  groups: HotelGroupData[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}

function formatRevenueCompact(value: number): string {
  // "£X.Xm revenue"-style compact label for dropdown rows.
  return `£${formatCompactNumber(value).toLowerCase()}`;
}

function groupOptionLabel(group: HotelGroupData): string {
  return `${group.name} (${formatNumber(group.hotelCount)} hotels) ${formatRevenueCompact(group.revenue)} revenue`;
}

export function GroupSelector({
  groups,
  selected,
  onChange,
  loading = false,
}: GroupSelectorProps) {
  const options = useMemo(
    () => groups.map((g) => ({ value: g.id, label: groupOptionLabel(g) })),
    [groups],
  );

  if (loading) {
    return <Skeleton className="h-9 w-full max-w-md rounded-lg" />;
  }

  if (groups.length === 0) {
    return <EmptyState message="No hotel groups found for selected filters" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="hotel-group-select"
        className="text-xs font-medium text-muted-foreground"
      >
        Select one or more hotel groups
      </label>
      <MultiSelectFilter
        label="Select a hotel group"
        options={options}
        selected={selected}
        onChange={onChange}
        placeholder="Search hotel groups..."
      />
    </div>
  );
}
