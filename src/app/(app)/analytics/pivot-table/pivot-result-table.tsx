"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PivotResponse } from "@/lib/analytics/types";

type PivotResultTableProps = {
  data: PivotResponse;
};

export function PivotResultTable({ data }: PivotResultTableProps) {
  if (data.rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No results. Adjust your fields or filters and run the pivot again.
      </div>
    );
  }

  // Determine which columns are dimension headers vs value headers
  // by checking what keys the first row has
  const firstRow = data.rows[0];
  const dimensionKeys = Object.keys(firstRow.dimensions);
  const cellKeys = Object.keys(firstRow.cells);

  return (
    <div className="space-y-2">
      {data.truncated && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Results truncated to {data.rowCount.toLocaleString()} rows. Add more
          filters or dimensions to narrow the results.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {dimensionKeys.map((key) => (
                <TableHead
                  key={key}
                  className="whitespace-nowrap text-xs font-semibold"
                >
                  {data.headers[dimensionKeys.indexOf(key)] ?? key}
                </TableHead>
              ))}
              {cellKeys.map((key) => (
                <TableHead
                  key={key}
                  className="whitespace-nowrap text-right text-xs font-semibold"
                >
                  {/* Find matching header or use key */}
                  {data.headers.find((h) => h === key) ??
                    data.headers[dimensionKeys.length + cellKeys.indexOf(key)] ??
                    key}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {data.rows.map((row, rowIdx) => (
              <TableRow key={rowIdx}>
                {dimensionKeys.map((key) => (
                  <TableCell
                    key={key}
                    className="whitespace-nowrap text-xs"
                  >
                    {row.dimensions[key] ?? "—"}
                  </TableCell>
                ))}
                {cellKeys.map((key) => {
                  const cell = row.cells[key];
                  const isChange = key.endsWith("_change");
                  const changeColor = cell
                    ? cell.value > 0
                      ? "text-green-700"
                      : cell.value < 0
                        ? "text-red-700"
                        : ""
                    : "";
                  return (
                    <TableCell
                      key={key}
                      className={`whitespace-nowrap text-right text-xs tabular-nums ${
                        isChange ? changeColor : ""
                      }`}
                    >
                      {cell?.formatted ?? "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}

            {/* Grand Totals Row */}
            <TableRow className="border-t-2 bg-muted/30 font-semibold">
              <TableCell
                colSpan={dimensionKeys.length}
                className="text-xs"
              >
                Grand Total
              </TableCell>
              {cellKeys.map((key) => {
                // Match grand total by the base key (strip column prefix for crosstab)
                const gt = data.grandTotals[key];
                return (
                  <TableCell
                    key={key}
                    className="whitespace-nowrap text-right text-xs tabular-nums"
                  >
                    {gt?.formatted ?? "—"}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="text-right text-[10px] text-muted-foreground">
        {data.rowCount.toLocaleString()} row{data.rowCount !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
