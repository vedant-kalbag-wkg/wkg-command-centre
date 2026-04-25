"use server";

import { revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  runMondayImport,
  type MondayImportResult,
} from "@/lib/monday/import-location-products";

// Different from the Azure ETL advisory lock (738294105) so the two systems
// don't starve each other.
const LOCK_KEY = 738294106;

export type MondayImportActionResult =
  | { status: "success"; result: MondayImportResult }
  | { status: "lock_contention" }
  | { status: "missing_token" }
  | { status: "error"; message: string };

/**
 * Admin-gated trigger for the Monday location-products import. Same library
 * function the CLI uses (`runMondayImport`), wrapped with:
 *   1. requireRole('admin')
 *   2. pg_try_advisory_lock — prevents concurrent runs (two admins clicking
 *      at once would otherwise race on the TRUNCATE+insert)
 *   3. audit_logs entry — records who triggered it and the structured result
 *   4. revalidateTag('analytics') — commission/placeholder data feeds
 *      analytics surfaces; tag eviction makes them re-fetch next request
 */
export async function triggerMondayImportAction(): Promise<MondayImportActionResult> {
  const session = await requireRole("admin");

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return { status: "missing_token" };

  // pg_try_advisory_lock returns a boolean — we cast to boolean so the
  // driver hands us a real JS bool regardless of postgres-js vs neon-serverless.
  // `.rows` works for neon; postgres-js returns an array-like. Handle both.
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${LOCK_KEY})::boolean AS lock`,
  );
  const lockRows =
    lockResult && typeof lockResult === "object" && "rows" in lockResult
      ? (lockResult as { rows: Array<{ lock: boolean }> }).rows
      : (lockResult as unknown as Array<{ lock: boolean }>);
  const acquired = lockRows[0]?.lock === true;
  if (!acquired) return { status: "lock_contention" };

  try {
    const result = await runMondayImport({ mondayApiToken: token, db });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "system",
      entityId: "monday-import",
      entityName: "Monday location-products import",
      action: "monday_import_triggered",
      metadata: {
        rowsInserted: result.rowsInserted,
        placeholdersCreated: result.placeholdersCreated,
        placeholderNames: result.placeholderNames,
        hotelsSkipped: result.hotelsSkipped,
        productsResolved: result.productsResolved,
        providersResolved: result.providersResolved,
        durationMs: result.durationMs,
      },
    });

    revalidateTag("analytics", "max");

    return { status: "success", result };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    // Best-effort release — if this throws (e.g. connection died) the lock
    // auto-releases at session end anyway. We swallow the error so the
    // original result still reaches the caller.
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    } catch {
      // ignore — advisory locks are session-scoped, they self-release.
    }
  }
}
