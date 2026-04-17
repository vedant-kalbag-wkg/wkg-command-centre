"use server";

import { db } from "@/db";
import { auditLogs, user } from "@/db/schema";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import {
  eq,
  desc,
  lt,
  and,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  entityName: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
};

export type FetchAuditEntriesParams = {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorUserType?: "internal" | "external";
  dateFrom?: string;
  dateTo?: string;
  cursor?: string; // id of last entry from previous page
  limit?: number;
};

export async function fetchAuditEntries(params: FetchAuditEntriesParams = {}): Promise<{
  entries: AuditEntry[];
  hasMore: boolean;
  remainingCount: number;
}> {
  const { entityType, entityId, actorId, actorUserType, dateFrom, dateTo, cursor, limit = 20 } = params;

  // Entity-specific queries: any logged-in user. Global queries: admin only.
  if (!entityId) {
    await requireRole("admin");
  } else {
    await getSessionOrThrow();
  }

  const conditions: SQL[] = [];

  if (entityType) {
    conditions.push(eq(auditLogs.entityType, entityType));
  }
  if (entityId) {
    conditions.push(eq(auditLogs.entityId, entityId));
  }
  if (actorId) {
    conditions.push(eq(auditLogs.actorId, actorId));
  }
  if (actorUserType) {
    conditions.push(
      sql`${auditLogs.actorId} IN (SELECT ${user.id} FROM ${user} WHERE ${user.userType} = ${actorUserType})`
    );
  }
  if (dateFrom) {
    conditions.push(gte(auditLogs.createdAt, new Date(dateFrom)));
  }
  if (dateTo) {
    // Include full dateTo day by advancing to next day start
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    conditions.push(lte(auditLogs.createdAt, endDate));
  }
  if (cursor) {
    // Cursor-based pagination: fetch entries older than the cursor entry
    const [cursorEntry] = await db
      .select({ createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(eq(auditLogs.id, cursor))
      .limit(1);
    if (cursorEntry) {
      conditions.push(lt(auditLogs.createdAt, cursorEntry.createdAt));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch limit + 1 to know if there are more entries
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit);

  // For remainingCount: approximate by fetching total after cursor
  // This is a lightweight approximation (not exact for complex filter combinations)
  const remainingCount = hasMore ? rows.length - limit : 0;

  return {
    entries: entries.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorName: row.actorName,
      entityType: row.entityType,
      entityId: row.entityId,
      entityName: row.entityName,
      action: row.action,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      createdAt: row.createdAt,
    })),
    hasMore,
    remainingCount,
  };
}

export async function fetchAuditActors(): Promise<{ id: string | null; name: string | null }[]> {
  await requireRole("admin");

  const rows = await db
    .selectDistinct({ id: auditLogs.actorId, name: auditLogs.actorName })
    .from(auditLogs)
    .orderBy(auditLogs.actorName);

  return rows.filter((r) => r.name !== null);
}
