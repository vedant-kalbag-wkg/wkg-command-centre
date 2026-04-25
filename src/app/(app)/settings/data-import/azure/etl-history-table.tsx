"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Cloud } from "lucide-react";
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
import type { EtlHistoryRow } from "./pipeline";

interface EtlHistoryTableProps {
  rows: EtlHistoryRow[];
  totalCount: number;
  filters: {
    status?: string;
    regionCode?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
  };
  filterRegions: Array<{ code: string; name: string }>;
  pageSize: number;
}

// Sentinel value for "All" — base-ui's Select doesn't allow empty values.
const ALL_VALUE = "__all__";

const BLOB_PATH_TRUNCATE = 50;
const ERROR_TRUNCATE = 80;

function formatProcessedAt(d: Date): string {
  const date = new Date(d);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export function EtlHistoryTable({
  rows,
  totalCount,
  filters,
  filterRegions,
  pageSize,
}: EtlHistoryTableProps) {
  const router = useRouter();

  // Local form state seeded from URL filters. Submitting pushes back into
  // the URL, which triggers an RSC re-render with the new data.
  const [status, setStatus] = React.useState<string>(
    filters.status ?? ALL_VALUE,
  );
  const [regionCode, setRegionCode] = React.useState<string>(
    filters.regionCode ?? ALL_VALUE,
  );
  const [dateFrom, setDateFrom] = React.useState<string>(filters.dateFrom ?? "");
  const [dateTo, setDateTo] = React.useState<string>(filters.dateTo ?? "");

  // Re-sync form state when URL changes (browser back/forward, Reset).
  const prevFiltersRef = React.useRef(filters);
  React.useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.status !== filters.status ||
      prev.regionCode !== filters.regionCode ||
      prev.dateFrom !== filters.dateFrom ||
      prev.dateTo !== filters.dateTo
    ) {
      setStatus(filters.status ?? ALL_VALUE);
      setRegionCode(filters.regionCode ?? ALL_VALUE);
      setDateFrom(filters.dateFrom ?? "");
      setDateTo(filters.dateTo ?? "");
    }
    prevFiltersRef.current = filters;
  }, [filters]);

  const buildUrl = React.useCallback(
    (overrides: {
      status?: string;
      regionCode?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
    }) => {
      const params = new URLSearchParams();
      const set = (key: string, value: string | undefined) => {
        if (value && value !== ALL_VALUE) params.set(key, value);
      };
      set("status", overrides.status);
      set("regionCode", overrides.regionCode);
      set("dateFrom", overrides.dateFrom);
      set("dateTo", overrides.dateTo);
      if (overrides.page && overrides.page > 0) {
        params.set("page", String(overrides.page));
      }
      const qs = params.toString();
      return qs
        ? `/settings/data-import/azure?${qs}`
        : "/settings/data-import/azure";
    },
    [],
  );

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(
      buildUrl({
        status,
        regionCode,
        dateFrom,
        dateTo,
        page: 0,
      }),
    );
  };

  const handleReset = () => {
    setStatus(ALL_VALUE);
    setRegionCode(ALL_VALUE);
    setDateFrom("");
    setDateTo("");
    router.push("/settings/data-import/azure");
  };

  const handleGoToPage = (newPage: number) => {
    router.push(
      buildUrl({
        status: filters.status,
        regionCode: filters.regionCode,
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

  // Hide the error column entirely when no row on the current page has an
  // error. Most pages are all-success → cleaner table.
  const showErrorColumn = rows.some((r) => r.errorMessage !== null);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Filter bar */}
        <form
          onSubmit={handleApply}
          className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 px-4 py-3"
        >
          <div className="space-y-1.5 min-w-36">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 min-w-44">
            <Label className="text-xs text-muted-foreground">Region</Label>
            <Select
              value={regionCode}
              onValueChange={(v) => v && setRegionCode(v)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All regions</SelectItem>
                {filterRegions.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.code} — {r.name}
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
            icon={Cloud}
            title="No ETL runs recorded yet — has the Azure cron triggered?"
            description="Check /settings/data-import/sales for the run-trigger button, or widen the filters above."
          />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead className="whitespace-nowrap">
                    Processed at
                  </TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Blob path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  {showErrorColumn && <TableHead>Error</TableHead>}
                  <TableHead>Import</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatProcessedAt(row.processedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="subtle-muted" className="font-mono">
                        {row.regionCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.blobPath.length > BLOB_PATH_TRUNCATE ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="cursor-help">
                                {truncate(row.blobPath, BLOB_PATH_TRUNCATE)}
                              </span>
                            }
                          />
                          <TooltipContent className="max-w-md break-all font-mono text-xs">
                            {row.blobPath}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        row.blobPath
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status === "success" ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        >
                          success
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 bg-destructive/10 text-destructive"
                        >
                          failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {row.rowCount !== null ? (
                        row.rowCount.toLocaleString()
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {showErrorColumn && (
                      <TableCell className="text-sm">
                        {row.errorMessage !== null ? (
                          <details className="group inline-block max-w-md">
                            <summary className="cursor-pointer font-mono text-xs text-destructive hover:text-destructive/80">
                              {truncate(row.errorMessage, ERROR_TRUNCATE)}
                            </summary>
                            <pre className="mt-2 max-w-md whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
                              {row.errorMessage}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">
                      {row.importId !== null ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="cursor-help text-muted-foreground">
                                {row.importId.slice(0, 8)}…
                              </span>
                            }
                          />
                          <TooltipContent className="font-mono text-xs">
                            {row.importId}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <div>
              Page {currentPage + 1} of {totalPages} (total:{" "}
              {totalCount.toLocaleString()})
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
