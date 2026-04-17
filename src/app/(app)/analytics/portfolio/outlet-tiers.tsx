"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { cn } from "@/lib/utils";
import {
  classifyTrafficLight,
  trafficLightBgColor,
  type ThresholdConfig,
} from "@/lib/analytics/thresholds";
import type { OutletTierRow, OutletTier, LocationFlag } from "@/lib/analytics/types";
import {
  calculateMaturityBucket,
  maturityBucketLabel,
} from "@/lib/analytics/maturity";
import { FlagBadge } from "@/components/analytics/flag-badge";
import { FlagDialog } from "@/components/analytics/flag-dialog";

interface OutletTiersProps {
  data: OutletTierRow[];
  loading?: boolean;
  thresholdConfig?: ThresholdConfig;
  flags?: LocationFlag[];
  onFlagCreated?: () => void;
}

const tierStyles: Record<OutletTier, string> = {
  Premium: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Standard: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Developing:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  Emerging: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const trafficLightLabel: Record<string, string> = {
  red: "Low",
  amber: "Mid",
  green: "High",
};

export function OutletTiers({ data, loading = false, thresholdConfig, flags = [], onFlagCreated }: OutletTiersProps) {
  const flagsByLocation = new Map<string, LocationFlag[]>();
  for (const f of flags) {
    const existing = flagsByLocation.get(f.locationId) ?? [];
    existing.push(f);
    flagsByLocation.set(f.locationId, existing);
  }
  if (!loading && data.length === 0) {
    return <EmptyState message="No outlet data for selected filters" />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Outlet Code</TableHead>
          <TableHead>Hotel Name</TableHead>
          <TableHead>Maturity</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
          <TableHead className="text-right">Share</TableHead>
          <TableHead>Tier</TableHead>
          {thresholdConfig && <TableHead className="text-center">Status</TableHead>}
          <TableHead className="text-center">Flags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.outletCode || row.hotelName}>
            <TableCell className="font-mono text-xs">
              {row.outletCode || "\u2014"}
            </TableCell>
            <TableCell className="font-medium">{row.hotelName}</TableCell>
            <TableCell>
              {(() => {
                const bucket = calculateMaturityBucket(
                  row.liveDate ? new Date(row.liveDate) : null,
                );
                return bucket ? (
                  <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    {maturityBucketLabel(bucket)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                );
              })()}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(row.revenue)}
            </TableCell>
            <TableCell className="text-right">
              {formatNumber(row.transactions)}
            </TableCell>
            <TableCell className="text-right">
              {row.sharePercentage.toFixed(1)}%
            </TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className={tierStyles[row.tier]}
              >
                {row.tier}
              </Badge>
            </TableCell>
            {thresholdConfig && (() => {
              const light = classifyTrafficLight(row.revenue, thresholdConfig);
              return (
                <TableCell className="text-center">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      trafficLightBgColor(light),
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        light === "red" && "bg-red-500",
                        light === "amber" && "bg-amber-500",
                        light === "green" && "bg-green-500",
                      )}
                    />
                    {trafficLightLabel[light]}
                  </span>
                </TableCell>
              );
            })()}
            <TableCell className="text-center">
              <div className="flex items-center justify-center gap-1">
                {(flagsByLocation.get(row.locationId) ?? []).map((f) => (
                  <FlagBadge key={f.id} flagType={f.flagType} />
                ))}
                <FlagDialog
                  locationId={row.locationId}
                  locationName={row.hotelName}
                  onFlagCreated={onFlagCreated}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
