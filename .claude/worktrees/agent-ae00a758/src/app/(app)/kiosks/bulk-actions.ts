"use server";

import { db } from "@/db";
import { kiosks } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { inArray } from "drizzle-orm";

const ALLOWED_KIOSK_BULK_FIELDS = [
  "pipelineStageId",
  "regionGroup",
  "cmsConfigStatus",
  "deploymentPhaseTags",
] as const;

type AllowedKioskBulkField = (typeof ALLOWED_KIOSK_BULK_FIELDS)[number];

export async function bulkUpdateKiosks(
  kioskIds: string[],
  update: { field: string; value: unknown }
) {
  try {
    if (!kioskIds.length) return { error: "No kiosks selected" };
    if (!ALLOWED_KIOSK_BULK_FIELDS.includes(update.field as AllowedKioskBulkField)) {
      return { error: "Field not allowed for bulk edit" };
    }

    const session = await requireRole("admin", "member");

    // Fetch current values for audit log
    const currentKiosks = await db
      .select({ id: kiosks.id, kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(inArray(kiosks.id, kioskIds));

    // Build update object
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (update.field === "deploymentPhaseTags") {
      updateData.deploymentPhaseTags = Array.isArray(update.value)
        ? update.value
        : typeof update.value === "string"
        ? (update.value as string).split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    } else if (update.field === "cmsConfigStatus") {
      updateData.cmsConfigStatus = update.value ? "configured" : "not_configured";
    } else {
      updateData[update.field] = update.value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(kiosks).set(updateData as any).where(inArray(kiosks.id, kioskIds));

    // Write audit log for each kiosk
    for (const kiosk of currentKiosks) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "kiosk",
        entityId: kiosk.id,
        entityName: kiosk.kioskId,
        action: "update",
        field: update.field,
        newValue: String(update.value ?? ""),
      });
    }

    return { success: true as const, count: kioskIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bulk update kiosks";
    return { error: message };
  }
}

export async function bulkArchiveKiosks(kioskIds: string[]) {
  try {
    if (!kioskIds.length) return { error: "No kiosks selected" };

    const session = await requireRole("admin", "member");

    // Fetch kiosk names for audit log
    const currentKiosks = await db
      .select({ id: kiosks.id, kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(inArray(kiosks.id, kioskIds));

    await db
      .update(kiosks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(inArray(kiosks.id, kioskIds));

    for (const kiosk of currentKiosks) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "kiosk",
        entityId: kiosk.id,
        entityName: kiosk.kioskId,
        action: "archive",
      });
    }

    return { success: true as const, count: kioskIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bulk archive kiosks";
    return { error: message };
  }
}
