"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { LowPerformerPatterns as LowPerformerPatternsData } from "@/lib/analytics/types";

interface LowPerformerPatternsProps {
  data: LowPerformerPatternsData | null;
  loading?: boolean;
}

export function LowPerformerPatterns({
  data,
}: LowPerformerPatternsProps) {
  const metricLabel = useMetricLabel();
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-destructive">{data.redCount}</span> of{" "}
        <span className="font-medium text-foreground">{data.totalCount}</span>{" "}
        locations are in the red tier
      </p>

      {/* Insight bullets */}
      {data.insights.length > 0 && (
        <ul className="space-y-1.5">
          {data.insights.map((insight, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              {insight}
            </li>
          ))}
        </ul>
      )}

      {/* KPI values */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiValue
          label={`Avg ${metricLabel} / Room`}
          value={
            data.avgRevenuePerRoom != null
              ? formatCurrency(data.avgRevenuePerRoom)
              : "\u2014"
          }
        />
        <KpiValue
          label="Avg Rooms / Location"
          value={
            data.avgRoomCount != null
              ? formatNumber(Math.round(data.avgRoomCount))
              : "\u2014"
          }
        />
        <KpiValue label="Red Locations" value={String(data.redCount)} />
        <KpiValue label="Total Locations" value={String(data.totalCount)} />
      </div>

      {/* Distribution tables */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Hotel group distribution */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Hotel Group Distribution</h4>
          {data.hotelGroupDistribution.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.hotelGroupDistribution.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">
                      {row.percentage.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No hotel group data</p>
          )}
        </div>

        {/* Region distribution */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Region Distribution</h4>
          {data.regionDistribution.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.regionDistribution.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">
                      {row.percentage.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No region data</p>
          )}
        </div>
      </div>

      {/* Top products */}
      {data.topProducts.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Top Products (Red-Tier Locations)
          </h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">{metricLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topProducts.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(row.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function KpiValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
