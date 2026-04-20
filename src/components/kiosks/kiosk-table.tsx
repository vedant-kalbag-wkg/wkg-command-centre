"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  flexRender,
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
import { ChevronRight, ChevronDown, LayoutGrid, Plus } from "lucide-react";
import { DraggableTableHead } from "@/components/table/draggable-header";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import { updateKioskField, listKioskPocCandidates } from "@/app/(app)/kiosks/actions";
import { bulkUpdateKiosks, bulkArchiveKiosks } from "@/app/(app)/kiosks/bulk-actions";
import {
  saveView,
  listSavedViews,
  updateView,
  deleteView,
} from "@/app/(app)/kiosks/views-actions";
import { useKioskViewStore } from "@/lib/stores/view-engine-store";
import { BulkToolbar } from "@/components/table/bulk-toolbar";
import { MergeDialog } from "@/components/table/merge-dialog";
import { mergeKiosksAction } from "@/app/(app)/kiosks/merge-action";
import {
  makeKioskColumns,
  kioskDefaultColumnVisibility,
  kioskGroupableColumns,
  kioskFilterableColumns,
} from "@/components/kiosks/kiosk-columns";
import type { EditableCellOption } from "@/components/table/editable-cell";
import { ViewToolbar } from "@/components/table/view-toolbar";
import { SavedViewsBar } from "@/components/table/saved-views-bar";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

const DND_MODIFIERS = [restrictToHorizontalAxis];

interface KioskTableProps {
  data: KioskListItem[];
}

