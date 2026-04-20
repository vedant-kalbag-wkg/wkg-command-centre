"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ColumnHeaderFilterProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: Column<any, unknown>;
  label: string;
}

export function ColumnHeaderFilter({ column, label }: ColumnHeaderFilterProps) {
  const sortState = column.getIsSorted();
  const canFilter = column.getCanFilter();

  // Local filter value with debounce
  const [filterValue, setFilterValue] = React.useState<string>(
    (column.getFilterValue() as string) ?? ""
  );

  // Sync filter value from external state (e.g. store reset)
  React.useEffect(() => {
    setFilterValue((column.getFilterValue() as string) ?? "");
  }, [column.getFilterValue()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce filter updates (300ms)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      column.setFilterValue(filterValue === "" ? undefined : filterValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const SortIcon =
    sortState === "asc"
      ? ChevronUp
      : sortState === "desc"
        ? ChevronDown
        : ChevronsUpDown;

  function handleLabelClick(e: React.MouseEvent) {
    // Only toggle sort — filter input click should not trigger sort
    e.stopPropagation();
    column.getToggleSortingHandler()?.(e);
  }

  return (
    <div className="flex flex-col gap-1 py-1" onClick={(e) => e.stopPropagation()}>
      {/* Sort label row */}
      <button
        type="button"
        onClick={handleLabelClick}
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground uppercase tracking-wide hover:text-primary transition-colors cursor-pointer"
      >
        <span>{label}</span>
        <SortIcon
          className={`h-3 w-3 shrink-0 ${
            sortState ? "text-primary" : "text-muted-foreground/50"
          }`}
        />
      </button>

      {/* Per-column filter input */}
      {canFilter && (
        <Input
          type="text"
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Filter..."
          className="h-6 text-xs border-border/60 focus-visible:ring-ring focus-visible:border-primary placeholder:text-muted-foreground/50 px-1.5 py-0"
        />
      )}
    </div>
  );
}
