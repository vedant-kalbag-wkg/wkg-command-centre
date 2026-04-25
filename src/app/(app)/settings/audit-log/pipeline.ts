/**
 * Audit-log viewer pipeline — internal helpers.
 *
 * No `"use server"` directive: this file exports types alongside async
 * helpers (the `"use server"` boundary only allows async function exports
 * and we want callers to import the row/filter shapes too). The page is a
 * pure RSC and calls these helpers directly with the singleton `db`.
 *
 * `_*ForActor` helpers accept the db as an explicit parameter so the
 * integration tests can drive them against a Testcontainers Postgres.
 */

import { and, asc, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { auditLogs } from "@/db/schema";

// Loose db type so callers can inject a testcontainers node-pg drizzle
// instance OR rely on the production postgres-js default. Mirrors the
// convention in `outlet-types/pipeline.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export const AUDIT_LOG_PAGE_SIZE = 100;

export type AuditLogFilters = {
  entityType?: string;
  actorId?: string;
  action?: string;
  /** Inclusive lower bound. The page passes a UTC midnight Date for the day. */
  dateFrom?: Date;
  /** Inclusive upper bound. The page passes the next-day UTC midnight so the
   *  whole `dateTo` day is covered (createdAt < nextDay 00:00 UTC). */
  dateTo?: Date;
  /** Zero-based page index. */
  page?: number;
};

export type AuditLogRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  entityName: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: unknown;
};

export type FilterOptions = {
  entityTypes: string[];
  actions: string[];
  /** Distinct (actorId, actorName) pairs sorted by display name. Rows whose
   *  actorId is null (no historical case in prod, but defensive) are
   *  excluded — there's no useful filter you could build off them. */
  actors: Array<{ id: string; name: string }>;
};

function buildWhere(filters: AuditLogFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.entityType) conds.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.actorId) conds.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.action) conds.push(eq(auditLogs.action, filters.action));
  if (filters.dateFrom) conds.push(gte(auditLogs.createdAt, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(auditLogs.createdAt, filters.dateTo));
  return conds.length > 0 ? and(...conds) : undefined;
}

/**
 * List a single page of audit_log rows ordered by createdAt desc, with the
 * total count for the current filter set so the client can render
 * "Page N of M (total: K)".
 *
 * Page + count run in parallel — same WHERE clause, no JOINs (actorName is
 * denormalised on the row), so both queries are single-table scans.
 */
export async function _listAuditLogsForActor(
  db: AnyDb,
  filters: AuditLogFilters,
): Promise<{ rows: AuditLogRow[]; totalCount: number }> {
  const where = buildWhere(filters);
  const offset = (filters.page ?? 0) * AUDIT_LOG_PAGE_SIZE;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(AUDIT_LOG_PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);

  return {
    rows: rows as AuditLogRow[],
    totalCount: Number(count),
  };
}

/**
 * Distinct entity types, actions, and actors that appear in `audit_logs`.
 * Used to populate the filter-bar dropdowns — we only show values that
 * actually exist, so there's no dead "filter to zero results" state.
 */
export async function _listAuditLogFilterValuesForActor(
  db: AnyDb,
): Promise<FilterOptions> {
  const [entityTypeRows, actionRows, actorRows] = await Promise.all([
    db
      .selectDistinct({ entityType: auditLogs.entityType })
      .from(auditLogs)
      .orderBy(asc(auditLogs.entityType)),
    db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.action)),
    db
      .selectDistinct({
        id: auditLogs.actorId,
        name: auditLogs.actorName,
      })
      .from(auditLogs)
      .where(isNotNull(auditLogs.actorId))
      .orderBy(asc(auditLogs.actorName)),
  ]);

  return {
    entityTypes: (entityTypeRows as Array<{ entityType: string }>).map(
      (r) => r.entityType,
    ),
    actions: (actionRows as Array<{ action: string }>).map((r) => r.action),
    actors: (actorRows as Array<{ id: string | null; name: string | null }>)
      .filter((r): r is { id: string; name: string | null } => r.id !== null)
      // Display fallback: if a row has actorId but no actorName (system
      // actors like the ETL writer), show the id so the operator can still
      // select it.
      .map((r) => ({ id: r.id, name: r.name ?? r.id })),
  };
}
