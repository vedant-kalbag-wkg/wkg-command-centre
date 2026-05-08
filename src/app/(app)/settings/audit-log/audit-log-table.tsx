"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { AuditLogRow, FilterOptions } from "./pipeline";

interface AuditLogTableProps {
  rows: AuditLogRow[];
  totalCount: number;
  filters: {
    entityType?: string;
    actorId?: string;
    action?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
  };
  filterOptions: FilterOptions;
  pageSize: number;
}

// Sentinel value used by the shadcn Select to represent "All" — base-ui's
// Select doesn't allow empty-string values so we reserve a token instead.
const ALL_VALUE = "__all__";

/**
 * Format an audit-log timestamp as "YYYY-MM-DD HH:MM:SS UTC". UTC keeps
 * timestamps stable across operators in different timezones — the audit
 * log is forensic, so a deterministic string beats a friendly local one.
 */
function formatWhen(d: Date): string {
  const date = new Date(d);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

const TRUNCATE_LEN = 40;

function truncate(s: string, n = TRUNCATE_LEN): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

/** Compact rendering of old → new transitions. */
function valueDelta(
  oldValue: string | null,
  newValue: string | null,
): { display: string; full: string | null } {
  if (oldValue !== null && newValue !== null) {
    return {
      display: `${truncate(oldValue, 18)} → ${truncate(newValue, 18)}`,
      full: `${oldValue} → ${newValue}`,
    };
  }
  if (newValue !== null) {
    return {
      display: `(set to ${truncate(newValue, 30)})`,
      full: `(set to ${newValue})`,
    };
  }
  if (oldValue !== null) {
    return {
      display: `(was ${truncate(oldValue, 30)})`,
      full: `(was ${oldValue})`,
    };
  }
  return { display: "—", full: null };
}

export function AuditLogTable({
  rows,
  totalCount,
  filters,
  filterOptions,
  pageSize,
}: AuditLogTableProps) {
  const router = useRouter();

  // Local form state — seeded from URL filters. The form submits back into
  // the URL via router.push, which triggers an RSC re-render with new data.
  const [entityType, setEntityType] = React.useState<string>(
    filters.entityType ?? ALL_VALUE,
  );
  const [actorId, setActorId] = React.useState<string>(
    filters.actorId ?? ALL_VALUE,
  );
  const [action, setAction] = React.useState<string>(
    filters.action ?? ALL_VALUE,
  );
  const [dateFrom, setDateFrom] = React.useState<string>(filters.dateFrom ?? "");
  const [dateTo, setDateTo] = React.useState<string>(filters.dateTo ?? "");

  // Re-sync form state when the URL changes (e.g. browser back/forward, or
  // a Reset click). Identity check on the filters object would always be
  // false because the parent re-creates it; we compare each scalar field.
  const prevFiltersRef = React.useRef(filters);
  React.useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.entityType !== filters.entityType ||
      prev.actorId !== filters.actorId ||
      prev.action !== filters.action ||
      prev.dateFrom !== filters.dateFrom ||
      prev.dateTo !== filters.dateTo
    ) {
      setEntityType(filters.entityType ?? ALL_VALUE);
      setActorId(filters.actorId ?? ALL_VALUE);
      setAction(filters.action ?? ALL_VALUE);
      setDateFrom(filters.dateFrom ?? "");
      setDateTo(filters.dateTo ?? "");
    }
    prevFiltersRef.current = filters;
  }, [filters]);

  const buildUrl = React.useCallback(
    (overrides: {
      entityType?: string;
      actorId?: string;
      action?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
    }) => {
      const params = new URLSearchParams();
      const set = (key: string, value: string | undefined) => {
        if (value && value !== ALL_VALUE) params.set(key, value);
      };
      set("entityType", overrides.entityType);
      set("actorId", overrides.actorId);
      set("action", overrides.action);
      set("dateFrom", overrides.dateFrom);
      set("dateTo", overrides.dateTo);
      if (overrides.page && overrides.page > 0) {
        params.set("page", String(overrides.page));
      }
      const qs = params.toString();
      return qs ? `/settings/audit-log?${qs}` : "/settings/audit-log";
    },
    [],
  );

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    // Reset to page 0 whenever filters change — staying on a page that
    // might not exist under the new filter set is a footgun.
    router.push(
      buildUrl({
        entityType,
        actorId,
        action,
        dateFrom,
        dateTo,
        page: 0,
      }),
    );
  };

  const handleReset = () => {
    setEntityType(ALL_VALUE);
    setActorId(ALL_VALUE);
    setAction(ALL_VALUE);
    setDateFrom("");
    setDateTo("");
    router.push("/settings/audit-log");
  };

  const handleGoToPage = (newPage: number) => {
    router.push(
      buildUrl({
        entityType: filters.entityType,
        actorId: filters.actorId,
        action: filters.action,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        page: newPage,
      }),
    );
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = filters.page;
  const isFirstPage = currentPage <= 0;
  const isLastPage = currentPage >= totalPages - 1;

  // Show the metadata column only if at least one row in the page actually
  // has a metadata payload. Most audit rows don't, so hiding the column
  // keeps the table readable.
  const showMetadataColumn = rows.some((r) => r.metadata !== null);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Filter bar */}
        <form
          onSubmit={handleApply}
          className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 px-4 py-3"
        >
          <div className="space-y-1.5 min-w-44">
            <Label className="text-xs text-muted-foreground">Entity type</Label>
            <Select value={entityType} onValueChange={(v) => v && setEntityType(v)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All entity types</SelectItem>
                {filterOptions.entityTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 min-w-44">
            <Label className="text-xs text-muted-foreground">Action</Label>
            <Select value={action} onValueChange={(v) => v && setAction(v)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All actions</SelectItem>
                {filterOptions.actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 min-w-56">
            <Label className="text-xs text-muted-foreground">Actor</Label>
            <Select value={actorId} onValueChange={(v) => v && setActorId(v)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All actors</SelectItem>
                {filterOptions.actors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 w-auto text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 w-auto text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleReset}
            >
              Reset
            </Button>
          </div>
        </form>

        {/* Results */}
        {rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit log entries match these filters."
            description="Try widening the date range or clearing the filters."
          />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Old → New</TableHead>
                  {showMetadataColumn && <TableHead>Metadata</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const delta = valueDelta(row.oldValue, row.newValue);
                  const actorDisplay = row.actorName ?? row.actorId ?? "—";
                  const entityNameDisplay = row.entityName ?? row.entityId;
                  const metadataString =
                    row.metadata !== null
                      ? JSON.stringify(row.metadata)
                      : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {formatWhen(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{actorDisplay}</TableCell>
                      <TableCell className="text-sm">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="cursor-help">
                                <span className="text-muted-foreground">
                                  {row.entityType}
                                </span>{" "}
                                / {entityNameDisplay}
                              </span>
                            }
                          />
                          <TooltipContent className="font-mono text-xs">
                            id: {row.entityId}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Badge variant="subtle-muted" className="font-mono">
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.field ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {delta.full !== null ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="cursor-help font-mono text-xs">
                                  {delta.display}
                                </span>
                              }
                            />
                            <TooltipContent className="max-w-md whitespace-pre-wrap break-words font-mono text-xs">
                              {delta.full}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {showMetadataColumn && (
                        <TableCell className="text-sm">
                          {metadataString !== null ? (
                            <details className="group inline-block max-w-md">
                              <summary className="cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground">
                                {truncate(metadataString, 60)}
                              </summary>
                              <pre className="mt-2 max-w-md whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
                                {JSON.stringify(row.metadata, null, 2)}
                              </pre>
                            </details>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <div>
              Page {currentPage + 1} of {totalPages} (total: {totalCount.toLocaleString()})
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isFirstPage}
                onClick={() => handleGoToPage(currentPage - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isLastPage}
                onClick={() => handleGoToPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
