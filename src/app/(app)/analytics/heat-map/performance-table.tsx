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
import { cn } from "@/lib/utils";
import type { HeatMapHotel } from "@/lib/analytics/types";

interface PerformanceTableProps {
  data: HeatMapHotel[];
  title: string;
}

function scoreColorClass(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (score >= 40) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

export function PerformanceTable({ data, title }: PerformanceTableProps) {
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
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">Rev / Room</TableHead>
              <TableHead className="text-right">Txn / Kiosk</TableHead>
              <TableHead className="text-right">Avg Basket</TableHead>
              <TableHead className="text-right w-20">Score</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
