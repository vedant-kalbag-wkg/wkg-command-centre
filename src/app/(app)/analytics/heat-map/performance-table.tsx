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
  // ISO YYYY-MM-DD — reference date for maturity bucket calculation (D3:
  // never NOW(); always the user-selected reporting window's end).
  referenceDate: string;
}

// Score-band defaults for the composite-score traffic light (D7 / Task 2.9).
// `classifyTrafficLight` uses `redMax` (≤ → red) and `greenMin` (≥ → green);
// scores in (33, 66) fall through to amber.
const HEAT_MAP_SCORE_THRESHOLDS: ThresholdConfig = { redMax: 33, greenMin: 66 };

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

const EM_DASH = "—";

export function PerformanceTable({ data, title, thresholdConfig, flags = [], onFlagCreated, referenceDate }: PerformanceTableProps) {
  const metricLabel = useMetricLabel();
  const refDate = new Date(referenceDate);
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
              <TableHead>Hotel Group</TableHead>
              <TableHead>Maturity</TableHead>
              <TableHead className="text-right">Kiosks</TableHead>
              <TableHead className="text-right">Rooms</TableHead>
              <TableHead className="text-right">Total {metricLabel}</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">{metricLabel} / Kiosk</TableHead>
              <TableHead className="text-right">{metricLabel} / Room</TableHead>
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
                <TableCell>{row.hotelGroupName ?? EM_DASH}</TableCell>
                <TableCell>
                  {(() => {
                    const bucket = calculateMaturityBucket(
                      row.liveDate ? new Date(row.liveDate) : null,
                      refDate,
                    );
                    return bucket ? (
                      <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                        {maturityBucketLabel(bucket)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{EM_DASH}</span>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  {formatNumber(row.kioskCount)}
                </TableCell>
                <TableCell className="text-right">
                  {row.numRooms != null ? formatNumber(row.numRooms) : EM_DASH}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(row.revenue)}
                </TableCell>
                <TableCell className="text-right">
                  {formatNumber(row.transactions)}
                </TableCell>
                <TableCell className="text-right">
                  {row.revenuePerKiosk != null
                    ? formatCurrency(row.revenuePerKiosk)
                    : EM_DASH}
                </TableCell>
                <TableCell className="text-right">
                  {row.revenuePerRoom != null
                    ? formatCurrency(row.revenuePerRoom)
                    : EM_DASH}
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
                  // Task 2.9 / D7: traffic light reflects the composite SCORE
                  // (0-100), not raw revenue. The DB-backed `thresholdConfig`
                  // (settings/thresholds page) is still on the £-revenue
                  // scale — its values (e.g. 500/1500) are meaningless on
                  // a 0-100 score, so we use score-band constants here.
                  // TODO: migrate the settings UI + DB defaults to score
                  // bands (e.g. add `score_threshold_*` keys) so admins
                  // can re-tune. Tracked alongside Phase 2 audit follow-ups.
                  const light = classifyTrafficLight(
                    row.compositeScore,
                    HEAT_MAP_SCORE_THRESHOLDS,
                  );
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
