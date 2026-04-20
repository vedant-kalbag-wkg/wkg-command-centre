"use client";

import { useMemo } from "react";
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

type MarketGroup = {
  marketName: string;
  regions: RegionData[];
};

function useMarketGroups(regions: RegionData[]): MarketGroup[] {
  return useMemo(() => {
    const grouped = new Map<string, RegionData[]>();
    const unassigned: RegionData[] = [];

    for (const region of regions) {
      if (region.marketName) {
        const existing = grouped.get(region.marketName);
        if (existing) {
          existing.push(region);
        } else {
          grouped.set(region.marketName, [region]);
        }
      } else {
        unassigned.push(region);
      }
    }

    const groups: MarketGroup[] = [];
    for (const [marketName, marketRegions] of grouped) {
      groups.push({ marketName, regions: marketRegions });
    }
    if (unassigned.length > 0) {
      groups.push({ marketName: "Unassigned", regions: unassigned });
    }
    return groups;
  }, [regions]);
}

function RegionCard({
  region,
  isSelected,
  onSelect,
}: {
  region: RegionData;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Card
      size="sm"
      variant={isSelected ? "elevated" : "default"}
      className={cn(
        "cursor-pointer transition-colors hover:border-primary/50",
        isSelected && "border-primary border-2",
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
}

export function RegionSelector({
  regions,
  selectedId,
  onSelect,
  loading = false,
}: RegionSelectorProps) {
  const marketGroups = useMarketGroups(regions);

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

  // If no market grouping exists (all regions unassigned), render flat grid
  if (marketGroups.length === 1 && marketGroups[0].marketName === "Unassigned") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((region) => (
          <RegionCard
            key={region.id}
            region={region}
            isSelected={region.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {marketGroups.map((group) => (
        <div key={group.marketName}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.marketName}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.regions.map((region) => (
              <RegionCard
                key={region.id}
                region={region}
                isSelected={region.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
