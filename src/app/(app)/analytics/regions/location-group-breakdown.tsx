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
import { formatCurrency, formatNumber, formatNullValue } from "@/lib/analytics/formatters";
import type { RegionDetail } from "@/lib/analytics/types";

interface LocationGroupBreakdownProps {
  data: RegionDetail["locationGroupBreakdown"];
}

export function LocationGroupBreakdown({ data }: LocationGroupBreakdownProps) {
  if (data.length === 0) {
    return <EmptyState message="No location groups in this region" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Location Group</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Transactions</TableHead>
            <TableHead className="text-right">Outlets</TableHead>
            <TableHead className="text-right">Total Rooms</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell className="text-right">
                {formatCurrency(row.revenue)}
              </TableCell>
              <TableCell className="text-right">
                {formatNumber(row.transactions)}
              </TableCell>
              <TableCell className="text-right">
                {formatNumber(row.outletCount)}
              </TableCell>
              <TableCell className="text-right">
                {formatNullValue(row.totalRooms, formatNumber)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
