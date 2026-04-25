"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type LocationType,
} from "@/lib/analytics/types";
import {
  bulkSetLocationTypeAction,
  bulkSetPrimaryRegionAction,
  setLocationTypeAction,
  setPrimaryRegionAction,
} from "./actions";
import type { RegionOption, UnclassifiedOutletRow } from "./pipeline";

interface OutletTypesTableProps {
  initialRows: UnclassifiedOutletRow[];
  regions: RegionOption[];
}

// Default fallback for rows where the classifier returned null — picking
// "hotel" makes the dropdown non-empty so the admin only has to correct
// the outliers rather than choose from scratch on every row.
const DEFAULT_TYPE: LocationType = "hotel";

export function OutletTypesTable({ initialRows, regions }: OutletTypesTableProps) {
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
  // Region picker state per row — defaults to the row's current region so the
  // Save button stays disabled until the operator actually changes something.
  const [selectedRegion, setSelectedRegion] = React.useState<Record<string, string>>(
    () => {
      const seed: Record<string, string> = {};
      for (const row of initialRows) {
        seed[row.id] = row.primaryRegionId;
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
    setSelectedRegion((prev) => {
      const next: Record<string, string> = {};
      for (const row of initialRows) {
        next[row.id] = prev[row.id] ?? row.primaryRegionId;
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
  // Bulk-region default — first region by name (the same order shown in the
  // dropdown). If `regions` is empty we leave it as undefined; the bulk
  // toolbar's region button is disabled in that edge case.
  const [bulkRegion, setBulkRegion] = React.useState<string>(
    regions[0]?.id ?? "",
  );
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = React.useState(false);
  const [bulkRegionSaving, setBulkRegionSaving] = React.useState(false);

  // Lookup helpers for rendering region codes (e.g. UK / DE / ES) without
  // re-shaping the regions array on every cell render.
  const regionById = React.useMemo(() => {
    const m = new Map<string, RegionOption>();
    for (const r of regions) m.set(r.id, r);
    return m;
  }, [regions]);

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
    const region = selectedRegion[row.id] ?? row.primaryRegionId;
    const regionChanged = region !== row.primaryRegionId;

    setSavingId(row.id);
    try {
      // Region update first so a successful type save can drop the row
      // without losing the region change.
      if (regionChanged) {
        const result = await setPrimaryRegionAction(row.id, region);
        if (result.status === "conflict") {
          toast.error(result.message);
          return;
        }
      }

      await setLocationTypeAction(row.id, type);

      // Optimistic removal — server already persisted.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });

      const newRegionCode = regionChanged
        ? regionById.get(region)?.code ?? region
        : null;
      toast.success(
        regionChanged
          ? `Classified ${row.outletCode} as ${LOCATION_TYPE_LABELS[type]} (moved to ${newRegionCode})`
          : `Classified ${row.outletCode} as ${LOCATION_TYPE_LABELS[type]}`,
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

  const handleBulkApplyRegion = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !bulkRegion) return;
    setBulkRegionSaving(true);
    try {
      const { okIds, conflictingIds } = await bulkSetPrimaryRegionAction(
        ids,
        bulkRegion,
      );

      // Reflect the move in local state so the cells update without a full
      // refresh — the rows stay in the list (region change alone doesn't
      // satisfy `locationType IS NULL`).
      const okSet = new Set(okIds);
      const target = regionById.get(bulkRegion);
      if (target) {
        setRows((prev) =>
          prev.map((r) =>
            okSet.has(r.id)
              ? {
                  ...r,
                  primaryRegionId: target.id,
                  primaryRegionCode: target.code,
                }
              : r,
          ),
        );
        setSelectedRegion((prev) => {
          const next = { ...prev };
          for (const id of okIds) next[id] = target.id;
          return next;
        });
      }
      // Drop only the successful ids from the selection — leave the
      // conflicting ones selected so the operator can pick a different
      // region without re-checking them.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of okIds) next.delete(id);
        return next;
      });

      const targetCode = target?.code ?? "";
      if (okIds.length > 0 && conflictingIds.length === 0) {
        toast.success(
          `Moved ${okIds.length} outlet${okIds.length === 1 ? "" : "s"} to ${targetCode}`,
        );
      } else if (okIds.length > 0 && conflictingIds.length > 0) {
        const conflictingCodes = rows
          .filter((r) => conflictingIds.includes(r.id))
          .map((r) => r.outletCode);
        toast.error(
          `Moved ${okIds.length} to ${targetCode}; skipped ${conflictingIds.length} (outlet code${conflictingIds.length === 1 ? "" : "s"} ${conflictingCodes.join(", ")} already exist${conflictingIds.length === 1 ? "s" : ""} in ${targetCode})`,
        );
      } else {
        const conflictingCodes = rows
          .filter((r) => conflictingIds.includes(r.id))
          .map((r) => r.outletCode);
        toast.error(
          `No outlets moved — outlet code${conflictingCodes.length === 1 ? "" : "s"} ${conflictingCodes.join(", ")} already exist${conflictingCodes.length === 1 ? "s" : ""} in ${targetCode}`,
        );
      }

      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Bulk region change failed",
      );
    } finally {
      setBulkRegionSaving(false);
    }
  };

  return (
    <TooltipProvider>
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
            disabled={bulkSaving || bulkRegionSaving}
          >
            {bulkSaving ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-3.5" />
            )}
            Apply type to selected
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Set region to</span>
            <Select
              value={bulkRegion}
              onValueChange={(v) => v && setBulkRegion(v)}
              disabled={regions.length === 0}
            >
              <SelectTrigger size="sm" className="min-w-32">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.code} — {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleBulkApplyRegion}
            disabled={bulkSaving || bulkRegionSaving || !bulkRegion}
          >
            {bulkRegionSaving ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-3.5" />
            )}
            Apply region to selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkSaving || bulkRegionSaving}
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
              <TableHead>Review reason</TableHead>
              <TableHead className="text-right">Last 30d revenue</TableHead>
              <TableHead className="text-right">Last 30d txns</TableHead>
              <TableHead>Suggested</TableHead>
              <TableHead>Region</TableHead>
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
                  <TableCell>
                    {row.reviewReason === "imported_from_monday" ? (
                      // Amber/warning styling — this row was auto-created by
                      // the Monday import script with a MONDAY-<itemId>
                      // placeholder outletCode. Operators need to verify the
                      // region (default=UK) AND set a real location_type.
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-700 cursor-help dark:text-amber-400"
                            />
                          }
                        >
                          Imported from Monday
                        </TooltipTrigger>
                        {row.notes ? (
                          <TooltipContent className="max-w-sm whitespace-normal">
                            {row.notes}
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    ) : row.notes ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge variant="subtle-muted" className="cursor-help" />
                          }
                        >
                          Missing type
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm whitespace-normal">
                          {row.notes}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="subtle-muted">Missing type</Badge>
                    )}
                  </TableCell>
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
                      value={selectedRegion[row.id] ?? row.primaryRegionId}
                      onValueChange={(v) =>
                        v &&
                        setSelectedRegion((prev) => ({
                          ...prev,
                          [row.id]: v,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="min-w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {regions.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      disabled={isSaving || bulkSaving || bulkRegionSaving}
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
    </TooltipProvider>
  );
}
