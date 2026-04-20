"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import {
  updateInstallationField,
  listInstallationPocCandidates,
} from "@/app/(app)/installations/actions";
import {
  EditableCell,
  type EditableCellOption,
} from "@/components/table/editable-cell";

// ---------------------------------------------------------------------------
// Status options (enum on installations.status)
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: EditableCellOption[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "complete", label: "Complete" },
];

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function makeColumns(
  pocOptions: EditableCellOption[]
): ColumnDef<InstallationWithRelations>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
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
            href={`/installations/${row.original.id}`}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-primary hover:underline"
            aria-label={`Open ${row.original.name}`}
            title="Open detail"
          >
            open
          </Link>
        </div>
      ),
    },
    {
      accessorKey: "region",
      header: "Region",
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
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row, table }) => (
        <EditableCell
          value={row.original.status}
          rowId={row.original.id}
          columnId="status"
          table={table}
          type="select"
          options={STATUS_OPTIONS}
          placeholder="planned"
        />
      ),
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
    // Internal POC / assignee — inline-editable user picker
    {
      accessorKey: "internalPocId",
      header: "Internal POC",
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
}

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
  const router = useRouter();
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});

  const [pocOptions, setPocOptions] = React.useState<EditableCellOption[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    listInstallationPocCandidates().then((users) => {
      if (cancelled) return;
      setPocOptions(
        users.map((u) => ({ value: u.id, label: u.name || u.email }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = React.useMemo(() => makeColumns(pocOptions), [pocOptions]);

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
    meta: {
      updateField: async (rowId, columnId, value) => {
        const row = data.find((d) => d.id === rowId);
        const oldValue = row
          ? String((row as Record<string, unknown>)[columnId] ?? "")
          : undefined;
        const result = await updateInstallationField(
          rowId,
          columnId,
          value,
          oldValue
        );
        if ("error" in result) {
          toast.error(result.error);
        } else {
          router.refresh();
        }
      },
    },
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
