"use client";

import * as React from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { Layers } from "lucide-react";
import type { ConfigGroupListItem } from "@/app/(app)/kiosk-config-groups/actions";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

interface ConfigGroupsTableProps {
  data: ConfigGroupListItem[];
}

const columnHelper = createColumnHelper<ConfigGroupListItem>();

export function ConfigGroupsTable({ data }: ConfigGroupsTableProps) {
  const columns = React.useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Group Name",
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("productAvailability", {
        header: "Product Availability",
        cell: (info) => {
          const count = info.getValue();
          return count === 0 ? (
            <span className="text-muted-foreground tabular-nums">0</span>
          ) : (
            <span className="tabular-nums">{count}</span>
          );
        },
      }),
      columnHelper.accessor("hotelCount", {
        header: "Hotels",
        cell: ({ getValue, row }) => {
          const count = getValue();
          return count > 0 ? (
            <Link
              href={`/locations?kioskConfigGroup=${row.original.id}`}
              className={buttonVariants({ variant: "link" })}
            >
              {count}
            </Link>
          ) : (
            <span className="text-muted-foreground tabular-nums">0</span>
          );
        },
      }),
      columnHelper.accessor("kioskCount", {
        header: "Kiosks",
        cell: ({ getValue, row }) => {
          const count = getValue();
          return count > 0 ? (
            <Link
              href={`/kiosks?kioskConfigGroup=${row.original.id}`}
              className={buttonVariants({ variant: "link" })}
            >
              {count}
            </Link>
          ) : (
            <span className="text-muted-foreground tabular-nums">0</span>
          );
        },
      }),
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const hasData = data.length > 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {!hasData ? (
        <EmptyState
          icon={Layers}
          title="No config groups yet"
          description="Kiosk Config Groups are imported from your Monday.com board. Run an import to populate this list."
        />
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
