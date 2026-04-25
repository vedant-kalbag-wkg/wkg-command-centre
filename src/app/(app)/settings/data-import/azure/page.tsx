import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  ETL_HISTORY_PAGE_SIZE,
  _getEtlSummaryForActor,
  _listEtlBlobIngestionsForActor,
  _listEtlHistoryFilterRegionsForActor,
  type EtlHistoryFilters,
  type EtlSummary,
} from "./pipeline";
import { EtlHistoryTable } from "./etl-history-table";

/**
 * Search params land here as `string | string[] | undefined`. We only
 * ever write a single value per key, so coalesce arrays to the first
 * element and treat empty strings as undefined.
 */
function readParam(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (!v) return undefined;
  return v;
}

/**
 * Date inputs in HTML are local-tz "YYYY-MM-DD" strings. The
 * sales_blob_ingestions `processed_at` is a timestamptz stored in UTC.
 * Same convention as the audit-log viewer:
 *   dateFrom → UTC midnight of that day (inclusive lower bound)
 *   dateTo   → UTC midnight of the *next* day (so the entire dateTo day
 *              is captured via `processedAt < nextDayMidnightUTC`)
 */
function parseDateFrom(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseDateToExclusiveNextDay(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function formatTimestamp(d: Date): string {
  const date = new Date(d);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

function SummaryCards({ summary }: { summary: EtlSummary }) {
  const last7dTotal = summary.last7dSuccess + summary.last7dFailed;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card size="sm">
        <CardContent className="px-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Total processed
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {summary.totalProcessed.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">lifetime blobs</p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="px-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Last 7 days
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              {summary.last7dSuccess.toLocaleString()}
            </span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-destructive">
              {summary.last7dFailed.toLocaleString()}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {last7dTotal.toLocaleString()} runs · success / failed
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="px-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Latest success
          </p>
          {summary.latestSuccess ? (
            <>
              <p className="mt-1 font-mono text-sm font-semibold">
                {formatTimestamp(summary.latestSuccess.processedAt)}
              </p>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={summary.latestSuccess.blobPath}
              >
                <span className="font-mono">
                  {summary.latestSuccess.regionCode}
                </span>{" "}
                · {summary.latestSuccess.blobPath}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No successful runs yet
            </p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="px-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Currently failed
          </p>
          <p
            className={
              "mt-1 text-2xl font-semibold tabular-nums " +
              (summary.currentlyFailed > 0
                ? "text-destructive"
                : "text-foreground")
            }
          >
            {summary.currentlyFailed.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.currentlyFailed > 0
              ? "will retry on next run"
              : "all clear"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function AzureEtlHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  const sp = await searchParams;
  const statusRaw = readParam(sp.status);
  const regionCode = readParam(sp.regionCode);
  const dateFromRaw = readParam(sp.dateFrom);
  const dateToRaw = readParam(sp.dateTo);
  const pageRaw = readParam(sp.page);
  const pageNum = pageRaw ? Math.max(0, Number.parseInt(pageRaw, 10) || 0) : 0;

  // Coerce status — anything other than the two known values means "all".
  const status: "success" | "failed" | undefined =
    statusRaw === "success" || statusRaw === "failed" ? statusRaw : undefined;

  const filters: EtlHistoryFilters = {
    status,
    regionCode,
    dateFrom: parseDateFrom(dateFromRaw),
    dateTo: parseDateToExclusiveNextDay(dateToRaw),
    page: pageNum,
  };

  const [{ rows, totalCount }, filterRegions, summary] = await Promise.all([
    _listEtlBlobIngestionsForActor(db, filters),
    _listEtlHistoryFilterRegionsForActor(db),
    _getEtlSummaryForActor(db),
  ]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Azure ETL Runs"
        description="Per-blob run history for the Azure-blob → sales_records ETL. Filter by status, region, or date to inspect retries; failed rows automatically re-run on the next ETL tick."
        count={totalCount}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <SummaryCards summary={summary} />
        <EtlHistoryTable
          rows={rows}
          totalCount={totalCount}
          filters={{
            status: statusRaw,
            regionCode,
            dateFrom: dateFromRaw,
            dateTo: dateToRaw,
            page: pageNum,
          }}
          filterRegions={filterRegions}
          pageSize={ETL_HISTORY_PAGE_SIZE}
        />
      </div>
    </div>
  );
}
