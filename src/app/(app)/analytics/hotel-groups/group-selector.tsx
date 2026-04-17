"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber, formatChangeIndicator } from "@/lib/analytics/formatters";
import { cn } from "@/lib/utils";
import type { HotelGroupData } from "@/lib/analytics/types";

interface GroupSelectorProps {
  groups: HotelGroupData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

export function GroupSelector({
  groups,
  selectedId,
  onSelect,
  loading = false,
}: GroupSelectorProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return <EmptyState message="No hotel groups found for selected filters" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => {
        const isSelected = group.id === selectedId;
        const revenueChange = formatChangeIndicator(group.revenueChange);

        return (
          <Card
            key={group.id}
            size="sm"
            className={cn(
              "cursor-pointer transition-colors hover:border-[var(--wk-azure,#00A6D3)]/50",
              isSelected && "border-[var(--wk-azure,#00A6D3)] border-2",
            )}
            onClick={() => onSelect(group.id)}
          >
            <CardContent className="flex flex-col gap-1">
              <span className="text-sm font-medium truncate">{group.name}</span>
              <span className="text-xl font-semibold tracking-tight">
                {formatCurrency(group.revenue)}
              </span>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatNumber(group.hotelCount)} hotels</span>
                <span style={{ color: revenueChange.color }}>
                  {revenueChange.text}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
