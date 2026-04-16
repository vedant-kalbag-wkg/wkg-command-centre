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
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import { updateKioskField } from "@/app/(app)/kiosks/actions";
import { bulkUpdateKiosks, bulkArchiveKiosks } from "@/app/(app)/kiosks/bulk-actions";
import {
  saveView,
  listSavedViews,
  updateView,
  deleteView,
} from "@/app/(app)/kiosks/views-actions";
import { useKioskViewStore } from "@/lib/stores/view-engine-store";
import { BulkToolbar } from "@/components/table/bulk-toolbar";
import {
  kioskColumns,
  kioskDefaultColumnVisibility,
  kioskGroupableColumns,
  kioskFilterableColumns,
} from "@/components/kiosks/kiosk-columns";
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

interface KioskTableProps {
  data: KioskListItem[];
}

export function KioskTable({ data }: KioskTableProps) {
  const router = useRouter();
  const store = useKioskViewStore;

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
  } = useKioskViewStore();

  // Merge default column visibility with store state
  const mergedVisibility = React.useMemo(
    () => ({ ...kioskDefaultColumnVisibility, ...columnVisibility }),
    [columnVisibility]
  );

  const table = useReactTable({
    data,
    columns: kioskColumns,
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
    // Prevent autoResetPageIndex from firing a microtask-queued setState during
    // the render phase. In React Strict Mode, the component fiber hasn't committed
    // on the first (discarded) render pass, so any setState queued via Promise
    // microtask at that point triggers "Can't perform state update on unmounted
    // component". Since we control pagination via initialState and explicit
    // navigation, we don't need TanStack to auto-reset page index.
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
      <div className="mt-2 rounded-lg border border-wk-mid-grey overflow-hidden">
        {!hasData ? (
          /* Empty state — no records */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-wk-graphite">
              No kiosks yet
            </h3>
            <p className="mt-1 text-sm text-wk-night-grey">
              Add your first kiosk to start tracking deployments.
            </p>
            <Link href="/kiosks/new" className="mt-4">
              <Button className="bg-wk-azure text-white hover:bg-wk-azure/90">
                <Plus className="mr-1.5 h-4 w-4" />
                Add kiosk
              </Button>
            </Link>
          </div>
        ) : !hasFilteredRows ? (
          /* Empty state — filters applied, no results */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-base font-semibold text-wk-graphite">
              No kiosks match your filters
            </h3>
            <p className="mt-1 text-sm text-wk-night-grey">
              Try adjusting or clearing your filters to see more results.
            </p>
            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  useKioskViewStore.getState().resetToDefaults();
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
                          colSpan={kioskColumns.length}
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
        entityType="kiosk"
        bulkEditFields={kioskBulkEditFields}
        onBulkUpdate={handleBulkUpdate}
        onBulkArchive={handleBulkArchive}
        onClearSelection={() => table.resetRowSelection()}
        table={table}
        csvFileName="kiosks"
      />
    </>
  );
}
