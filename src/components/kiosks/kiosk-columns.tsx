"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import { EditableCell } from "@/components/table/editable-cell";
import { ColumnHeaderFilter } from "@/components/table/column-header-filter";

export const kioskColumns: ColumnDef<KioskListItem>[] = [
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
  // 2. Asset (Hardware Serial Number) — primary identifier link per MIGR-12
  {
    accessorKey: "hardwareSerialNumber",
    size: 160,
    enableSorting: true,
    enableColumnFilter: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Asset" />
    ),
    cell: ({ row }) => {
      const val = row.original.hardwareSerialNumber;
      return (
        <Link
          href={`/kiosks/${row.original.id}`}
          className="font-medium text-wk-azure hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {val ?? <span className="text-wk-mid-grey">—</span>}
        </Link>
      );
    },
  },
  // 3. Outlet Code — editable
  {
    accessorKey: "outletCode",
    size: 120,
    header: "Outlet Code",
    enableSorting: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.outletCode}
        rowId={row.original.id}
        columnId="outletCode"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 4. Venue Name — non-editable (managed via assignment flow), has header filter
  {
    accessorKey: "venueName",
    size: 200,
    enableSorting: true,
    enableColumnFilter: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Venue" />
    ),
    cell: ({ getValue }) => {
      const val = getValue() as string | null;
      return val ? (
        <span className="truncate block" title={val}>{val}</span>
      ) : (
        <span className="text-wk-mid-grey">Unassigned</span>
      );
    },
  },
  // 5. Region Group — editable, has header filter
  {
    accessorKey: "regionGroup",
    size: 100,
    enableSorting: true,
    enableColumnFilter: true,
    enableGrouping: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Region" />
    ),
    cell: ({ row, table }) => {
      const val = row.original.regionGroup;
      if (!val) {
        return (
          <EditableCell
            value={val}
            rowId={row.original.id}
            columnId="regionGroup"
            table={table}
            placeholder="—"
          />
        );
      }
      // Show badge but also allow editing
      return (
        <EditableCell
          value={val}
          rowId={row.original.id}
          columnId="regionGroup"
          table={table}
          placeholder="—"
        />
      );
    },
  },
  // 6. Pipeline Stage — non-editable (managed via Kanban/detail), has header filter
  {
    accessorKey: "pipelineStageName",
    size: 140,
    enableSorting: true,
    enableColumnFilter: true,
    enableGrouping: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Stage" />
    ),
    cell: ({ row }) => {
      const name = row.original.pipelineStageName;
      const color = row.original.pipelineStageColor;
      if (!name) return <span className="text-wk-mid-grey">—</span>;
      return (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color ?? "#ADADAD" }}
          />
          <span className="text-sm">{name}</span>
        </span>
      );
    },
  },
  // 7. CMS Config Status — non-editable (special badge rendering)
  {
    accessorKey: "cmsConfigStatus",
    size: 120,
    header: "CMS Config",
    enableSorting: true,
    enableGrouping: true,
    cell: ({ getValue }) => {
      const val = getValue() as string | null;
      if (val === "configured") {
        return (
          <Badge className="bg-wk-success/10 text-wk-success border-wk-success/20">
            Configured
          </Badge>
        );
      }
      return <span className="text-xs text-wk-night-grey">Not configured</span>;
    },
  },
  // 8. Installation Date — non-editable (date field, leave for detail page)
  {
    accessorKey: "installationDate",
    size: 110,
    header: "Install Date",
    enableSorting: true,
    cell: ({ getValue }) => {
      const val = getValue() as Date | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return new Date(val).toLocaleDateString("en-GB");
    },
  },
  // 9. Kiosk ID — non-editable (hidden by default, kioskId visible via column toggle), has header filter
  {
    accessorKey: "kioskId",
    size: 140,
    enableSorting: true,
    enableColumnFilter: true,
    enableHiding: true,
    header: ({ column }) => (
      <ColumnHeaderFilter column={column} label="Kiosk ID" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/kiosks/${row.original.id}`}
        className="font-medium text-wk-azure hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.getValue("kioskId")}
      </Link>
    ),
  },
  // 10. Hardware Model (hidden by default) — editable
  {
    accessorKey: "hardwareModel",
    size: 130,
    header: "Hardware",
    enableSorting: true,
    enableHiding: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.hardwareModel}
        rowId={row.original.id}
        columnId="hardwareModel"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 11. Software Version (hidden by default) — editable
  {
    accessorKey: "softwareVersion",
    size: 120,
    header: "Software",
    enableSorting: true,
    enableHiding: true,
    cell: ({ row, table }) => (
      <EditableCell
        value={row.original.softwareVersion}
        rowId={row.original.id}
        columnId="softwareVersion"
        table={table}
        placeholder="—"
      />
    ),
  },
  // 12. Maintenance Fee (hidden by default) — non-editable (currency, leave for detail)
  {
    accessorKey: "maintenanceFee",
    size: 90,
    header: "Fee",
    enableSorting: true,
    enableHiding: true,
    cell: ({ getValue }) => {
      const val = getValue() as string | null;
      if (!val) return <span className="text-wk-mid-grey">—</span>;
      return `$${parseFloat(val).toFixed(2)}`;
    },
  },
  // 13. Free Trial Status (hidden by default) — non-editable (boolean)
  {
    accessorKey: "freeTrialStatus",
    size: 90,
    header: "Free Trial",
    enableSorting: true,
    enableHiding: true,
    enableGrouping: true,
    cell: ({ getValue }) => {
      const val = getValue() as boolean | null;
      return val ? "Yes" : "No";
    },
  },
  // 14. Created At (hidden by default) — non-editable (system field)
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
];

// Default hidden columns — visible set per MIGR-12: Asset, Outlet Code, Venue, Region, Stage, CMS Config, Install Date
export const kioskDefaultColumnVisibility: Record<string, boolean> = {
  kioskId: false,
  hardwareModel: false,
  softwareVersion: false,
  maintenanceFee: false,
  freeTrialStatus: false,
  createdAt: false,
};

// Groupable columns for toolbar
export const kioskGroupableColumns = [
  { id: "pipelineStageName", label: "Pipeline Stage" },
  { id: "regionGroup", label: "Region" },
  { id: "cmsConfigStatus", label: "CMS Config" },
  { id: "freeTrialStatus", label: "Free Trial" },
];

// Filterable columns for toolbar
export const kioskFilterableColumns = [
  { id: "kioskId", label: "Kiosk ID" },
  { id: "venueName", label: "Venue" },
  { id: "regionGroup", label: "Region" },
  { id: "pipelineStageName", label: "Stage" },
];
