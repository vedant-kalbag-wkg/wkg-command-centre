import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function writeAuditLog(entry: {
  actorId: string;
  actorName: string;
  entityType: "kiosk" | "location" | "installation";
  entityId: string;
  entityName: string;
  action: "create" | "update" | "archive" | "assign" | "unassign" | "delete";
  field?: string;
  oldValue?: string;
  newValue?: string;
}) {
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
    createdAt: new Date(),
  });
}
