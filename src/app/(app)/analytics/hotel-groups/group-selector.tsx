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
import { formatCompactNumber, formatNumber } from "@/lib/analytics/formatters";
import type { HotelGroupData } from "@/lib/analytics/types";

interface GroupSelectorProps {
  groups: HotelGroupData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

function formatRevenueCompact(value: number): string {
  // "£X.Xm revenue"-style compact label for dropdown rows.
  return `£${formatCompactNumber(value).toLowerCase()}`;
}

export function GroupSelector({
  groups,
  selectedId,
  onSelect,
  loading = false,
}: GroupSelectorProps) {
  // base-ui's Select displays the raw `value` inside <SelectValue /> unless an
  // `items` map is passed to <Select.Root>. Without it, selecting a group shows
  // its UUID in the trigger. Passing { value: id, label: name } makes
  // SelectValue render the group name.
  const items = useMemo(
    () => groups.map((g) => ({ value: g.id, label: g.name })),
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
        Select a hotel group
      </label>
      <Select
        value={selectedId ?? undefined}
        items={items}
        onValueChange={(v) => {
          if (typeof v === "string") onSelect(v);
        }}
      >
        <SelectTrigger
          id="hotel-group-select"
          className="w-full max-w-md"
          aria-label="Select a hotel group"
        >
          <SelectValue placeholder="Choose a hotel group..." />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              <span className="flex w-full items-center gap-3">
                <span className="flex-1 truncate font-medium">
                  {group.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  ({formatNumber(group.hotelCount)} hotels)
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatRevenueCompact(group.revenue)} revenue
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
