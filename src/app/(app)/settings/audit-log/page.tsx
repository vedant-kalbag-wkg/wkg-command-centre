import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  AUDIT_LOG_PAGE_SIZE,
  _listAuditLogFilterValuesForActor,
  _listAuditLogsForActor,
  type AuditLogFilters,
} from "./pipeline";
import { AuditLogTable } from "./audit-log-table";

/**
 * Search params land here as `string | string[] | undefined`. We only ever
 * write a single value per key from the client, so coalesce arrays to the
 * first element and treat empty strings as undefined.
 */
function readParam(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (!v) return undefined;
  return v;
}

/**
 * Date inputs in HTML are local-tz "YYYY-MM-DD" strings. The audit_logs
 * `created_at` is a timestamptz stored in UTC. Converting at the boundary:
 *   dateFrom → UTC midnight of that day (inclusive lower bound)
 *   dateTo   → UTC midnight of the *next* day (so the entire dateTo day
 *              is included via `createdAt <= nextDayMidnightUTC`)
 *
 * This is "good enough" for an audit viewer — the operator picks dates,
 * not minutes, and a few hours of timezone fuzz at either end is
 * acceptable. The alternative (server-side timezone normalisation) would
 * need the operator's tz, which we don't track.
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

export default async function AuditLogPage({
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
  const entityType = readParam(sp.entityType);
  const actorId = readParam(sp.actorId);
  const action = readParam(sp.action);
  const dateFromRaw = readParam(sp.dateFrom);
  const dateToRaw = readParam(sp.dateTo);
  const pageRaw = readParam(sp.page);
  const pageNum = pageRaw ? Math.max(0, Number.parseInt(pageRaw, 10) || 0) : 0;

  const filters: AuditLogFilters = {
    entityType,
    actorId,
    action,
    dateFrom: parseDateFrom(dateFromRaw),
    dateTo: parseDateToExclusiveNextDay(dateToRaw),
    page: pageNum,
  };

  const [{ rows, totalCount }, filterOptions] = await Promise.all([
    _listAuditLogsForActor(db, filters),
    _listAuditLogFilterValuesForActor(db),
  ]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Audit Log"
        description="Read-only history of every audited change written across the app — outlet classifications, region reassignments, Monday imports, kiosk + location edits, sales imports, and more."
        count={totalCount}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <AuditLogTable
          rows={rows}
          totalCount={totalCount}
          filters={{
            entityType,
            actorId,
            action,
            dateFrom: dateFromRaw,
            dateTo: dateToRaw,
            page: pageNum,
          }}
          filterOptions={filterOptions}
          pageSize={AUDIT_LOG_PAGE_SIZE}
        />
      </div>
    </div>
  );
}
