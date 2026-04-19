"use client";

import * as React from "react";
import { ArrowRightLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { fetchAuditEntries, type AuditEntry } from "@/app/(app)/settings/audit-log/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditTimelineProps {
  entityType: "kiosk" | "location";
  entityId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24) {
    // Relative: "2h ago", "45m ago"
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
    }
    return `${Math.floor(diffHours)}h ago`;
  }

  // Full date for older entries
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupByDay(entries: AuditEntry[]): Map<string, AuditEntry[]> {
  const groups = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.createdAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const existing = groups.get(day) ?? [];
    existing.push(entry);
    groups.set(day, existing);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Action description renderer
// ---------------------------------------------------------------------------

function ActionDescription({ entry }: { entry: AuditEntry }) {
  const entityLabel = entry.entityType;

  switch (entry.action) {
    case "create":
      return (
        <span className="text-sm text-foreground">
          created this {entityLabel}
        </span>
      );

    case "update":
      return (
        <span className="text-sm text-foreground">
          changed{" "}
          <span className="font-medium">{entry.field}</span>
          {entry.oldValue && (
            <>
              {" "}from{" "}
              <span className="line-through text-muted-foreground">{entry.oldValue}</span>
            </>
          )}
          {entry.newValue && (
            <>
              {" "}to{" "}
              <span className="font-medium">{entry.newValue}</span>
            </>
          )}
        </span>
      );

    case "archive":
      return (
        <span className="text-sm text-foreground">
          archived this {entityLabel}
        </span>
      );

    case "assign":
      if (entry.oldValue && entry.newValue) {
        return (
          <span className="inline-flex items-center gap-1 text-sm text-foreground">
            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
            reassigned from{" "}
            <span className="line-through text-muted-foreground">{entry.oldValue}</span>{" "}
            to{" "}
            <span className="font-medium">{entry.newValue}</span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-sm text-foreground">
          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
          assigned to{" "}
          <span className="font-medium">{entry.newValue ?? "venue"}</span>
        </span>
      );

    case "unassign":
      return (
        <span className="text-sm text-foreground">
          unassigned from{" "}
          <span className="line-through text-muted-foreground">{entry.oldValue}</span>
        </span>
      );

    default:
      return (
        <span className="text-sm text-foreground">{entry.action}</span>
      );
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuditTimeline({ entityType, entityId }: AuditTimelineProps) {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [remainingCount, setRemainingCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // Fetch initial entries on mount
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditEntries({ entityType, entityId, limit: 20 })
      .then(({ entries: e, hasMore: hm, remainingCount: rc }) => {
        if (cancelled) return;
        setEntries(e);
        setHasMore(hm);
        setRemainingCount(rc);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  async function handleLoadMore() {
    const cursor = entries[entries.length - 1]?.id;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const { entries: more, hasMore: hm, remainingCount: rc } = await fetchAuditEntries({
        entityType,
        entityId,
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

  if (loading) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted-foreground">Loading activity…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted-foreground">No activity yet. Changes to this record will appear here.</p>
      </div>
    );
  }

  const groups = groupByDay(entries);

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([day, dayEntries]) => (
        <div key={day}>
          {/* Day header */}
          <div className="mb-3 sticky top-0 bg-white">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
              {day}
            </p>
          </div>

          {/* Entries for this day */}
          <div className="space-y-3 pl-1">
            {dayEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3">
                {/* Avatar */}
                <Avatar size="sm" className="mt-0.5 shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-medium">
                    {getInitials(entry.actorName)}
                  </AvatarFallback>
                </Avatar>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {entry.actorName ?? "Unknown"}
                    </span>
                    <ActionDescription entry={entry} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {formatRelativeTime(new Date(entry.createdAt))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm text-primary hover:underline disabled:opacity-50"
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
