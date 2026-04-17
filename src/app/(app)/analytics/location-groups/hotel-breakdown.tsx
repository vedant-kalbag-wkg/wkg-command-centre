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
import type { HotelInGroup } from "@/lib/analytics/types";

interface HotelBreakdownProps {
  hotels: HotelInGroup[];
}

export function HotelBreakdown({ hotels }: HotelBreakdownProps) {
  if (hotels.length === 0) {
    return <EmptyState message="No hotels in this group" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Hotel</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Transactions</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Rooms</TableHead>
            <TableHead className="text-right">Stars</TableHead>
            <TableHead className="text-right">Rev / Room</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hotels.map((hotel) => (
            <TableRow key={hotel.locationId}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{hotel.hotelName}</span>
                  {hotel.outletCode && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {hotel.outletCode}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {formatCurrency(hotel.revenue)}
              </TableCell>
              <TableCell className="text-right">
                {formatNumber(hotel.transactions)}
              </TableCell>
              <TableCell className="text-right">
                {formatNumber(hotel.quantity)}
              </TableCell>
              <TableCell className="text-right">
                {formatNullValue(hotel.rooms, formatNumber)}
              </TableCell>
              <TableCell className="text-right">
                {formatNullValue(hotel.starRating, formatNumber)}
              </TableCell>
              <TableCell className="text-right">
                {formatNullValue(hotel.revenuePerRoom, formatCurrency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
