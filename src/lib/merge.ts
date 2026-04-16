import { db } from "@/db";
import {
  locations,
  kiosks,
  user,
  kioskAssignments,
  locationProducts,
  installationKiosks,
  installationMembers,
  userViews,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// =============================================================================
// Location merge
// =============================================================================

export async function mergeLocations(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
): Promise<{ success: true; merged: number } | { error: string }> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();

    // Apply field resolutions to target
    if (Object.keys(fieldResolutions).length > 0) {
      await db.update(locations).set(fieldResolutions).where(eq(locations.id, targetId));
    }

    // Re-point FKs
    await db
      .update(kioskAssignments)
      .set({ locationId: targetId })
      .where(inArray(kioskAssignments.locationId, sourceIds));

    await db
      .update(locationProducts)
      .set({ locationId: targetId })
      .where(inArray(locationProducts.locationId, sourceIds));

    // Archive sources
    await db
      .update(locations)
      .set({ archivedAt: new Date() })
      .where(inArray(locations.id, sourceIds));

    // Get target name for audit
    const [target] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, targetId));

    for (const sourceId of sourceIds) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: sourceId,
        entityName: target?.name ?? "",
        action: "merge",
        field: "mergedInto",
        newValue: targetId,
      });
    }

    return { success: true, merged: sourceIds.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to merge locations" };
  }
}

// =============================================================================
// Kiosk merge
// =============================================================================

export async function mergeKiosks(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
): Promise<{ success: true; merged: number } | { error: string }> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();

    if (Object.keys(fieldResolutions).length > 0) {
      await db.update(kiosks).set(fieldResolutions).where(eq(kiosks.id, targetId));
    }

    // Re-point kioskAssignments
    await db
      .update(kioskAssignments)
      .set({ kioskId: targetId })
      .where(inArray(kioskAssignments.kioskId, sourceIds));

    // Re-point installationKiosks — delete source entries to avoid PK conflicts,
    // then insert target entries if not already present
    const sourceInstallations = await db
      .select({ installationId: installationKiosks.installationId })
      .from(installationKiosks)
      .where(inArray(installationKiosks.kioskId, sourceIds));

    await db
      .delete(installationKiosks)
      .where(inArray(installationKiosks.kioskId, sourceIds));

    for (const { installationId } of sourceInstallations) {
      await db
        .insert(installationKiosks)
        .values({ installationId, kioskId: targetId })
        .onConflictDoNothing();
    }

    // Archive sources
    await db
      .update(kiosks)
      .set({ archivedAt: new Date() })
      .where(inArray(kiosks.id, sourceIds));

    const [target] = await db
      .select({ kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(eq(kiosks.id, targetId));

    for (const sourceId of sourceIds) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "kiosk",
        entityId: sourceId,
        entityName: target?.kioskId ?? "",
        action: "merge",
        field: "mergedInto",
        newValue: targetId,
      });
    }

    return { success: true, merged: sourceIds.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to merge kiosks" };
  }
}

// =============================================================================
// User merge (re-point then deactivate)
// =============================================================================

export async function mergeUsers(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
): Promise<{ success: true; merged: number } | { error: string }> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();

    // Apply field resolutions to target
    if (Object.keys(fieldResolutions).length > 0) {
      await db.update(user).set(fieldResolutions).where(eq(user.id, targetId));
    }

    // Re-point locations.internalPocId
    await db
      .update(locations)
      .set({ internalPocId: targetId })
      .where(inArray(locations.internalPocId, sourceIds));

    // Re-point userViews
    await db
      .update(userViews)
      .set({ userId: targetId })
      .where(inArray(userViews.userId, sourceIds));

    // Re-point installationMembers — delete source entries to avoid PK conflicts,
    // then insert target entries if not already present
    const sourceInstallationMemberships = await db
      .select({ installationId: installationMembers.installationId, role: installationMembers.role })
      .from(installationMembers)
      .where(inArray(installationMembers.userId, sourceIds));

    await db
      .delete(installationMembers)
      .where(inArray(installationMembers.userId, sourceIds));

    for (const { installationId, role } of sourceInstallationMemberships) {
      await db
        .insert(installationMembers)
        .values({ installationId, userId: targetId, role })
        .onConflictDoNothing();
    }

    // Get target name for audit
    const [target] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, targetId));

    // Deactivate source users via Better Auth
    for (const sourceId of sourceIds) {
      await auth.api.banUser({
        body: { userId: sourceId, banReason: `Merged into ${target?.name ?? targetId}` },
        headers: await headers(),
      });

      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "user",
        entityId: sourceId,
        entityName: target?.name ?? "",
        action: "merge",
        field: "mergedInto",
        newValue: targetId,
      });
    }

    return { success: true, merged: sourceIds.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to merge users" };
  }
}
