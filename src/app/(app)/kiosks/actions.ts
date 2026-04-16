"use server";

import { z } from "zod/v4";
import { db } from "@/db";
import {
  kiosks,
  kioskAssignments,
  pipelineStages,
  locations,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, and, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createKioskSchema = z.object({
  kioskId: z.string().min(1, "Kiosk ID is required"),
  outletCode: z.string().optional(),
  hardwareModel: z.string().optional(),
  hardwareSerialNumber: z.string().optional(),
  softwareVersion: z.string().optional(),
  cmsConfigStatus: z.string().optional(),
  installationDate: z.string().optional(),
  deploymentPhaseTags: z.array(z.string()).optional(),
  maintenanceFee: z.string().optional(),
  freeTrialStatus: z.boolean().optional(),
  freeTrialEndDate: z.string().optional(),
  regionGroup: z.string().optional(),
  pipelineStageId: z.string().optional(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

export type KioskWithRelations = {
  id: string;
  kioskId: string;
  outletCode: string | null;
  hardwareModel: string | null;
  hardwareSerialNumber: string | null;
  softwareVersion: string | null;
  cmsConfigStatus: string | null;
  installationDate: Date | null;
  deploymentPhaseTags: string[] | null;
  maintenanceFee: string | null;
  freeTrialStatus: boolean | null;
  freeTrialEndDate: Date | null;
  regionGroup: string | null;
  pipelineStageId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  pipelineStage: { id: string; name: string; color: string | null } | null;
  currentAssignment: {
    id: string;
    locationId: string;
    locationName: string;
    assignedAt: Date;
    reason: string | null;
    assignedBy: string;
    assignedByName: string;
  } | null;
  assignmentHistory: Array<{
    id: string;
    locationId: string;
    locationName: string;
    assignedAt: Date;
    unassignedAt: Date | null;
    reason: string | null;
    assignedByName: string;
  }>;
};

export type KioskListItem = {
  id: string;
  kioskId: string;
  outletCode: string | null;
  hardwareSerialNumber: string | null;  // "Asset" column per MIGR-12
  hardwareModel: string | null;
  softwareVersion: string | null;
  cmsConfigStatus: string | null;
  installationDate: Date | null;
  maintenanceFee: string | null;
  freeTrialStatus: boolean | null;
  freeTrialEndDate: Date | null;
  regionGroup: string | null;
  pipelineStageId: string | null;
  pipelineStageName: string | null;
  pipelineStageColor: string | null;
  venueName: string | null;
  createdAt: Date;
  archivedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createKiosk(data: z.input<typeof createKioskSchema>) {
  try {
    const session = await requireRole("admin", "member");
    const validated = createKioskSchema.parse(data);

    // Get default pipeline stage if not provided
    let pipelineStageId = validated.pipelineStageId;
    if (!pipelineStageId) {
      const [defaultStage] = await db
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(eq(pipelineStages.isDefault, true))
        .limit(1);
      pipelineStageId = defaultStage?.id;
    }

    const [newKiosk] = await db
      .insert(kiosks)
      .values({
        kioskId: validated.kioskId,
        outletCode: validated.outletCode || null,
        hardwareModel: validated.hardwareModel || null,
        hardwareSerialNumber: validated.hardwareSerialNumber || null,
        softwareVersion: validated.softwareVersion || null,
        cmsConfigStatus: validated.cmsConfigStatus || null,
        installationDate: validated.installationDate
          ? new Date(validated.installationDate)
          : null,
        deploymentPhaseTags: validated.deploymentPhaseTags?.length ? validated.deploymentPhaseTags : null,
        maintenanceFee: validated.maintenanceFee || null,
        freeTrialStatus: validated.freeTrialStatus ?? false,
        freeTrialEndDate: validated.freeTrialEndDate
          ? new Date(validated.freeTrialEndDate)
          : null,
        regionGroup: validated.regionGroup || null,
        pipelineStageId: pipelineStageId || null,
        notes: validated.notes || null,
      })
      .returning({ id: kiosks.id, kioskId: kiosks.kioskId });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "kiosk",
      entityId: newKiosk.id,
      entityName: newKiosk.kioskId,
      action: "create",
    });

    return { success: true as const, id: newKiosk.id };
  } catch (error) {
    console.error("[createKiosk] Full error:", error);
    if (error instanceof Error && (error as any).cause) {
      console.error("[createKiosk] Cause:", (error as any).cause);
    }
    const message = error instanceof Error ? error.message : "Failed to create kiosk";
    return { error: message };
  }
}

export async function getKiosk(id: string): Promise<
  { kiosk: KioskWithRelations } | { error: string }
> {
  try {
    const [row] = await db
      .select()
      .from(kiosks)
      .where(eq(kiosks.id, id))
      .limit(1);

    if (!row) return { error: "Kiosk not found" };

    // Fetch pipeline stage
    const stage = row.pipelineStageId
      ? (
          await db
            .select({ id: pipelineStages.id, name: pipelineStages.name, color: pipelineStages.color })
            .from(pipelineStages)
            .where(eq(pipelineStages.id, row.pipelineStageId))
            .limit(1)
        )[0] ?? null
      : null;

    // Fetch current assignment (where unassignedAt IS NULL)
    const currentAssignmentRows = await db
      .select({
        id: kioskAssignments.id,
        locationId: kioskAssignments.locationId,
        assignedAt: kioskAssignments.assignedAt,
        reason: kioskAssignments.reason,
        assignedBy: kioskAssignments.assignedBy,
        assignedByName: kioskAssignments.assignedByName,
        locationName: locations.name,
      })
      .from(kioskAssignments)
      .innerJoin(locations, eq(kioskAssignments.locationId, locations.id))
      .where(
        and(
          eq(kioskAssignments.kioskId, id),
          isNull(kioskAssignments.unassignedAt)
        )
      )
      .limit(1);

    const currentAssignment =
      currentAssignmentRows.length > 0
        ? {
            id: currentAssignmentRows[0].id,
            locationId: currentAssignmentRows[0].locationId,
            locationName: currentAssignmentRows[0].locationName,
            assignedAt: currentAssignmentRows[0].assignedAt,
            reason: currentAssignmentRows[0].reason,
            assignedBy: currentAssignmentRows[0].assignedBy,
            assignedByName: currentAssignmentRows[0].assignedByName,
          }
        : null;

    // Fetch assignment history (all, including current)
    const historyRows = await db
      .select({
        id: kioskAssignments.id,
        locationId: kioskAssignments.locationId,
        assignedAt: kioskAssignments.assignedAt,
        unassignedAt: kioskAssignments.unassignedAt,
        reason: kioskAssignments.reason,
        assignedByName: kioskAssignments.assignedByName,
        locationName: locations.name,
      })
      .from(kioskAssignments)
      .innerJoin(locations, eq(kioskAssignments.locationId, locations.id))
      .where(eq(kioskAssignments.kioskId, id))
      .orderBy(desc(kioskAssignments.assignedAt));

    return {
      kiosk: {
        ...row,
        pipelineStage: stage,
        currentAssignment,
        assignmentHistory: historyRows.map((h) => ({
          id: h.id,
          locationId: h.locationId,
          locationName: h.locationName,
          assignedAt: h.assignedAt,
          unassignedAt: h.unassignedAt,
          reason: h.reason,
          assignedByName: h.assignedByName,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch kiosk";
    return { error: message };
  }
}

export async function updateKioskField(
  kioskId: string,
  field: string,
  value: string | boolean | null,
  oldValue?: string
) {
  try {
    const session = await requireRole("admin", "member");

    // Get current kiosk name for audit log
    const [row] = await db
      .select({ kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(eq(kiosks.id, kioskId))
      .limit(1);

    if (!row) return { error: "Kiosk not found" };

    // Build the update object dynamically
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Handle typed fields
    if (field === "installationDate" || field === "freeTrialEndDate") {
      updateData[
        field === "installationDate" ? "installationDate" : "freeTrialEndDate"
      ] = value ? new Date(value as string) : null;
    } else if (field === "freeTrialStatus") {
      updateData.freeTrialStatus = Boolean(value);
    } else if (field === "cmsConfigStatus") {
      // cmsConfigStatus stored as text, but toggled as boolean in UI
      updateData.cmsConfigStatus = value ? "configured" : "not_configured";
    } else if (field === "maintenanceFee") {
      updateData.maintenanceFee = value as string;
    } else if (field === "deploymentPhaseTags") {
      updateData.deploymentPhaseTags = value
        ? (value as string).split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    } else {
      updateData[field] = value as string;
    }

    await db.update(kiosks).set(updateData).where(eq(kiosks.id, kioskId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "kiosk",
      entityId: kioskId,
      entityName: row.kioskId,
      action: "update",
      field,
      oldValue: oldValue,
      newValue: value !== null && value !== undefined ? String(value) : undefined,
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update field";
    return { error: message };
  }
}

export async function archiveKiosk(kioskId: string) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(eq(kiosks.id, kioskId))
      .limit(1);

    if (!row) return { error: "Kiosk not found" };

    await db
      .update(kiosks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(kiosks.id, kioskId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "kiosk",
      entityId: kioskId,
      entityName: row.kioskId,
      action: "archive",
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive kiosk";
    return { error: message };
  }
}

export async function assignKiosk(
  kioskId: string,
  locationId: string,
  reason?: string
) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(eq(kiosks.id, kioskId))
      .limit(1);

    if (!row) return { error: "Kiosk not found" };

    const [locationRow] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!locationRow) return { error: "Location not found" };

    // Close existing open assignment
    await db
      .update(kioskAssignments)
      .set({ unassignedAt: new Date() })
      .where(
        and(
          eq(kioskAssignments.kioskId, kioskId),
          isNull(kioskAssignments.unassignedAt)
        )
      );

    // Insert new assignment
    await db.insert(kioskAssignments).values({
      kioskId,
      locationId,
      reason: reason ?? null,
      assignedBy: session.user.id,
      assignedByName: session.user.name,
    });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "kiosk",
      entityId: kioskId,
      entityName: row.kioskId,
      action: "assign",
      field: "venue",
      newValue: locationRow.name,
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to assign kiosk";
    return { error: message };
  }
}

export async function reassignKiosk(
  kioskId: string,
  newLocationId: string,
  reason?: string
) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ kioskId: kiosks.kioskId })
      .from(kiosks)
      .where(eq(kiosks.id, kioskId))
      .limit(1);

    if (!row) return { error: "Kiosk not found" };

    // Get old location name from current assignment
    const [currentAssignment] = await db
      .select({ locationName: locations.name })
      .from(kioskAssignments)
      .innerJoin(locations, eq(kioskAssignments.locationId, locations.id))
      .where(
        and(
          eq(kioskAssignments.kioskId, kioskId),
          isNull(kioskAssignments.unassignedAt)
        )
      )
      .limit(1);

    const oldLocationName = currentAssignment?.locationName ?? undefined;

    const [newLocation] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, newLocationId))
      .limit(1);

    if (!newLocation) return { error: "Location not found" };

    // Close existing open assignment
    await db
      .update(kioskAssignments)
      .set({ unassignedAt: new Date() })
      .where(
        and(
          eq(kioskAssignments.kioskId, kioskId),
          isNull(kioskAssignments.unassignedAt)
        )
      );

    // Insert new assignment
    await db.insert(kioskAssignments).values({
      kioskId,
      locationId: newLocationId,
      reason: reason ?? null,
      assignedBy: session.user.id,
      assignedByName: session.user.name,
    });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "kiosk",
      entityId: kioskId,
      entityName: row.kioskId,
      action: "assign",
      field: "venue",
      oldValue: oldLocationName,
      newValue: newLocation.name,
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reassign kiosk";
    return { error: message };
  }
}

export async function listKiosks(): Promise<KioskListItem[]> {
  try {
    const rows = await db
      .select({
        id: kiosks.id,
        kioskId: kiosks.kioskId,
        outletCode: kiosks.outletCode,
        hardwareSerialNumber: kiosks.hardwareSerialNumber,
        hardwareModel: kiosks.hardwareModel,
        softwareVersion: kiosks.softwareVersion,
        cmsConfigStatus: kiosks.cmsConfigStatus,
        installationDate: kiosks.installationDate,
        maintenanceFee: kiosks.maintenanceFee,
        freeTrialStatus: kiosks.freeTrialStatus,
        freeTrialEndDate: kiosks.freeTrialEndDate,
        regionGroup: kiosks.regionGroup,
        pipelineStageId: kiosks.pipelineStageId,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        createdAt: kiosks.createdAt,
        archivedAt: kiosks.archivedAt,
      })
      .from(kiosks)
      .leftJoin(pipelineStages, eq(kiosks.pipelineStageId, pipelineStages.id))
      .where(isNull(kiosks.archivedAt))
      .orderBy(desc(kiosks.createdAt));

    // Fetch current venue for each kiosk
    const kioskIds = rows.map((r) => r.id);
    const assignments =
      kioskIds.length > 0
        ? await db
            .select({
              kioskId: kioskAssignments.kioskId,
              locationName: locations.name,
            })
            .from(kioskAssignments)
            .innerJoin(locations, eq(kioskAssignments.locationId, locations.id))
            .where(isNull(kioskAssignments.unassignedAt))
        : [];

    const venueMap = new Map(assignments.map((a) => [a.kioskId, a.locationName]));

    return rows.map((r) => ({
      id: r.id,
      kioskId: r.kioskId,
      outletCode: r.outletCode,
      hardwareSerialNumber: r.hardwareSerialNumber,
      hardwareModel: r.hardwareModel,
      softwareVersion: r.softwareVersion,
      cmsConfigStatus: r.cmsConfigStatus,
      installationDate: r.installationDate,
      maintenanceFee: r.maintenanceFee,
      freeTrialStatus: r.freeTrialStatus,
      freeTrialEndDate: r.freeTrialEndDate,
      regionGroup: r.regionGroup,
      pipelineStageId: r.pipelineStageId,
      pipelineStageName: r.stageName ?? null,
      pipelineStageColor: r.stageColor ?? null,
      venueName: venueMap.get(r.id) ?? null,
      createdAt: r.createdAt,
      archivedAt: r.archivedAt,
    }));
  } catch {
    return [];
  }
}

export async function listPipelineStages() {
  return db
    .select()
    .from(pipelineStages)
    .orderBy(pipelineStages.position);
}

export async function listLocationsForSelect() {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(isNull(locations.archivedAt))
    .orderBy(locations.name);
}
