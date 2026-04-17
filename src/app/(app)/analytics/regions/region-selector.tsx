"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { cn } from "@/lib/utils";
import type { RegionData } from "@/lib/analytics/types";

interface RegionSelectorProps {
  regions: RegionData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

export function RegionSelector({
  regions,
  selectedId,
  onSelect,
  loading = false,
}: RegionSelectorProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (regions.length === 0) {
    return <EmptyState message="No regions found for selected filters" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {regions.map((region) => {
        const isSelected = region.id === selectedId;

        return (
          <Card
            key={region.id}
            size="sm"
            className={cn(
              "cursor-pointer transition-colors hover:border-[var(--wk-azure,#00A6D3)]/50",
              isSelected && "border-[var(--wk-azure,#00A6D3)] border-2",
            )}
            onClick={() => onSelect(region.id)}
          >
            <CardContent className="flex flex-col gap-1">
              <span className="text-sm font-medium truncate">{region.name}</span>
              <span className="text-xl font-semibold tracking-tight">
                {formatCurrency(region.revenue)}
              </span>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatNumber(region.hotelGroupCount)} groups</span>
                <span>{formatNumber(region.transactions)} txns</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
