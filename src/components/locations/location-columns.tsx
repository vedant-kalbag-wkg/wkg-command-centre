"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import type { LocationListItem } from "@/app/(app)/locations/actions";
import { EditableCell, type EditableCellOption } from "@/components/table/editable-cell";
import { ColumnHeaderFilter } from "@/components/table/column-header-filter";

const STATUS_OPTIONS: EditableCellOption[] = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "churned", label: "Churned" },
];

const STAR_OPTIONS: EditableCellOption[] = [
  { value: "1", label: "★" },
  { value: "2", label: "★★" },
  { value: "3", label: "★★★" },
  { value: "4", label: "★★★★" },
  { value: "5", label: "★★★★★" },
];

export function makeLocationColumns(
  pocOptions: EditableCellOption[] = []
): ColumnDef<LocationListItem>[] {
  return [
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
  // 2. Name — editable, but renders with link affordance via a separate detail-link column-trigger.
  //    We keep the name itself inline-editable (primary spec requirement: all fields editable).
  //    Users can still open the detail page via the dedicated row actions / "View" link.
  {
    accessorKey: "name",
    size: 220,
    enableSorting: true,
    enableColumnFilter: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Name" />
    ),
    cell: ({ row, table }) => (
      <div className="flex items-center gap-2 min-w-0">
        <EditableCell
          value={row.original.name}
          rowId={row.original.id}
          columnId="name"
          table={table}
          placeholder="—"
        />
        <Link
          href={`/locations/${row.original.id}`}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${row.original.name}`}
          title="Open detail"
        >
          open
        </Link>
      </div>
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
  // 4. Star Rating — editable via select (1..5)
  {
    accessorKey: "starRating",
    size: 100,
    header: "Stars",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => {
      const val = row.original.starRating;
      const display =
        typeof val === "number" && val > 0
          ? "★".repeat(val) + "☆".repeat(5 - val)
          : null;
      return (
        <EditableCell
          value={val !== null && val !== undefined ? String(val) : null}
          rowId={row.original.id}
          columnId="starRating"
          table={table}
          type="select"
          options={STAR_OPTIONS}
          displayValue={display}
          placeholder="—"
        />
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
  // 9. Status — editable via select
  {
    accessorKey: "status",
    size: 120,
    header: "Status",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.status}
        rowId={row.original.id}
        columnId="status"
        table={table}
        type="select"
        options={STATUS_OPTIONS}
        placeholder="—"
      />
    ),
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
          value={val}
          rowId={row.original.id}
          columnId="maintenanceFee"
          table={table}
          type="number"
          displayValue={display}
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
  // 12. Key Contact — editable via keyContactName column (denormalised field on
  //    locations table; keyContacts JSONB is still authoritative for full contact detail).
  {
    accessorKey: "keyContactName",
    size: 130,
    header: "Key Contact",
    enableSorting: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.keyContactName}
        rowId={row.original.id}
        columnId="keyContactName"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 13. Location Group — editable, groupable
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
  // 15. Internal POC — editable via user picker (select)
  {
    accessorKey: "internalPocId",
    size: 150,
    header: "Internal POC",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.internalPocId}
        rowId={row.original.id}
        columnId="internalPocId"
        table={table}
        type="select"
        options={pocOptions}
        displayValue={row.original.internalPocName}
        placeholder="Unassigned"
      />
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
      if (!val) return <span className="text-muted-foreground">—</span>;
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
      if (!val) return <span className="text-muted-foreground">—</span>;
      return new Date(val).toLocaleDateString("en-GB");
    },
  },
  ];
}

// Back-compat: export a default column set (no POC options) for any
// callers that don't need the user-picker enrichment.
export const locationColumns: ColumnDef<LocationListItem>[] = makeLocationColumns();

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
  { id: "locationGroup", label: "Location Group" },
  { id: "internalPocId", label: "Internal POC" },
];

// Filterable columns for toolbar
export const locationFilterableColumns = [
  { id: "name", label: "Name" },
  { id: "hotelGroup", label: "Hotel Group" },
  { id: "status", label: "Status" },
];
