"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type { LocationGroupData } from "@/lib/analytics/types";

interface LocationSelectorProps {
  groups: LocationGroupData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

function groupLabel(group: LocationGroupData): string {
  const locations = `${formatNumber(group.hotelCount)} location${group.hotelCount === 1 ? "" : "s"}`;
  return `${group.name} · ${locations} · ${formatCurrency(group.revenue)}`;
}

export function LocationSelector({
  groups,
  selectedId,
  onSelect,
  loading = false,
}: LocationSelectorProps) {
  // base-ui's Select renders the raw `value` inside <SelectValue /> unless an
  // `items` map is supplied to <Select.Root>. Without it, the trigger shows
  // the selected group's UUID instead of its name.
  const items = useMemo(
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
    <Select
      value={selectedId ?? undefined}
      items={items}
      onValueChange={(value) => {
        if (typeof value === "string") onSelect(value);
      }}
    >
      <SelectTrigger
        aria-label="Select location group"
        className="w-full max-w-md"
      >
        <SelectValue placeholder="Select a location group" />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectItem key={group.id} value={group.id}>
            {groupLabel(group)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
