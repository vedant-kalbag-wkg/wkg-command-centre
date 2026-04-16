"use server";

import { z } from "zod/v4";
import { db } from "@/db";
import { locations, kioskAssignments, kiosks } from "@/db/schema";
import { requireRole, canAccessSensitiveFields, redactSensitiveFields } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, and, desc } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createLocationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  address: z.string().optional(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  starRating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  roomCount: z.coerce.number().int().positive().optional().nullable(),
  hotelGroup: z.string().optional(),
  sourcedBy: z.string().optional(),
  notes: z.string().optional(),
  contractValue: z.string().optional(),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional(),
  contractTerms: z.string().optional(),
});

const keyContactSchema = z.object({
  name: z.string().min(1, "Contact name is required"),
  role: z.string().optional().default(""),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().optional().default(""),
});

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

export type LocationWithRelations = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  starRating: number | null;
  roomCount: number | null;
  keyContacts: Array<{ name: string; role: string; email: string; phone: string }> | null;
  hotelGroup: string | null;
  sourcedBy: string | null;
  bankingDetails: unknown;
  contractValue: string | null;
  contractStartDate: Date | null;
  contractEndDate: Date | null;
  contractTerms: string | null;
  contractDocuments: Array<{ fileName: string; s3Key: string; uploadedAt: string }> | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  assignedKiosks: Array<{
    assignmentId: string;
    kioskId: string;
    kioskDisplayId: string;
    pipelineStageId: string | null;
    assignedAt: Date;
    unassignedAt: Date | null;
    reason: string | null;
    assignedByName: string;
  }>;
};

export type LocationListItem = {
  id: string;
  name: string;
  address: string | null;
  hotelGroup: string | null;
  starRating: number | null;
  roomCount: number | null;
  kioskCount: number;
  createdAt: Date;
  archivedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createLocation(data: z.input<typeof createLocationSchema>) {
  try {
    const session = await requireRole("admin", "member");
    const validated = createLocationSchema.parse(data);

    const [newLocation] = await db
      .insert(locations)
      .values({
        name: validated.name,
        address: validated.address || null,
        latitude: validated.latitude ?? null,
        longitude: validated.longitude ?? null,
        starRating: validated.starRating ?? null,
        roomCount: validated.roomCount ?? null,
        hotelGroup: validated.hotelGroup || null,
        sourcedBy: validated.sourcedBy || null,
        notes: validated.notes || null,
        contractValue: validated.contractValue || null,
        contractStartDate: validated.contractStartDate
          ? new Date(validated.contractStartDate)
          : null,
        contractEndDate: validated.contractEndDate
          ? new Date(validated.contractEndDate)
          : null,
        contractTerms: validated.contractTerms || null,
      })
      .returning({ id: locations.id, name: locations.name });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: newLocation.id,
      entityName: newLocation.name,
      action: "create",
    });

    return { success: true as const, id: newLocation.id };
  } catch (error) {
    console.error("[createLocation] Full error:", error);
    const message = error instanceof Error ? error.message : "Failed to create location";
    return { error: message };
  }
}

export async function getLocation(id: string): Promise<
  { location: LocationWithRelations } | { error: string }
> {
  try {
    const session = await requireRole("admin", "member", "viewer");

    const [row] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);

    if (!row) return { error: "Location not found" };

    // Fetch kiosk assignments (all, current and historical)
    const assignmentRows = await db
      .select({
        assignmentId: kioskAssignments.id,
        kioskId: kioskAssignments.kioskId,
        kioskDisplayId: kiosks.kioskId,
        pipelineStageId: kiosks.pipelineStageId,
        assignedAt: kioskAssignments.assignedAt,
        unassignedAt: kioskAssignments.unassignedAt,
        reason: kioskAssignments.reason,
        assignedByName: kioskAssignments.assignedByName,
      })
      .from(kioskAssignments)
      .innerJoin(kiosks, eq(kioskAssignments.kioskId, kiosks.id))
      .where(eq(kioskAssignments.locationId, id))
      .orderBy(desc(kioskAssignments.assignedAt));

    const locationData: LocationWithRelations = {
      ...row,
      assignedKiosks: assignmentRows,
    };

    // Apply role-based redaction for sensitive fields
    const redacted = redactSensitiveFields(locationData, session.user.role ?? "viewer");

    return { location: redacted as LocationWithRelations };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch location";
    return { error: message };
  }
}