export function KioskTable({ data }: KioskTableProps) {
  const router = useRouter();
  const store = useKioskViewStore;

  // Load POC (assignee) user options once for the Internal POC inline-edit.
  const [pocOptions, setPocOptions] = React.useState<EditableCellOption[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    listKioskPocCandidates().then((users) => {
      if (cancelled) return;
      setPocOptions(users.map((u) => ({ value: u.id, label: u.name || u.email })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = React.useMemo(
    () => makeKioskColumns(pocOptions),
    [pocOptions]
  );

  const {
    columnFilters,
    sorting,
    grouping,
    columnVisibility,
    columnSizing,
    columnOrder,
    globalFilter,
    rowSelection,
    setColumnFilters,
    setSorting,
    setGrouping,
    setColumnVisibility,
    setColumnSizing,
    setColumnOrder,
    setGlobalFilter,
    setRowSelection,
  } = useKioskViewStore();

  // Merge default column visibility with store state
  const mergedVisibility = React.useMemo(
    () => ({ ...kioskDefaultColumnVisibility, ...columnVisibility }),
    [columnVisibility]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Initialize column order from column definitions if store is empty
  const effectiveColumnOrder = columnOrder.length > 0
    ? columnOrder
    : columns.map((c) => ("accessorKey" in c ? String(c.accessorKey) : c.id ?? ""));

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      sorting,
      grouping,
      columnVisibility: mergedVisibility,
      columnSizing,
      columnOrder: effectiveColumnOrder,
      globalFilter,
      rowSelection,
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onEnd",
    initialState: {
      pagination: { pageSize: 50 },
    },
    enableRowSelection: true,
    enableGrouping: true,
    autoResetPageIndex: false,
    meta: {
      updateField: async (rowId: string, columnId: string, value: string | null) => {
        const row = data.find((d) => d.id === rowId);
        const oldValue = row ? String((row as Record<string, unknown>)[columnId] ?? "") : undefined;
        const result = await updateKioskField(rowId, columnId, value, oldValue);
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

  const rows = table.getRowModel().rows;
  const hasData = data.length > 0;
  const hasFilteredRows = rows.length > 0;
  const isFiltering =
    columnFilters.length > 0 || globalFilter.length > 0;

  const selectedIds = table
    .getFilteredRowModel()
    .rows.filter((row) => row.getIsSelected() && !row.getIsGrouped())
    .map((row) => row.original.id);
  const selectedCount = selectedIds.length;

  const kioskBulkEditFields = [
    { id: "regionGroup", label: "Region / Group" },
    { id: "cmsConfigStatus", label: "CMS Config", type: "select" as const, options: [
      { value: "configured", label: "Configured" },
      { value: "not_configured", label: "Not configured" },
    ]},
    { id: "deploymentPhaseTags", label: "Deployment Tags" },
  ];

  async function handleBulkUpdate(field: string, value: unknown) {
    const result = await bulkUpdateKiosks(selectedIds, { field, value });
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Updated ${result.count} kiosks`);
      table.resetRowSelection();
      router.refresh();
    }
  }

  async function handleBulkArchive(ids: string[]) {
    const result = await bulkArchiveKiosks(ids);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Archived ${result.count} kiosks`);
      table.resetRowSelection();
      router.refresh();
    }
  }

  const [mergeOpen, setMergeOpen] = React.useState(false);
  const selectedRecords = table
    .getFilteredRowModel()
    .rows.filter((row) => row.getIsSelected() && !row.getIsGrouped())
    .map((row) => row.original);

  const kioskMergeFields = [
    { key: "kioskId", label: "Kiosk ID" },
    { key: "outletCode", label: "Outlet Code" },
    { key: "hardwareSerialNumber", label: "Asset / Serial Number" },
    { key: "hardwareModel", label: "Hardware Model" },
    { key: "softwareVersion", label: "Software Version" },
    { key: "cmsConfigStatus", label: "CMS Config" },
    { key: "regionGroup", label: "Region" },
  ];

  return (
    <>
    <div className="flex flex-col gap-0">
      {/* Toolbar */}
      <ViewToolbar
        table={table}
        viewStore={store}
        entityType="kiosk"
        groupableColumns={kioskGroupableColumns}
        filterableColumns={kioskFilterableColumns}
        csvFileName="kiosks"
      />

      {/* Saved Views Bar */}
      <SavedViewsBar
        viewStore={store}
        entityType="kiosk"
        saveAction={saveView}
        listAction={listSavedViews}
        updateAction={updateView}
        deleteAction={deleteView}
      />

      {/* Table */}
      <div className="mt-2 rounded-lg border border-border overflow-x-auto">
        {!hasData ? (
          /* Empty state — no records */
          <EmptyState
            icon={LayoutGrid}
            title="No kiosks yet"
            description="Add your first kiosk to start tracking deployments."
            action={
              <Link href="/kiosks/new">
                <Button size="sm">
                  <Plus className="size-4" />
                  Add kiosk
                </Button>
              </Link>
            }
          />
        ) : !hasFilteredRows ? (
          /* Empty state — filters applied, no results */
          <EmptyState
            icon={LayoutGrid}
            title="No kiosks match your filters"
            description="Try adjusting or clearing your filters to see more results."
            action={
              isFiltering ? (
                <button
                  type="button"
                  onClick={() => {
                    useKioskViewStore.getState().resetToDefaults();
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <DndContext
              id="kiosk-table-dnd"
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
                {rows.map((row) => {
                  if (row.getIsGrouped()) {
                    return (
                      <TableRow
                        key={row.id}
                        className="bg-muted/50 hover:bg-muted cursor-pointer"
                        onClick={() => row.toggleExpanded()}
                      >
                        <TableCell
                          colSpan={columns.length}
                          className="py-2 px-3"
                        >
                          <span className="inline-flex items-center gap-2 font-medium text-sm text-foreground">
                            {row.getIsExpanded() ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            {row.groupingValue as string ?? "—"}
                            <span className="text-xs text-muted-foreground font-normal">
                              ({row.subRows.length})
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow
                      key={row.id}
                      className={`
                        transition-colors min-h-[44px]
                        ${row.getIsSelected()
                          ? "bg-primary/20 hover:bg-primary/20"
                          : "hover:bg-primary/10"
                        }
                      `}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="py-2.5"
                          style={{ width: cell.column.getSize() }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </DndContext>

            {/* Pagination */}
            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Page {table.getState().pagination.pageIndex + 1} of{" "}
                  {table.getPageCount()} — {table.getFilteredRowModel().rows.length} total
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="h-8 text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="h-8 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>

      {/* Bulk action toolbar */}
      <BulkToolbar
        selectedCount={selectedCount}
        selectedIds={selectedIds}
        entityType="kiosk"
        bulkEditFields={kioskBulkEditFields}
        onBulkUpdate={handleBulkUpdate}
        onBulkArchive={handleBulkArchive}
        onMerge={() => setMergeOpen(true)}
        onClearSelection={() => table.resetRowSelection()}
        table={table}
        csvFileName="kiosks"
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        records={selectedRecords}
        fields={kioskMergeFields}
        getFieldValue={(r, k) => String((r as Record<string, unknown>)[k] ?? "")}
        getId={(r) => r.id}
        getName={(r) => r.kioskId}
        onMerge={mergeKiosksAction}
        onSuccess={() => { table.resetRowSelection(); router.refresh(); }}
        entityLabel="kiosk"
      />
    </>
  );
}
