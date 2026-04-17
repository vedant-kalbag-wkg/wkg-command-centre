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
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type { RegionDetail } from "@/lib/analytics/types";

interface HotelGroupBreakdownProps {
  data: RegionDetail["hotelGroupBreakdown"];
}

export function HotelGroupBreakdown({ data }: HotelGroupBreakdownProps) {
  if (data.length === 0) {
    return <EmptyState message="No hotel groups in this region" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Hotel Group</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Transactions</TableHead>
            <TableHead className="text-right">Hotels</TableHead>
            <TableHead className="text-right">Avg Rev / Hotel</TableHead>
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
                {formatNumber(row.hotelCount)}
              </TableCell>
              <TableCell className="text-right">
                {formatCurrency(row.avgRevenuePerHotel)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
