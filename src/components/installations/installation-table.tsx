"use client";

import * as React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { DraggableTableHead } from "@/components/table/draggable-header";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planned: "bg-secondary text-secondary-foreground border-0",
    active: "bg-primary text-primary-foreground border-0",
    complete: "bg-[--color-wk-success] text-foreground border-0",
  };

  const labels: Record<string, string> = {
    planned: "Planned",
    active: "Active",
    complete: "Complete",
  };

  return (
    <Badge className={styles[status] ?? styles.planned}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columns: ColumnDef<InstallationWithRelations>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/installations/${row.original.id}`}
        className="font-medium text-foreground hover:text-primary hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "region",
    header: "Region",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.region ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "plannedStart",
    header: "Planned Start",
    cell: ({ row }) =>
      row.original.plannedStart ? (
        <span className="text-sm text-muted-foreground">
          {format(row.original.plannedStart, "dd MMM yyyy")}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "plannedEnd",
    header: "Planned End",
    cell: ({ row }) =>
      row.original.plannedEnd ? (
        <span className="text-sm text-muted-foreground">
          {format(row.original.plannedEnd, "dd MMM yyyy")}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    id: "team",
    header: "Team",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.members.length}
      </span>
    ),
  },
  {
    id: "milestones",
    header: "Milestones",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.milestones.length}
      </span>
    ),
  },
];

// ---------------------------------------------------------------------------
// DnD constants
// ---------------------------------------------------------------------------

const DND_MODIFIERS = [restrictToHorizontalAxis];

// ---------------------------------------------------------------------------
// InstallationTable
// ---------------------------------------------------------------------------

interface InstallationTableProps {
  data: InstallationWithRelations[];
}

export function InstallationTable({ data }: InstallationTableProps) {
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() =>
    columns.map((c) => ("accessorKey" in c ? String(c.accessorKey) : c.id ?? ""))
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const table = useReactTable({
    data,
    columns,
    state: { columnSizing, columnOrder },
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    enableColumnResizing: true,
    columnResizeMode: "onEnd",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const handleColumnDragEnd = React.useCallback(
    (event: import("@dnd-kit/core").DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const currentOrder = table.getState().columnOrder;
        const oldIndex = currentOrder.indexOf(active.id as string);
        const newIndex = currentOrder.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          setColumnOrder(arrayMove(currentOrder, oldIndex, newIndex));
        }
      }
    },
    [table, setColumnOrder]
  );

  const hasData = data.length > 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {!hasData ? (
        <EmptyState
          icon={Package}
          title="No installations yet"
          description="Create an installation to start planning deployment timelines."
          action={
            <Link href="/installations/new">
              <Button size="sm">
                <Plus className="size-4" />
                Add installation
              </Button>
            </Link>
          }
        />
      ) : (
        <DndContext
          id="installation-table-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={DND_MODIFIERS}
          onDragEnd={handleColumnDragEnd}
        >
        <Table className="table-fixed" style={{ width: `max(100%, ${table.getCenterTotalSize()}px)` }}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="bg-muted hover:bg-muted border-b border-border"
              >
                <SortableContext
                  items={headerGroup.headers.map((h) => h.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {headerGroup.headers.map((header) => (
                    <DraggableTableHead key={header.id} header={header} />
                  ))}
                </SortableContext>
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="transition-colors hover:bg-primary/10"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className="py-2.5"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </DndContext>
      )}
    </div>
  );
}
