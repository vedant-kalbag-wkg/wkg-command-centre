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
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
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
    globalFilter,
    rowSelection,
    setColumnFilters,
    setSorting,
    setGrouping,
    setColumnVisibility,
    setGlobalFilter,
    setRowSelection,
  } = useLocationViewStore();

  // Merge default column visibility with store state
  const mergedVisibility = React.useMemo(
    () => ({ ...locationDefaultColumnVisibility, ...columnVisibility }),
    [columnVisibility]
  );

  const table = useReactTable({
    data,
    columns: locationColumns,
    state: {
      columnFilters,
      sorting,
      grouping,
      columnVisibility: mergedVisibility,
      globalFilter,
      rowSelection,
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
      <div className="mt-2 rounded-lg border border-wk-mid-grey overflow-hidden">
        {!hasData ? (
          /* Empty state — no records */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-wk-graphite">
              No locations yet
            </h3>
            <p className="mt-1 text-sm text-wk-night-grey">
              Add your first location to assign kiosks to venues.
            </p>
            <Link href="/locations/new" className="mt-4">
              <Button className="bg-wk-azure text-white hover:bg-wk-azure/90">
                <Plus className="mr-1.5 h-4 w-4" />
                Add location
              </Button>
            </Link>
          </div>
        ) : !hasFilteredRows ? (
          /* Empty state — filters applied, no results */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-wk-graphite">
              No locations match your filters
            </h3>
            <p className="mt-1 text-sm text-wk-night-grey">
              Try adjusting or clearing your filters to see more results.
            </p>
            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  useLocationViewStore.getState().resetToDefaults();
                }}
                className="mt-4 text-sm text-wk-azure hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="bg-wk-light-grey hover:bg-wk-light-grey border-b border-wk-mid-grey"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="text-xs font-medium text-wk-graphite uppercase tracking-wide cursor-pointer select-none"
                        onClick={header.column.getToggleSortingHandler()}
                        style={{
                          width: header.column.id === "select" ? 40 : undefined,
                        }}
                      >
                        {header.isPlaceholder ? null : (
                          <span className="inline-flex items-center gap-1">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getIsSorted() === "asc" && " ↑"}
                            {header.column.getIsSorted() === "desc" && " ↓"}
                          </span>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  if (row.getIsGrouped()) {
                    return (
                      <TableRow
                        key={row.id}
                        className="bg-wk-light-grey/50 hover:bg-wk-light-grey cursor-pointer"
                        onClick={() => row.toggleExpanded()}
                      >
                        <TableCell
                          colSpan={locationColumns.length}
                          className="py-2 px-3"
                        >
                          <span className="inline-flex items-center gap-2 font-medium text-sm text-wk-graphite">
                            {row.getIsExpanded() ? (
                              <ChevronDown className="h-4 w-4 text-wk-night-grey" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-wk-night-grey" />
                            )}
                            {row.groupingValue as string ?? "—"}
                            <span className="text-xs text-wk-night-grey font-normal">
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
                          ? "bg-[var(--color-wk-azure-20)] hover:bg-[var(--color-wk-azure-20)]"
                          : "hover:bg-wk-sky-blue"
                        }
                      `}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-2.5">
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

            {/* Pagination */}
            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-wk-mid-grey">
                <span className="text-xs text-wk-night-grey">
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
        onClearSelection={() => table.resetRowSelection()}
        table={table}
        csvFileName="locations"
      />
    </>
  );
}
