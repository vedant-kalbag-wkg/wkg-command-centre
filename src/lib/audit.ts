import { db as defaultDb } from "@/db";
import { auditLogs } from "@/db/schema";

// Drizzle DB shape — kept loose so callers can inject a test-container
// `node-postgres`-backed instance OR rely on the prod `postgres-js` default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { insert: (...args: any[]) => any };

export async function writeAuditLog(
  entry: {
    actorId: string;
    actorName: string;
    entityType: "kiosk" | "location" | "installation" | "user" | "sales_import" | "analytics_preset" | "outlet_exclusion" | "business_event" | "event_category" | "impersonation" | "app_setting" | "location_flag" | "experiment_cohort" | "action_item" | "commission_ledger" | "product_code_fallback" | "cache";
    entityId: string;
    entityName: string;
    action:
      | "create"
      | "update"
      | "archive"
      | "assign"
      | "unassign"
      | "delete"
      | "merge"
      | "stage"
      | "commit"
      | "cancel"
      | "start_impersonation"
      | "stop_impersonation"
      | "flag"
      | "resolve"
      | "recalculate"
      | "purge";
    field?: string;
    oldValue?: string;
    newValue?: string;
    metadata?: Record<string, unknown>;
  },
  // Optional db override — defaults to the production singleton. Tests inject
  // their testcontainers db so writes land in the same isolated database the
  // assertions read from.
  db: AnyDb = defaultDb,
) {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    actorName: entry.actorName,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityName: entry.entityName,
    action: entry.action,
    field: entry.field,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    metadata: entry.metadata,
    createdAt: new Date(),
  });
}
