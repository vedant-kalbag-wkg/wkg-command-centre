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
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import { DraggableTableHead } from "@/components/table/draggable-header";
import Link from "next/link";
import type { LocationListItem } from "@/app/(app)/locations/actions";
import { updateLocationField } from "@/app/(app)/locations/actions";
import { bulkUpdateLocations, bulkArchiveLocations } from "@/app/(app)/locations/bulk-actions";
import {
  saveView,
  listSavedViews,
  updateView,
  deleteView,
} from "@/app/(app)/locations/views-actions";
import { useLocationViewStore } from "@/lib/stores/view-engine-store";
import { BulkToolbar } from "@/components/table/bulk-toolbar";
import { MergeDialog } from "@/components/table/merge-dialog";
import { mergeLocationsAction } from "@/app/(app)/locations/merge-action";
import {
  locationColumns,
  locationDefaultColumnVisibility,
  locationGroupableColumns,
  locationFilterableColumns,
} from "@/components/locations/location-columns";
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

interface LocationTableProps {
  data: LocationListItem[];
}

export function LocationTable({ data }: LocationTableProps) {
  const router = useRouter();
  const store = useLocationViewStore;

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
  } = useLocationViewStore();

  // Merge default column visibility with store state
  const mergedVisibility = React.useMemo(
    () => ({ ...locationDefaultColumnVisibility, ...columnVisibility }),
    [columnVisibility]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const effectiveColumnOrder = columnOrder.length > 0
    ? columnOrder
    : locationColumns.map((c) => ("accessorKey" in c ? String(c.accessorKey) : c.id ?? ""));

  const table = useReactTable({
    data,
    columns: locationColumns,
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
    meta: {
      updateField: async (rowId: string, columnId: string, value: string | null) => {
        const row = data.find((d) => d.id === rowId);
        const oldValue = row ? String((row as Record<string, unknown>)[columnId] ?? "") : undefined;
        const result = await updateLocationField(rowId, columnId, value, oldValue);
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

  const locationBulkEditFields = [
    { id: "hotelGroup", label: "Hotel Group" },
    { id: "sourcedBy", label: "Sourced By" },
  ];

  async function handleBulkUpdate(field: string, value: unknown) {
    const result = await bulkUpdateLocations(selectedIds, { field, value });
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Updated ${result.count} locations`);
      table.resetRowSelection();
      router.refresh();
    }
  }

  async function handleBulkArchive(ids: string[]) {
    const result = await bulkArchiveLocations(ids);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Archived ${result.count} locations`);
      table.resetRowSelection();
      router.refresh();
    }
  }

  // Merge
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const selectedRecords = table
    .getFilteredRowModel()
    .rows.filter((row) => row.getIsSelected() && !row.getIsGrouped())
    .map((row) => row.original);

  const locationMergeFields = [
    { key: "name", label: "Name" },
    { key: "address", label: "Address" },
    { key: "hotelGroup", label: "Hotel Group" },
    { key: "starRating", label: "Star Rating" },
    { key: "roomCount", label: "Rooms" },
    { key: "sourcedBy", label: "Sourced By" },
    { key: "status", label: "Status" },
    { key: "maintenanceFee", label: "Maintenance Fee" },
    { key: "customerCode", label: "Customer Code" },
    { key: "region", label: "Region" },
    { key: "locationGroup", label: "Location Group" },
  ];

  return (
    <>
    <div className="flex flex-col gap-0">
      {/* Toolbar */}
      <ViewToolbar
        table={table}
        viewStore={store}
        entityType="location"
        groupableColumns={locationGroupableColumns}
        filterableColumns={locationFilterableColumns}
        csvFileName="locations"
      />

      {/* Saved Views Bar */}
      <SavedViewsBar
        viewStore={store}
        entityType="location"
        saveAction={saveView}
        listAction={listSavedViews}
        updateAction={updateView}
        deleteAction={deleteView}
      />

      {/* Table */}
      <div className="mt-2 rounded-lg border border-border overflow-x-auto">
        {!hasData ? (
          /* Empty state — no records */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-foreground">
              No locations yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first location to assign kiosks to venues.
            </p>
            <Link href="/locations/new" className="mt-4">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-1.5 h-4 w-4" />
                Add location
              </Button>
            </Link>
          </div>
        ) : !hasFilteredRows ? (
          /* Empty state — filters applied, no results */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-foreground">
              No locations match your filters
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Try adjusting or clearing your filters to see more results.
            </p>
            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  useLocationViewStore.getState().resetToDefaults();
                }}
                className="mt-4 text-sm text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <DndContext
              id="location-table-dnd"
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={DND_MODIFIERS}
              onDragEnd={handleColumnDragEnd}
            >
            <Table className="table-fixed" style={{ width: table.getCenterTotalSize() }}>
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
                          colSpan={locationColumns.length}
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
        entityType="location"
        bulkEditFields={locationBulkEditFields}
        onBulkUpdate={handleBulkUpdate}
        onBulkArchive={handleBulkArchive}
        onMerge={() => setMergeOpen(true)}
        onClearSelection={() => table.resetRowSelection()}
        table={table}
        csvFileName="locations"
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        records={selectedRecords}
        fields={locationMergeFields}
        getFieldValue={(r, k) => String((r as Record<string, unknown>)[k] ?? "")}
        getId={(r) => r.id}
        getName={(r) => r.name}
        onMerge={mergeLocationsAction}
        onSuccess={() => { table.resetRowSelection(); router.refresh(); }}
        entityLabel="location"
      />
    </>
  );
}