export async function updateLocationField(
  locationId: string,
  field: string,
  value: string | null,
  oldValue?: string
) {
  try {
    const session = await requireRole("admin", "member");

    // Banking fields require canAccessSensitiveFields check
    const bankingFields = ["bankingDetails"];
    if (bankingFields.includes(field)) {
      if (!canAccessSensitiveFields(session.user.role ?? "viewer")) {
        return { error: "Forbidden: insufficient permissions for banking fields" };
      }
    }

    const [row] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (field === "contractStartDate" || field === "contractEndDate") {
      updateData[field] = value ? new Date(value) : null;
    } else if (field === "latitude" || field === "longitude" || field === "contractValue") {
      updateData[field] = value ? Number(value) : null;
    } else if (field === "starRating" || field === "roomCount") {
      updateData[field] = value ? parseInt(value, 10) : null;
    } else {
      updateData[field] = value;
    }

    await db.update(locations).set(updateData).where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
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

export async function archiveLocation(locationId: string) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    await db
      .update(locations)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "archive",
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive location";
    return { error: message };
  }
}

export async function listLocations(): Promise<LocationListItem[]> {
  try {
    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        hotelGroup: locations.hotelGroup,
        starRating: locations.starRating,
        roomCount: locations.roomCount,
        createdAt: locations.createdAt,
        archivedAt: locations.archivedAt,
      })
      .from(locations)
      .where(isNull(locations.archivedAt))
      .orderBy(desc(locations.createdAt));

    // Fetch kiosk counts
    const locationIds = rows.map((r) => r.id);
    const assignmentCounts =
      locationIds.length > 0
        ? await db
            .select({
              locationId: kioskAssignments.locationId,
            })
            .from(kioskAssignments)
            .where(isNull(kioskAssignments.unassignedAt))
        : [];

    const countMap = new Map<string, number>();
    for (const a of assignmentCounts) {
      countMap.set(a.locationId, (countMap.get(a.locationId) ?? 0) + 1);
    }

    return rows.map((r) => ({
      ...r,
      kioskCount: countMap.get(r.id) ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function getContractUploadUrl(
  fileName: string,
  contentType: string
): Promise<{ presignedUrl: string; s3Key: string } | { error: string }> {
  try {
    await requireRole("admin", "member");

    if (!process.env.AWS_S3_BUCKET) {
      return {
        error:
          "File upload not configured. Contact your administrator.",
      };
    }

    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION || "eu-west-1";

    const s3 = new S3Client({
      region,
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
          }
        : undefined,
    });

    const s3Key = `contracts/${crypto.randomUUID()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return { presignedUrl, s3Key };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate upload URL";
    return { error: message };
  }
}

export async function saveContractDocument(
  locationId: string,
  s3Key: string,
  fileName: string
) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ name: locations.name, contractDocuments: locations.contractDocuments })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    const existing = row.contractDocuments ?? [];
    const updated = [
      ...existing,
      { fileName, s3Key, uploadedAt: new Date().toISOString() },
    ];

    await db
      .update(locations)
      .set({ contractDocuments: updated, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "update",
      field: "contractDocuments",
      newValue: fileName,
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save document";
    return { error: message };
  }
}

export async function removeContractDocument(locationId: string, s3Key: string) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ name: locations.name, contractDocuments: locations.contractDocuments })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    const existing = row.contractDocuments ?? [];
    const removed = existing.find((d) => d.s3Key === s3Key);
    const updated = existing.filter((d) => d.s3Key !== s3Key);

    await db
      .update(locations)
      .set({ contractDocuments: updated, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "update",
      field: "contractDocuments",
      oldValue: removed?.fileName,
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove document";
    return { error: message };
  }
}

export async function updateKeyContacts(
  locationId: string,
  contacts: Array<{ name: string; role?: string; email?: string; phone?: string }>
) {
  try {
    const session = await requireRole("admin", "member");

    const contactsSchema = z.array(keyContactSchema);
    const validated = contactsSchema.parse(contacts);

    const [row] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    const normalised = validated.map((c) => ({
      name: c.name,
      role: c.role ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
    }));

    await db
      .update(locations)
      .set({ keyContacts: normalised, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "update",
      field: "keyContacts",
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update key contacts";
    return { error: message };
  }
}

export async function updateBankingDetails(
  locationId: string,
  bankingDetails: Record<string, string>
) {
  try {
    const session = await requireRole("admin");

    const [row] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    await db
      .update(locations)
      .set({ bankingDetails, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    // Redact values in audit log for security
    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "update",
      field: "bankingDetails",
      oldValue: "[REDACTED]",
      newValue: "[REDACTED]",
    });

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update banking details";
    return { error: message };
  }
}
