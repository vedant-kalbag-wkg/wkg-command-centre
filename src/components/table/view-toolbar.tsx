"use client";

import * as React from "react";
import { Search, Filter, Columns, Download, ChevronDown } from "lucide-react";
import { exportTableToCSV } from "@/components/table/csv-export";
import type { Table, ColumnFiltersState } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useKioskViewStore, useLocationViewStore } from "@/lib/stores/view-engine-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewStore = typeof useKioskViewStore | typeof useLocationViewStore;

interface GroupableColumn {
  id: string;
  label: string;
}

interface FilterableColumn {
  id: string;
  label: string;
  options?: string[];
}

interface ViewToolbarProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<any>;
  viewStore: ViewStore;
  entityType: "kiosk" | "location";
  groupableColumns: GroupableColumn[];
  filterableColumns?: FilterableColumn[];
  csvFileName?: string;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ViewToolbar({
  table,
  viewStore,
  entityType,
  groupableColumns,
  filterableColumns = [],
  csvFileName,
}: ViewToolbarProps) {
  const store = viewStore();
  const { setGlobalFilter, setGrouping, setColumnVisibility, setColumnFilters, columnFilters } = store;
  const grouping = store.grouping;
  const columnVisibility = store.columnVisibility;

  const [searchValue, setSearchValue] = React.useState(store.globalFilter);
  const [filterDraft, setFilterDraft] = React.useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [columnsOpen, setColumnsOpen] = React.useState(false);

  const debouncedSearch = useDebounce(searchValue, 300);

  // Skip redundant Zustand writes (avoids Strict Mode double-fire)
  const lastWrittenToStore = React.useRef(store.globalFilter);
  React.useEffect(() => {
    if (debouncedSearch === lastWrittenToStore.current) return;
    lastWrittenToStore.current = debouncedSearch;
    setGlobalFilter(debouncedSearch);
  }, [debouncedSearch, setGlobalFilter]);

  // Sync filter draft from columnFilters store state
  React.useEffect(() => {
    const draft: Record<string, string> = {};
    columnFilters.forEach((f) => {
      draft[f.id] = String(f.value ?? "");
    });
    setFilterDraft(draft);
  }, [columnFilters]);

  const searchPlaceholder = entityType === "kiosk" ? "Search kiosks..." : "Search locations...";

  const allColumns = table.getAllColumns().filter(
    (col) => col.getCanHide() && col.id !== "select"
  );

  const activeGrouping = grouping[0] ?? "";

  function applyFilters() {
    const newFilters: ColumnFiltersState = Object.entries(filterDraft)
      .filter(([, v]) => v !== "")
      .map(([id, value]) => ({ id, value }));
    setColumnFilters(newFilters);
    setFilterOpen(false);
  }

  function clearFilters() {
    setFilterDraft({});
    setColumnFilters([]);
    setFilterOpen(false);
  }

  const activeFilterCount = columnFilters.length;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      {/* Left side controls */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Global search */}
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Filter popover */}
        {filterableColumns.length > 0 && (
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              }
            />
            <PopoverContent align="start" className="w-72 p-4">
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Filter by
                </p>
                {filterableColumns.map((col) => (
                  <div key={col.id} className="space-y-1">
                    <Label className="text-xs text-foreground">{col.label}</Label>
                    {col.options ? (
                      <Select
                        value={filterDraft[col.id] ?? ""}
                        onValueChange={(v) => {
                          const value: string = v === "__all__" ? "" : (v as string);
                          setFilterDraft((prev) => ({
                            ...prev,
                            [col.id]: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder={`All ${col.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All {col.label}</SelectItem>
                          {col.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={filterDraft[col.id] ?? ""}
                        onChange={(e) =>
                          setFilterDraft((prev) => ({
                            ...prev,
                            [col.id]: e.target.value,
                          }))
                        }
                        placeholder={`Filter ${col.label}...`}
                        className="h-8 text-sm"
                      />
                    )}
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="h-8 text-xs"
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={applyFilters}
                    className="h-8 bg-primary text-white hover:bg-primary/90 text-xs"
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Group By */}
        {groupableColumns.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select
              value={activeGrouping || "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setGrouping([]);
                } else {
                  setGrouping([v as string]);
                }
              }}
              items={[
                { value: "__none__", label: "No grouping" },
                ...groupableColumns.map((c) => ({ value: c.id, label: c.label })),
              ]}
            >
              <SelectTrigger className="h-9 w-auto min-w-[130px] gap-1.5 text-sm border-input">
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Group by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No grouping</SelectItem>
                {groupableColumns.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Column visibility */}
        <Popover open={columnsOpen} onOpenChange={setColumnsOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Columns className="h-3.5 w-3.5" />
                Columns
              </button>
            }
          />
          <PopoverContent align="start" className="w-52 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Toggle columns
            </p>
            <div className="space-y-2">
              {allColumns.map((col) => {
                const isVisible = col.getIsVisible();
                return (
                  <div key={col.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`col-${col.id}`}
                      checked={isVisible}
                      onCheckedChange={(checked) => {
                        setColumnVisibility({
                          ...columnVisibility,
                          [col.id]: Boolean(checked),
                        });
                      }}
                    />
                    <label
                      htmlFor={`col-${col.id}`}
                      className="cursor-pointer text-sm text-foreground"
                    >
                      {typeof col.columnDef.header === "string"
                        ? col.columnDef.header
                        : col.id}
                    </label>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-sm"
          onClick={csvFileName ? () => exportTableToCSV(table, csvFileName) : undefined}
          disabled={!csvFileName}
          title={csvFileName ? "Export filtered data to CSV" : "Export CSV — coming in Plan 02-05"}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
