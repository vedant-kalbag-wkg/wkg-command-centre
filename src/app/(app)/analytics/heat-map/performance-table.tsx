"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/analytics/empty-state";
import {
  formatCurrency,
  formatNumber,
  formatNullValue,
} from "@/lib/analytics/formatters";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import { cn } from "@/lib/utils";
import type { HeatMapHotel, LocationFlag } from "@/lib/analytics/types";
import {
  calculateMaturityBucket,
  maturityBucketLabel,
} from "@/lib/analytics/maturity";
import {
  classifyTrafficLight,
  trafficLightBgColor,
  type ThresholdConfig,
} from "@/lib/analytics/thresholds";
import { FlagBadge } from "@/components/analytics/flag-badge";
import { FlagDialog } from "@/components/analytics/flag-dialog";

interface PerformanceTableProps {
  data: HeatMapHotel[];
  title: string;
  thresholdConfig?: ThresholdConfig;
  flags?: LocationFlag[];
  onFlagCreated?: () => void;
}

function scoreColorClass(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (score >= 40) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

const trafficLightLabel: Record<string, string> = {
  red: "Low",
  amber: "Mid",
  green: "High",
};

export function PerformanceTable({ data, title, thresholdConfig, flags = [], onFlagCreated }: PerformanceTableProps) {
  const metricLabel = useMetricLabel();
  const flagsByLocation = new Map<string, LocationFlag[]>();
  for (const f of flags) {
    const existing = flagsByLocation.get(f.locationId) ?? [];
    existing.push(f);
    flagsByLocation.set(f.locationId, existing);
  }
  if (data.length === 0) {
    return <EmptyState message={`No ${title.toLowerCase()} data available`} />;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-background w-12">
                Rank
              </TableHead>
              <TableHead className="sticky left-12 z-10 bg-background min-w-[180px]">
                Hotel
              </TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">{metricLabel}</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">{metricLabel === "Revenue" ? "Rev" : "Sales"} / Room</TableHead>
              <TableHead className="text-right">Txn / Kiosk</TableHead>
              <TableHead className="text-right">Avg Basket</TableHead>
              <TableHead className="text-right w-20">Score</TableHead>
              {thresholdConfig && (
                <TableHead className="text-center w-16">Status</TableHead>
              )}
              <TableHead className="text-center w-24">Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.locationId}>
                <TableCell className="sticky left-0 z-10 bg-background font-mono text-xs text-muted-foreground">
                  {row.rank}
                </TableCell>
                <TableCell className="sticky left-12 z-10 bg-background">
                  <div className="flex flex-col">
                    <span className="font-medium">{row.hotelName}</span>
                    {row.outletCode && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.outletCode}
                      </span>
                    )}
                  </div>
                </TableCell>
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
                  {formatNullValue(row.revenuePerRoom, formatCurrency)}
                </TableCell>
                <TableCell className="text-right">
                  {formatNullValue(row.txnPerKiosk, (v) => formatNumber(v, 1))}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(row.avgBasketValue)}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      "inline-block rounded-md px-2 py-0.5 text-xs font-semibold",
                      scoreColorClass(row.compositeScore),
                    )}
                  >
                    {row.compositeScore.toFixed(1)}
                  </span>
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
      </div>
    </div>
  );
}
