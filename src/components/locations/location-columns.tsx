"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { LocationListItem } from "@/app/(app)/locations/actions";
import { EditableCell } from "@/components/table/editable-cell";
import { ColumnHeaderFilter } from "@/components/table/column-header-filter";

export const locationColumns: ColumnDef<LocationListItem>[] = [
  // 1. Select
  {
    id: "select",
    size: 40,
    minSize: 40,
    maxSize: 40,
    enableHiding: false,
    enableSorting: false,
    enableResizing: false,
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
    size: 220,
    enableSorting: true,
    enableColumnFilter: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/locations/${row.original.id}`}
        className="font-medium text-wk-azure hover:underline truncate block"
        onClick={(e) => e.stopPropagation()}
        title={row.getValue("name") as string}
      >
        {row.getValue("name")}
      </Link>
    ),
  },
  // 3. Hotel Group — editable, groupable, has header filter
  {
    accessorKey: "hotelGroup",
    size: 140,
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
  // 4. Star Rating — non-editable (special star rendering)
  {
    accessorKey: "starRating",
    size: 80,
    header: "Stars",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ getValue }) => {
      const val = getValue() as number | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return (
        <span className="text-wk-gold" aria-label={`${val} stars`}>
          {"★".repeat(val)}{"☆".repeat(5 - val)}
        </span>
      );
    },
  },
  // 5. Room Count — editable (number)
  {
    accessorKey: "roomCount",
    size: 80,
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
  // 6. Kiosk Count — non-editable (computed)
  {
    accessorKey: "kioskCount",
    size: 70,
    header: "Kiosks",
    enableSorting: true,
    cell: ({ getValue }) => {
      const val = getValue() as number;
      return val;
    },
  },
  // 7. Address — editable, truncated with tooltip
  {
    accessorKey: "address",
    size: 180,
    header: "Address",
    enableSorting: true,
    cell: ({ row, table }) => {
      const val = row.original.address;
      return (
        <div className="max-w-[200px] truncate" title={val ?? undefined}>
          <EditableCell
            value={val}
            rowId={row.original.id}
            columnId="address"
            table={table}
            placeholder="—"
          />
        </div>
      );
    },
  },
  // 8. Sourced By — editable
  {
    accessorKey: "sourcedBy",
    size: 110,
    header: "Sourced By",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.sourcedBy}
        rowId={row.original.id}
        columnId="sourcedBy"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 9. Status — badge display
  {
    accessorKey: "status",
    size: 90,
    header: "Status",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ getValue }) => {
      const val = getValue() as string | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return (
        <Badge variant="secondary" className="capitalize">
          {val}
        </Badge>
      );
    },
  },
  // 10. Maintenance Fee — editable, currency display
  {
    accessorKey: "maintenanceFee",
    size: 110,
    header: "Maint. Fee",
    enableSorting: true,
    cell: ({ row, table }) => {
      const val = row.original.maintenanceFee;
      const display = val ? `£${val}` : null;
      return (
        <EditableCell
          value={display ?? val}
          rowId={row.original.id}
          columnId="maintenanceFee"
          table={table}
          placeholder="—"
        />
      );
    },
  },
  // 11. Customer Code — editable
  {
    accessorKey: "customerCode",
    size: 110,
    header: "Customer Code",
    enableSorting: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.customerCode}
        rowId={row.original.id}
        columnId="customerCode"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 12. Key Contact — non-editable in table (edit via detail page)
  {
    accessorKey: "keyContactName",
    size: 130,
    header: "Key Contact",
    enableSorting: true,
    cell: ({ getValue }) => {
      const val = getValue() as string | null;
      return val ?? <span className="text-wk-mid-grey">—</span>;
    },
  },
  // 13. Region — editable, groupable
  {
    accessorKey: "region",
    size: 90,
    header: "Region",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.region}
        rowId={row.original.id}
        columnId="region"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 14. Location Group — editable, groupable
  {
    accessorKey: "locationGroup",
    size: 120,
    header: "Location Group",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.locationGroup}
        rowId={row.original.id}
        columnId="locationGroup"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 15. Internal POC — user reference
  {
    accessorKey: "internalPocName",
    size: 120,
    header: "Internal POC",
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.internalPocName ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
  // Hidden system columns
  {
    accessorKey: "createdAt",
    size: 100,
    header: "Created",
    enableSorting: true,
    enableHiding: true,
    cell: ({ getValue }) => {
      const val = getValue() as Date | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return new Date(val).toLocaleDateString("en-GB");
    },
  },
  {
    accessorKey: "archivedAt",
    size: 100,
    header: "Archived",
    enableSorting: true,
    enableHiding: true,
    cell: ({ getValue }) => {
      const val = getValue() as Date | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return new Date(val).toLocaleDateString("en-GB");
    },
  },
];

// Default hidden columns — hide only system/audit fields
export const locationDefaultColumnVisibility: Record<string, boolean> = {
  createdAt: false,
  archivedAt: false,
};

// Groupable columns for toolbar
export const locationGroupableColumns = [
  { id: "hotelGroup", label: "Hotel Group" },
  { id: "starRating", label: "Star Rating" },
  { id: "sourcedBy", label: "Sourced By" },
  { id: "status", label: "Status" },
  { id: "region", label: "Region" },
  { id: "locationGroup", label: "Location Group" },
];

// Filterable columns for toolbar
export const locationFilterableColumns = [
  { id: "name", label: "Name" },
  { id: "hotelGroup", label: "Hotel Group" },
  { id: "status", label: "Status" },
  { id: "region", label: "Region" },
];
