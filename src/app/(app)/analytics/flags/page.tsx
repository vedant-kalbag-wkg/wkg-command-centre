"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";
import { CreateActionDialog } from "@/components/analytics/create-action-dialog";
import { FlagBadge } from "@/components/analytics/flag-badge";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Flag, ChevronDown, ChevronRight } from "lucide-react";
import {
  fetchAllFlags,
  fetchFlaggedLocations,
  resolveFlag,
  type FlagWithLocation,
} from "./actions";
import { fetchActionItemsForFlag } from "../actions-dashboard/actions";
import type { ActionItem, FlagType } from "@/lib/analytics/types";

const RESOLVED_OPTIONS: {
  value: "active" | "resolved" | "all";
  label: string;
}[] = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const FLAG_TYPE_OPTIONS: { value: FlagType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "relocate", label: "Relocate" },
  { value: "monitor", label: "Monitor" },
  { value: "strategic_exception", label: "Strategic Exception" },
];

function resolvedFilterToParam(
  v: "active" | "resolved" | "all",
): boolean | "all" {
  if (v === "active") return false;
  if (v === "resolved") return true;
  return "all";
}

export default function FlagReviewPage() {
  const [flags, setFlags] = useState<FlagWithLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvedFilter, setResolvedFilter] = useState<
    "active" | "resolved" | "all"
  >("active");
  const [flagTypeFilter, setFlagTypeFilter] = useState<FlagType | "all">("all");
  const [locationOptions, setLocationOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkedActions, setLinkedActions] = useState<
    Record<string, ActionItem[]>
  >({});
  // Per-row count overrides: only populated after a CreateActionDialog
  // succeeds (so the badge updates without a full reload). Otherwise the
  // count comes straight off `flag.linkedActionCount` from the server query.
  const [linkedActionCountOverrides, setLinkedActionCountOverrides] = useState<
    Record<string, number>
  >({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetchFlaggedLocations()
      .then(setLocationOptions)
      .catch(() => setLocationOptions([]));
  }, []);

  async function loadFlags() {
    setLoading(true);
    const data = await fetchAllFlags({
      resolved: resolvedFilterToParam(resolvedFilter),
      flagTypes: flagTypeFilter === "all" ? undefined : [flagTypeFilter],
      locationIds:
        selectedLocationIds.length > 0 ? selectedLocationIds : undefined,
    });
    setFlags(data);
    // Server now returns `linkedActionCount` per flag via a correlated
    // subquery — no per-row roundtrip needed for the count badge. Drop any
    // stale overrides from a previous filter view.
    setLinkedActionCountOverrides({});
    setLoading(false);
  }

  useEffect(() => {
    loadFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedFilter, flagTypeFilter, selectedLocationIds]);

  async function toggleExpand(flagId: string) {
    if (expandedId === flagId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(flagId);
    if (!linkedActions[flagId]) {
      const items = await fetchActionItemsForFlag(flagId);
      setLinkedActions((prev) => ({ ...prev, [flagId]: items }));
    }
  }

  function handleResolve(flagId: string) {
    startTransition(async () => {
      await resolveFlag(flagId, resolutionNote.trim() || undefined);
      setResolvingId(null);
      setResolutionNote("");
      await loadFlags();
    });
  }

  async function refreshLinkedCount(flagId: string) {
    // Called after a new action is created from the inline "Create Action"
    // dialog. We refetch just the affected flag's action list (one row,
    // not N+1) and override the badge count locally; the next loadFlags()
    // will refresh from the server-side count and clear the override.
    const items = await fetchActionItemsForFlag(flagId);
    setLinkedActionCountOverrides((prev) => ({ ...prev, [flagId]: items.length }));
    if (expandedId === flagId) {
      setLinkedActions((prev) => ({ ...prev, [flagId]: items }));
    }
  }

  const openCount = flags.filter((f) => !f.resolvedAt).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Flag Review"
        description={`${openCount} active flag${openCount !== 1 ? "s" : ""} awaiting review`}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {RESOLVED_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={resolvedFilter === opt.value ? "default" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${
                resolvedFilter === opt.value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }`}
              onClick={() => setResolvedFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {FLAG_TYPE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={flagTypeFilter === opt.value ? "default" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${
                flagTypeFilter === opt.value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : ""
              }`}
              onClick={() =>
                setFlagTypeFilter(opt.value as FlagType | "all")
              }
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({
            value: l.id,
            label: l.name,
          }))}
          selected={selectedLocationIds}
          onChange={setSelectedLocationIds}
          placeholder="Filter locations..."
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Loading flags...
        </div>
      ) : flags.length === 0 ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={Flag}
            title="No flags found"
            description="Adjust your filters or wait for new performance flags to be raised."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-8" />
                <TableHead className="text-xs font-semibold">
                  Location
                </TableHead>
                <TableHead className="text-xs font-semibold">Type</TableHead>
                <TableHead className="text-xs font-semibold">Reason</TableHead>
                <TableHead className="text-xs font-semibold">Created</TableHead>
                <TableHead className="text-xs font-semibold">
                  Linked Actions
                </TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => {
                const expanded = expandedId === flag.id;
                const isResolved = !!flag.resolvedAt;
                const linkedCount =
                  linkedActionCountOverrides[flag.id] ?? flag.linkedActionCount;
                return (
                  <Fragment key={flag.id}>
                    <TableRow>
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => toggleExpand(flag.id)}
                          aria-label={expanded ? "Collapse" : "Expand"}
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {flag.locationName ?? "—"}
                        {flag.outletCode && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {flag.outletCode}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <FlagBadge flagType={flag.flagType} />
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">
                        <p className="line-clamp-2">
                          {flag.reason ?? (
                            <span className="text-muted-foreground">
                              No reason provided
                            </span>
                          )}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        <p>{new Date(flag.createdAt).toLocaleDateString()}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {flag.actorName}
                        </p>
                      </TableCell>
                      <TableCell>
                        {linkedCount > 0 ? (
                          <Badge
                            variant="secondary"
                            className="h-5 px-1.5 text-[10px]"
                          >
                            {linkedCount}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isResolved ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            Resolved
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Active
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isResolved ? (
                          <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                            {flag.resolvedAt && (
                              <span>
                                {new Date(flag.resolvedAt).toLocaleDateString()}
                              </span>
                            )}
                            {flag.resolutionNote && (
                              <span className="line-clamp-1">
                                {flag.resolutionNote}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <CreateActionDialog
                              locationId={flag.locationId}
                              locationName={flag.locationName ?? undefined}
                              sourceType="flag"
                              sourceId={flag.id}
                              defaultTitle={`Investigate ${flag.locationName ?? "location"} — ${flag.flagType}`}
                              onCreated={() => refreshLinkedCount(flag.id)}
                            >
                              <Button
                                size="xs"
                                variant="outline"
                                className="h-7 text-[10px]"
                              >
                                Create Action
                              </Button>
                            </CreateActionDialog>
                            <Button
                              size="xs"
                              variant="outline"
                              className="h-7 text-[10px]"
                              onClick={() => setResolvingId(flag.id)}
                            >
                              Resolve
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Inline expansion: linked action items */}
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/20 p-3">
                          {linkedActions[flag.id] === undefined ? (
                            <p className="text-[10px] text-muted-foreground">
                              Loading linked actions...
                            </p>
                          ) : linkedActions[flag.id]!.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground">
                              No linked actions yet.
                            </p>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {linkedActions[flag.id]!.map((a) => (
                                <div
                                  key={a.id}
                                  className="flex items-center justify-between gap-3 rounded border bg-background px-2 py-1 text-[11px]"
                                >
                                  <span className="font-medium">{a.title}</span>
                                  <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>{a.status}</span>
                                    {a.ownerName && <span>· {a.ownerName}</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Inline resolve form */}
                    {resolvingId === flag.id && !isResolved && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30">
                          <div className="flex items-end gap-3 py-2">
                            <div className="flex-1">
                              <p className="mb-1 text-xs font-medium">
                                Resolution note (optional)
                              </p>
                              <Textarea
                                value={resolutionNote}
                                onChange={(e) =>
                                  setResolutionNote(e.target.value)
                                }
                                placeholder="What was decided? (e.g. relocated to T5, monitored for 3 months)"
                                rows={2}
                                className="text-xs"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => {
                                  setResolvingId(null);
                                  setResolutionNote("");
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 text-xs"
                                disabled={isPending}
                                onClick={() => handleResolve(flag.id)}
                              >
                                {isPending ? "Resolving..." : "Resolve"}
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-right text-[10px] text-muted-foreground">
        {flags.length} flag{flags.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
