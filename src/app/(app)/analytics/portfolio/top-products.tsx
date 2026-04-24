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
import type { TopProductRow } from "@/lib/analytics/types";

interface TopProductsProps {
  data: TopProductRow[];
  loading?: boolean;
}

export function TopProducts({ data }: TopProductsProps) {
  const metricLabel = useMetricLabel();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">{metricLabel}</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.rank}>
            <TableCell className="text-muted-foreground">{row.rank}</TableCell>
            <TableCell className="font-medium">{row.productName}</TableCell>
            <TableCell className="text-right">
              {formatCurrency(row.revenue)}
            </TableCell>
            <TableCell className="text-right">
              {formatNumber(row.transactions)}
            </TableCell>
            <TableCell className="text-right">
              {formatNumber(row.quantity)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
