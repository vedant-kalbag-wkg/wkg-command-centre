"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type LocationType,
} from "@/lib/analytics/types";
import { bulkSetLocationTypeAction, setLocationTypeAction } from "./actions";
import type { UnclassifiedOutletRow } from "./pipeline";

interface OutletTypesTableProps {
  initialRows: UnclassifiedOutletRow[];
}

// Default fallback for rows where the classifier returned null — picking
// "hotel" makes the dropdown non-empty so the admin only has to correct
// the outliers rather than choose from scratch on every row.
const DEFAULT_TYPE: LocationType = "hotel";

export function OutletTypesTable({ initialRows }: OutletTypesTableProps) {
  const router = useRouter();

  // Local state mirrors initialRows at mount, then gets mutated optimistically
  // after save/bulk actions. When the RSC re-fetches and passes a new
  // `initialRows` reference (identity change), we reset local state to match —
  // this is the "derived state from props" pattern, handled inline rather than
  // inside an effect so we don't cascade renders.
  const [prevInitialRows, setPrevInitialRows] =
    React.useState<UnclassifiedOutletRow[]>(initialRows);
  const [rows, setRows] = React.useState<UnclassifiedOutletRow[]>(initialRows);
  const [selectedType, setSelectedType] = React.useState<Record<string, LocationType>>(
    () => {
      const seed: Record<string, LocationType> = {};
      for (const row of initialRows) {
        seed[row.id] = row.suggestedType ?? DEFAULT_TYPE;
      }
      return seed;
    },
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  if (initialRows !== prevInitialRows) {
    setPrevInitialRows(initialRows);
    setRows(initialRows);
    setSelectedType((prev) => {
      const next: Record<string, LocationType> = {};
      for (const row of initialRows) {
        next[row.id] = prev[row.id] ?? row.suggestedType ?? DEFAULT_TYPE;
      }
      return next;
    });
    setSelectedIds((prev) => {
      const validIds = new Set(initialRows.map((r) => r.id));
      const next = new Set<string>();
      for (const id of prev) if (validIds.has(id)) next.add(id);
      return next;
    });
  }

  const [bulkType, setBulkType] = React.useState<LocationType>(DEFAULT_TYPE);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = React.useState(false);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All outlets classified"
        description="Nothing to do here — new outlets will appear as soon as they land from the next ETL run."
      />
    );
  }

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSave = async (row: UnclassifiedOutletRow) => {
    const type = selectedType[row.id] ?? row.suggestedType ?? DEFAULT_TYPE;
    setSavingId(row.id);
    try {
      await setLocationTypeAction(row.id, type);
      // Optimistic removal — server already persisted.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      toast.success(
        `Classified ${row.outletCode} as ${LOCATION_TYPE_LABELS[type]}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to classify ${row.outletCode}`,
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleBulkApply = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkSaving(true);
    try {
      await bulkSetLocationTypeAction(ids, bulkType);
      setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      toast.success(
        `Classified ${ids.length} outlet${ids.length === 1 ? "" : "s"} as ${LOCATION_TYPE_LABELS[bulkType]}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Bulk classify failed",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-4 py-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Set type to</span>
            <Select
              value={bulkType}
              onValueChange={(v) => v && setBulkType(v as LocationType)}
            >
              <SelectTrigger size="sm" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LOCATION_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={handleBulkApply}
            disabled={bulkSaving}
          >
            {bulkSaving ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-3.5" />
            )}
            Apply to selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkSaving}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="Select all rows"
                />
              </TableHead>
              <TableHead>Outlet code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Last 30d revenue</TableHead>
              <TableHead className="text-right">Last 30d txns</TableHead>
              <TableHead>Suggested</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isSelected = selectedIds.has(row.id);
              const isSaving = savingId === row.id;
              const current =
                selectedType[row.id] ?? row.suggestedType ?? DEFAULT_TYPE;
              return (
                <TableRow key={row.id} data-state={isSelected ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => toggleOne(row.id, v === true)}
                      aria-label={`Select ${row.outletCode}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.outletCode}
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.last30dRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.last30dTransactions)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.suggestedType
                      ? LOCATION_TYPE_LABELS[row.suggestedType]
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={current}
                      onValueChange={(v) =>
                        v &&
                        setSelectedType((prev) => ({
                          ...prev,
                          [row.id]: v as LocationType,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="min-w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCATION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {LOCATION_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSave(row)}
                      disabled={isSaving || bulkSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Save className="mr-1.5 size-3.5" />
                      )}
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
