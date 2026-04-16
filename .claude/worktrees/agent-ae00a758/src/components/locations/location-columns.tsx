"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import type { LocationListItem } from "@/app/(app)/locations/actions";
import { EditableCell } from "@/components/table/editable-cell";
import { ColumnHeaderFilter } from "@/components/table/column-header-filter";

export const locationColumns: ColumnDef<LocationListItem>[] = [
  // 1. Select
  {
    id: "select",
    enableHiding: false,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(Boolean(checked))
        }
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => {
      if (row.getIsGrouped()) return null;
      return (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      );
    },
  },
  // 2. Name — non-editable (primary identifier link), has header filter
  {
    accessorKey: "name",
    enableSorting: true,
    enableColumnFilter: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/locations/${row.original.id}`}
        className="font-medium text-wk-azure hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.getValue("name")}
      </Link>
    ),
  },
  // 3. Address — editable
  {
    accessorKey: "address",
    header: "Address",
    enableSorting: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.address}
        rowId={row.original.id}
        columnId="address"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 4. Hotel Group — editable, has header filter
  {
    accessorKey: "hotelGroup",
    enableSorting: true,
    enableColumnFilter: true,
    enableGrouping: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Hotel Group" />
    ),
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.hotelGroup}
        rowId={row.original.id}
        columnId="hotelGroup"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 5. Star Rating — non-editable (special star rendering, leave for detail)
  {
    accessorKey: "starRating",
    header: "Rating",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ getValue }) => {
      const val = getValue() as number | null;
      if (!val) return <span className="text-wk-mid-grey">N/A</span>;
      return (
        <span className="text-wk-gold" aria-label={`${val} stars`}>
          {"★".repeat(val)}{"☆".repeat(5 - val)}
        </span>
      );
    },
  },
  // 6. Room Count — editable (number)
  {
    accessorKey: "roomCount",
    header: "Rooms",
    enableSorting: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.roomCount}
        rowId={row.original.id}
        columnId="roomCount"
        table={table}
        type="number"
        placeholder="—"
      />
    ),
  },
  // 7. Kiosk Count — non-editable (computed)
  {
    accessorKey: "kioskCount",
    header: "Kiosks",
    enableSorting: true,
    cell: ({ getValue }) => {
      const val = getValue() as number;
      return val;
    },
  },
  // 8. Created At (hidden by default) — non-editable (system field)
  {
    accessorKey: "createdAt",
    header: "Created",
    enableSorting: true,
    enableHiding: true,
    cell: ({ getValue }) => {
      const val = getValue() as Date | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return new Date(val).toLocaleDateString();
    },
  },
];

// Default hidden columns
export const locationDefaultColumnVisibility: Record<string, boolean> = {
  createdAt: false,
};

// Groupable columns for toolbar
export const locationGroupableColumns = [
  { id: "hotelGroup", label: "Hotel Group" },
  { id: "starRating", label: "Star Rating" },
];

// Filterable columns for toolbar
export const locationFilterableColumns = [
  { id: "name", label: "Name" },
  { id: "hotelGroup", label: "Hotel Group" },
];
