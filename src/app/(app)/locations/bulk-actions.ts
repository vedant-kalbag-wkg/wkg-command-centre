"use server";

import { db } from "@/db";
import { locations } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { inArray } from "drizzle-orm";

const ALLOWED_LOCATION_BULK_FIELDS = ["hotelGroup", "sourcedBy", "operatingGroupId"] as const;

type AllowedLocationBulkField = (typeof ALLOWED_LOCATION_BULK_FIELDS)[number];

export async function bulkUpdateLocations(
  locationIds: string[],
  update: { field: string; value: unknown }
) {
  try {
    if (!locationIds.length) return { error: "No locations selected" };
    if (!ALLOWED_LOCATION_BULK_FIELDS.includes(update.field as AllowedLocationBulkField)) {
      return { error: "Field not allowed for bulk edit" };
    }

    const session = await requireRole("admin", "member");

    // Fetch current values for audit log
    const currentLocations = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(inArray(locations.id, locationIds));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(locations).set({ [update.field]: update.value, updatedAt: new Date() } as any).where(inArray(locations.id, locationIds));

    for (const loc of currentLocations) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: loc.id,
        entityName: loc.name,
        action: "update",
        field: update.field,
        newValue: String(update.value ?? ""),
      });
    }

    return { success: true as const, count: locationIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bulk update locations";
    return { error: message };
  }
}

export async function bulkArchiveLocations(locationIds: string[]) {
  try {
    if (!locationIds.length) return { error: "No locations selected" };

    const session = await requireRole("admin", "member");

    const currentLocations = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(inArray(locations.id, locationIds));

    await db
      .update(locations)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(inArray(locations.id, locationIds));

    for (const loc of currentLocations) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: loc.id,
        entityName: loc.name,
        action: "archive",
      });
    }

    return { success: true as const, count: locationIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bulk archive locations";
    return { error: message };
  }
}
