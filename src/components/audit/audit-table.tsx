"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  fetchAuditEntries,
  fetchAuditActors,
  type AuditEntry,
} from "@/app/(app)/settings/audit-log/actions";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

interface FilterState {
  actorId: string;
  entityType: string;
  dateFrom: string;
  dateTo: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityTypeLabel(entityType: string): string {
  if (entityType === "kiosk") return "Kiosk";
  if (entityType === "location") return "Location";
  return entityType;
}

function entityLink(entityType: string, entityId: string, entityName: string | null): React.ReactNode {
  const label = entityName ?? entityId;
  if (entityType === "kiosk") {
    return <Link href={`/kiosks/${entityId}`} className="text-wk-azure hover:underline">{label}</Link>;
  }
  if (entityType === "location") {
    return <Link href={`/locations/${entityId}`} className="text-wk-azure hover:underline">{label}</Link>;
  }
  return <span>{label}</span>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuditTable() {
  const [actors, setActors] = React.useState<{ id: string | null; name: string | null }[]>([]);
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [remainingCount, setRemainingCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const [filters, setFilters] = React.useState<FilterState>({
    actorId: "",
    entityType: "",
    dateFrom: "",
    dateTo: "",
  });

  // Fetch actors for filter dropdown
  React.useEffect(() => {
    let cancelled = false;
    fetchAuditActors()
      .then((a) => { if (!cancelled) setActors(a); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Fetch entries when filters change
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    fetchAuditEntries({
      actorId: filters.actorId || undefined,
      entityType: filters.entityType || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      limit: 20,
    })
      .then(({ entries: e, hasMore: hm, remainingCount: rc }) => {
        if (cancelled) return;
        setEntries(e);
        setHasMore(hm);
        setRemainingCount(rc);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  async function handleLoadMore() {
    const cursor = entries[entries.length - 1]?.id;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const { entries: more, hasMore: hm, remainingCount: rc } = await fetchAuditEntries({
        actorId: filters.actorId || undefined,
        entityType: filters.entityType || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        cursor,
        limit: 20,
      });
      setEntries((prev) => [...prev, ...more]);
      setHasMore(hm);
      setRemainingCount(rc);
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setFilters({ actorId: "", entityType: "", dateFrom: "", dateTo: "" });
  }

  const hasFilters = Object.values(filters).some((v) => v !== "");

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-wk-mid-grey bg-wk-light-grey/40 p-4">
        {/* User filter */}
        <div className="space-y-1.5 min-w-[180px]">
          <Label className="text-xs text-wk-night-grey">User</Label>
          <Select
            value={filters.actorId || "__all__"}
            onValueChange={(v) => setFilters((f) => ({ ...f, actorId: v === "__all__" ? "" : (v as string) }))}
            items={[
              { value: "__all__", label: "All users" },
              ...actors.map((a) => ({ value: a.id ?? "", label: a.name ?? "" })),
            ]}
          >
            <SelectTrigger className="h-8 w-full text-sm bg-white">
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All users</SelectItem>
              {actors.map((actor) => (
                <SelectItem key={actor.id ?? "unknown"} value={actor.id ?? ""}>
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Entity type filter */}
        <div className="space-y-1.5 min-w-[160px]">
          <Label className="text-xs text-wk-night-grey">Entity Type</Label>
          <Select
            value={filters.entityType || "__all__"}
            onValueChange={(v) => setFilters((f) => ({ ...f, entityType: v === "__all__" ? "" : (v as string) }))}
            items={[
              { value: "__all__", label: "All" },
              { value: "kiosk", label: "Kiosk" },
              { value: "location", label: "Location" },
            ]}
          >
            <SelectTrigger className="h-8 w-full text-sm bg-white">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All</SelectItem>
              <SelectItem value="kiosk">Kiosk</SelectItem>
              <SelectItem value="location">Location</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date From */}
        <div className="space-y-1.5">
          <Label className="text-xs text-wk-night-grey">From</Label>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="h-8 text-sm bg-white"
          />
        </div>

        {/* Date To */}
        <div className="space-y-1.5">
          <Label className="text-xs text-wk-night-grey">To</Label>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="h-8 text-sm bg-white"
          />
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-xs text-wk-night-grey"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-wk-mid-grey overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <p className="text-sm text-wk-night-grey">Loading…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-wk-night-grey">
              No audit entries match. Try adjusting the date range or clearing the filters.
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 text-sm text-wk-azure hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-wk-light-grey hover:bg-wk-light-grey border-b border-wk-mid-grey">
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  Date
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  User
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  Entity Type
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  Record
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  Field
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  Old Value
                </TableHead>
                <TableHead className="text-xs font-medium text-wk-graphite uppercase tracking-wide">
                  New Value
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} className="hover:bg-wk-sky-blue">
                  <TableCell className="py-2.5 text-sm text-wk-graphite whitespace-nowrap">
                    {formatDate(entry.createdAt)}
                  </TableCell>
                  <TableCell className="py-2.5 text-sm text-wk-graphite">
                    {entry.actorName ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant="secondary" className="text-xs">
                      {entityTypeLabel(entry.entityType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5 text-sm">
                    {entityLink(entry.entityType, entry.entityId, entry.entityName)}
                  </TableCell>
                  <TableCell className="py-2.5 text-sm text-wk-graphite">
                    {entry.field ?? (
                      <span className="text-wk-mid-grey italic">{entry.action}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 text-sm">
                    {entry.oldValue ? (
                      <span className="line-through text-wk-night-grey">{entry.oldValue}</span>
                    ) : (
                      <span className="text-wk-mid-grey">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 text-sm text-wk-graphite">
                    {entry.newValue ?? <span className="text-wk-mid-grey">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm text-wk-azure hover:underline disabled:opacity-50"
          >
            {loadingMore
              ? "Loading…"
              : `Load 20 more entries${remainingCount > 0 ? ` (${remainingCount} remaining)` : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
