"use server";

import { z } from "zod/v4";
import { db } from "@/db";
import {
  locations,
  kioskAssignments,
  kiosks,
  regions,
  user,
  locationRegionMemberships,
  hotelGroups,
  locationHotelGroupMemberships,
  kioskConfigGroups,
} from "@/db/schema";
import {
  requireRole,
  redactSensitiveFields,
  type Role,
} from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { LOCATION_TYPES, type LocationType } from "@/lib/analytics/types";
import { eq, isNull, and, desc, inArray, sql } from "drizzle-orm";
import { getScopedActiveLocationIds } from "@/lib/scoping/scoped-active-locations";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createLocationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  // Phase 07-06 — locations.outlet_code is gone (migration 0040). The
  // location-level identifier is now `customer_code` (RPS account code,
  // optional — placeholders / RTL hotels legitimately have none) and
  // primary_region_id (NOT NULL since 0022). Per-kiosk outlet codes are
  // a kiosk attribute now, not a location one.
  customerCode: z.string().max(64, "Customer code must be 64 characters or fewer").optional(),
  primaryRegionId: z.uuid("A region is required"),
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
  // Phase 7.1 / D9 — analytics-filter integrity. The CHECK constraint on the
  // column (migration 0034) restricts values to LOCATION_TYPES; null means
  // "not yet classified" (the `/settings/outlet-types` flow surfaces these).
  locationType: LocationType | null;
  // Phase 7.2 — region assignment, NOT NULL since 0022. Surfaced on the
  // location detail form so admins don't have to detour through
  // `/settings/outlet-types` for a one-off region change.
  // Phase 07-06 — outlet_code is gone from locations; customer_code below
  // is the canonical hotel-level identifier (nullable — placeholders OK).
  primaryRegionId: string;
  // Phase 7.4 — fields previously list-only on `/locations`. Surfacing them
  // on the detail form removes the inconsistency where editing meant
  // crossing pages. `internalPocName` is denormalised from the `user`
  // table so the form can render the picker label without a second fetch.
  status: string | null;
  internalPocId: string | null;
  internalPocName: string | null;
  customerCode: string | null;
  maintenanceFee: string | null;
  locationGroup: string | null;
  // Phase 7.2b / D5 — hotel-group memberships are N:N (legitimate JVs map to
  // multiple groups). The picker writes directly to
  // `location_hotel_group_memberships` via `setLocationHotelGroupMemberships`.
  hotelGroupMemberships: Array<{ id: string; name: string }>;
  // Phase 7.6a / D13 — kiosk config group lives on the location (Monday col
  // 1466686598). Surfaced read-write on the form; the 7.6d investigation
  // confirmed Monday sync overwrites local edits unconditionally, so the
  // picker shows that warning inline.
  kioskConfigGroupId: string | null;
  // D6 / Task 2.12 — NOT NULL, defaults to 'UTC' when not yet set by the
  // backfill (e.g. a new region without a region-default mapping).
  ianaTimezone: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  // Phase 9 (hotel-level rewrite) — admin-only per-hotel silencing of weekly
  // POC underperformance alerts. Surfaced read-write on the locations/[id]
  // admin panel; mutated via locations/[id]/silence-actions.ts.
  alertSilencedAt: Date | null;
  alertSilencedReason: string | null;
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
  hotelGroup: string | null;
  starRating: number | null;
  roomCount: number | null;
  kioskCount: number;
  address: string | null;
  sourcedBy: string | null;
  status: string | null;
  maintenanceFee: string | null;
  customerCode: string | null;
  keyContactName: string | null;
  locationGroup: string | null;
  internalPocId: string | null;
  internalPocName: string | null;
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
        customerCode: validated.customerCode || null,
        primaryRegionId: validated.primaryRegionId,
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

    // Phase 7.4 — denormalise the internal POC's display name. Skipped when
    // unset so the picker can render an "— Unassigned —" sentinel.
    let internalPocName: string | null = null;
    if (row.internalPocId) {
      const [pocRow] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, row.internalPocId))
        .limit(1);
      internalPocName = pocRow?.name ?? null;
    }

    // Phase 7.2b — current hotel-group memberships (id + name) so the picker
    // can render labels without a second client-side fetch.
    const hotelGroupMembershipRows = await db
      .select({
        id: hotelGroups.id,
        name: hotelGroups.name,
      })
      .from(locationHotelGroupMemberships)
      .innerJoin(
        hotelGroups,
        eq(locationHotelGroupMemberships.hotelGroupId, hotelGroups.id),
      )
      .where(
        and(
          eq(locationHotelGroupMemberships.locationId, id),
          isNull(hotelGroups.archivedAt),
        ),
      )
      .orderBy(hotelGroups.name);

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
      internalPocName,
      hotelGroupMemberships: hotelGroupMembershipRows,
      assignedKiosks: assignmentRows,
    };

    // Apply role-based redaction for sensitive fields
    const userType =
      (session.user as { userType?: "internal" | "external" }).userType ?? "internal";
    const role = (session.user.role as Role | null) ?? "viewer";
    const redacted = redactSensitiveFields(locationData, { userType, role });

    return { location: redacted as LocationWithRelations };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch location";
    return { error: message };
  }
}

// Fields admins/members can inline-edit via updateLocationField. Banking is
// gated separately (sensitive). System columns (id/createdAt/updatedAt/
// archivedAt) are never edited through this path, nor are
// operatingGroupId/customFields (managed by dedicated flows).
const EDITABLE_LOCATION_FIELDS = [
  "name",
  "address",
  "latitude",
  "longitude",
  "starRating",
  "roomCount",
  "customerCode",
  // Phase 07-06 — outlet_code dropped from locations (now a kiosks attribute)
  "hotelGroup",
  "sourcedBy",
  "contractValue",
  "contractStartDate",
  "contractEndDate",
  "contractTerms",
  "maintenanceFee",
  "freeTrialEndDate",
  "hardwareAssets",
  "notes",
  "locationGroup",
  "internalPocId",
  "status",
  "numRooms",
  "hotelAddress",
  "liveDate",
  "launchPhase",
  "keyContactName",
  "keyContactEmail",
  "financeContact",
  // D6 / Task 2.12 — IANA timezone for hour-of-day analytics. Free-text from
  // the form's perspective (the Select picks from a curated list); validated
  // against the actual zone DB in the future when we add geo-tz refinement.
  "ianaTimezone",
  // D9 / Phase 7.1 — `'internal'` analytics exclusion. Validated against the
  // LOCATION_TYPES enum below before reaching the DB so an attacker can't
  // bypass the CHECK constraint with a sentinel string.
  "locationType",
  // Phase 7.2 — assigning a location to a different region. Validated as
  // a UUID below; the FK + (region, customer_code) partial uniqueness
  // (Phase 07-06) are enforced by the DB and surface as a friendly error
  // if violated.
  "primaryRegionId",
  // Phase 7.6a / D13 — kiosk config group. Editor-level access (member, not
  // admin-only) per D13. Empty string clears the FK; otherwise UUID guard
  // mirrors primaryRegionId.
  "kioskConfigGroupId",
] as const;

export type EditableLocationField = (typeof EDITABLE_LOCATION_FIELDS)[number];

const updateLocationFieldSchema = z.object({
  field: z.enum(EDITABLE_LOCATION_FIELDS),
  value: z.string().nullable(),
});

export async function updateLocationField(
  locationId: string,
  field: string,
  value: string | null,
  oldValue?: string
) {
  try {
    const session = await requireRole("admin", "member");

    // Narrow arbitrary string `field` via zod so only whitelisted columns reach
    // the DB. Rejects e.g. "id", "createdAt", "bankingDetails" (use dedicated
    // action), and any unknown attribute.
    const parsed = updateLocationFieldSchema.safeParse({ field, value });
    if (!parsed.success) {
      return { error: `Invalid field: ${field}` };
    }
    const validField = parsed.data.field;

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

    if (
      validField === "contractStartDate" ||
      validField === "contractEndDate" ||
      validField === "liveDate" ||
      validField === "freeTrialEndDate"
    ) {
      updateData[validField] = value ? new Date(value) : null;
    } else if (
      validField === "latitude" ||
      validField === "longitude" ||
      validField === "contractValue" ||
      validField === "maintenanceFee"
    ) {
      updateData[validField] = value ? Number(value) : null;
    } else if (
      validField === "starRating" ||
      validField === "roomCount" ||
      validField === "numRooms"
    ) {
      updateData[validField] = value ? parseInt(value, 10) : null;
    } else if (validField === "internalPocId") {
      // FK to user — null means "unassigned"
      updateData[validField] = value && value !== "" ? value : null;
    } else if (validField === "locationType") {
      // Empty string treated as "clear classification" (NULL); anything
      // else must match LOCATION_TYPES exactly. Bouncing here mirrors the
      // CHECK constraint added in migration 0034 — by the time the value
      // hits the DB it's already known-good.
      if (value === null || value === "") {
        updateData[validField] = null;
      } else if ((LOCATION_TYPES as readonly string[]).includes(value)) {
        updateData[validField] = value;
      } else {
        return { error: `Invalid location type: ${value}` };
      }
    } else if (validField === "primaryRegionId") {
      // primary_region_id is NOT NULL since migration 0022. Reject empty;
      // require canonical UUID shape so a malformed value never reaches the
      // FK check (which would surface as an opaque 500). Phase 07-06: the
      // (region, customer_code) partial unique replaces the old (region,
      // outlet_code) uniqueness on region moves; the DB still surfaces a
      // 23505 if the move would collide with another location's
      // customer_code in the target region.
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!value || !uuidRe.test(value)) {
        return { error: "A region is required" };
      }
      updateData[validField] = value;
    } else if (validField === "kioskConfigGroupId") {
      // Empty string / null = "clear assignment". Otherwise enforce UUID
      // shape so a bad value never reaches the FK (which would surface as
      // an opaque 500). The DB FK enforces existence.
      if (value === null || value === "") {
        updateData[validField] = null;
      } else {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(value)) {
          return { error: "Invalid kiosk config group" };
        }
        updateData[validField] = value;
      }
    } else {
      updateData[validField] = value;
    }

    await db.update(locations).set(updateData).where(eq(locations.id, locationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: locationId,
      entityName: row.name,
      action: "update",
      field: validField,
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

export async function listLocations(
  options: { includeArchived?: boolean } = {},
): Promise<LocationListItem[]> {
  try {
    const pocUser = user;
    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        hotelGroup: locations.hotelGroup,
        starRating: locations.starRating,
        roomCount: locations.roomCount,
        address: locations.address,
        sourcedBy: locations.sourcedBy,
        status: locations.status,
        maintenanceFee: locations.maintenanceFee,
        customerCode: locations.customerCode,
        keyContacts: locations.keyContacts,
        keyContactNameCol: locations.keyContactName,
        locationGroup: locations.locationGroup,
        internalPocId: locations.internalPocId,
        internalPocName: pocUser.name,
        createdAt: locations.createdAt,
        archivedAt: locations.archivedAt,
      })
      .from(locations)
      .leftJoin(pocUser, eq(locations.internalPocId, pocUser.id))
      // Phase 7.8 — when the page passes `includeArchived=true`, drop the
      // `archived_at IS NULL` predicate so the toggle can surface the
      // archived rows. Default behaviour is unchanged.
      .where(options.includeArchived ? undefined : isNull(locations.archivedAt))
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

    return rows.map(({ keyContacts, keyContactNameCol, ...r }) => ({
      ...r,
      kioskCount: countMap.get(r.id) ?? 0,
      // Prefer the denormalised top-level column (editable inline); fall back
      // to the first entry of the JSONB contacts blob for legacy rows that
      // haven't been touched since the denormalisation was added.
      keyContactName:
        keyContactNameCol ??
        (keyContacts as Array<{ name: string }> | null)?.[0]?.name ??
        null,
      internalPocName: r.internalPocName ?? null,
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
      .select({
        name: locations.name,
        bankingDetails: locations.bankingDetails,
      })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!row) return { error: "Location not found" };

    // Phase 7.9 — diff old vs new at the field level so admins can answer
    // "who changed our IBAN?" without reading raw before/after blobs. Values
    // stay redacted in the audit row; only the field name changes (which is
    // the question an investigator actually needs answered).
    const oldDetails = (row.bankingDetails as Record<string, string> | null) ?? {};
    const changedFields = new Set<string>();
    for (const k of Object.keys(bankingDetails)) {
      if ((oldDetails[k] ?? "") !== (bankingDetails[k] ?? "")) {
        changedFields.add(k);
      }
    }
    for (const k of Object.keys(oldDetails)) {
      if ((oldDetails[k] ?? "") !== (bankingDetails[k] ?? "")) {
        changedFields.add(k);
      }
    }

    await db
      .update(locations)
      .set({ bankingDetails, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    if (changedFields.size === 0) {
      // No-op save — don't pollute the audit log with empty-diff entries.
      return { success: true as const };
    }

    // One audit row per changed field. Values stay `[REDACTED]` so the log
    // never leaks an account number, but the field-level granularity gives
    // an investigator the "what" alongside the existing "who/when".
    for (const field of changedFields) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: locationId,
        entityName: row.name,
        action: "update",
        field: `bankingDetails.${field}`,
        oldValue: "[REDACTED]",
        newValue: "[REDACTED]",
      });
    }

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update banking details";
    return { error: message };
  }
}

// Phase 7.10 / D11 — surface locations whose free trial is ending soon
// so ops can decide to extend / convert / terminate before the deadline
// arrives unnoticed. Window is configurable; default 30 days matches D11.
export type TrialEndingSoonItem = {
  locationId: string;
  name: string;
  freeTrialEndDate: Date;
  daysRemaining: number;
};

export async function getTrialsEndingSoon(
  daysAhead: number = 30,
): Promise<TrialEndingSoonItem[]> {
  try {
    await requireRole("admin", "member", "viewer");
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: locations.id,
        name: locations.name,
        freeTrialEndDate: locations.freeTrialEndDate,
      })
      .from(locations)
      .where(
        and(
          isNull(locations.archivedAt),
          // freeTrialEndDate IS NOT NULL — explicit check via raw SQL since
          // the column is nullable. Drizzle's isNull(...) negation:
          sql`${locations.freeTrialEndDate} IS NOT NULL`,
          sql`${locations.freeTrialEndDate} >= ${now.toISOString()}`,
          sql`${locations.freeTrialEndDate} <= ${horizon.toISOString()}`,
        ),
      )
      .orderBy(locations.freeTrialEndDate);

    return rows
      .filter((r): r is typeof r & { freeTrialEndDate: Date } =>
        r.freeTrialEndDate !== null,
      )
      .map((r) => {
        const days = Math.ceil(
          (r.freeTrialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        );
        return {
          locationId: r.id,
          name: r.name,
          freeTrialEndDate: r.freeTrialEndDate,
          daysRemaining: days,
        };
      });
  } catch {
    // Same swallow-and-return-empty pattern as listRegionOptions: a banner
    // that fails to load shouldn't break the host page.
    return [];
  }
}

// Phase 7.6a — list kiosk config groups for the location detail Select.
export async function listKioskConfigGroupOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  try {
    await requireRole("admin", "member", "viewer");
    const rows = await db
      .select({ id: kioskConfigGroups.id, name: kioskConfigGroups.name })
      .from(kioskConfigGroups)
      .orderBy(kioskConfigGroups.name);
    return rows;
  } catch {
    return [];
  }
}

// Phase 7.2b — list active hotel groups for the multi-select picker. The
// archived JV groups (split by D5 PR-6 Part C) are excluded so an admin
// can't accidentally re-attach a location to a defunct comma-encoded row.
export async function listHotelGroupOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  try {
    await requireRole("admin", "member", "viewer");
    const rows = await db
      .select({ id: hotelGroups.id, name: hotelGroups.name })
      .from(hotelGroups)
      .where(isNull(hotelGroups.archivedAt))
      .orderBy(hotelGroups.name);
    return rows;
  } catch {
    return [];
  }
}

// Phase 7.2b — replace a location's hotel-group memberships with the given
// set. Diffs old vs new so the audit log only records actual additions and
// removals, and so unchanged memberships keep their original `created_at`
// (rather than being delete+inserted on every save). Wrapped in a single
// statement chain — Drizzle doesn't expose `db.transaction(...)` from this
// call site for the postgres-js driver, but `delete + insert ... ON CONFLICT
// DO NOTHING` is idempotent and effectively atomic for our scale.
export async function setLocationHotelGroupMemberships(
  locationId: string,
  hotelGroupIds: string[],
) {
  try {
    const session = await requireRole("admin", "member");

    const [row] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) return { error: "Location not found" };

    const requested = new Set(hotelGroupIds);
    const currentRows = await db
      .select({ hotelGroupId: locationHotelGroupMemberships.hotelGroupId })
      .from(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.locationId, locationId));
    const current = new Set(currentRows.map((r) => r.hotelGroupId));

    const toAdd = [...requested].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !requested.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { success: true as const, addedCount: 0, removedCount: 0 };
    }

    // Resolve names so the audit row is human-readable. Single round trip.
    const allTouched = [...new Set([...toAdd, ...toRemove])];
    const nameRows =
      allTouched.length > 0
        ? await db
            .select({ id: hotelGroups.id, name: hotelGroups.name })
            .from(hotelGroups)
            .where(inArray(hotelGroups.id, allTouched))
        : [];
    const nameMap = new Map(nameRows.map((r) => [r.id, r.name]));

    if (toRemove.length > 0) {
      await db
        .delete(locationHotelGroupMemberships)
        .where(
          and(
            eq(locationHotelGroupMemberships.locationId, locationId),
            inArray(locationHotelGroupMemberships.hotelGroupId, toRemove),
          ),
        );
    }

    if (toAdd.length > 0) {
      await db
        .insert(locationHotelGroupMemberships)
        .values(
          toAdd.map((hotelGroupId) => ({
            locationId,
            hotelGroupId,
          })),
        )
        .onConflictDoNothing();
    }

    for (const hotelGroupId of toAdd) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: locationId,
        entityName: row.name,
        action: "assign",
        field: "hotel_group_membership",
        oldValue: undefined,
        newValue: nameMap.get(hotelGroupId) ?? hotelGroupId,
      });
    }
    for (const hotelGroupId of toRemove) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: locationId,
        entityName: row.name,
        action: "unassign",
        field: "hotel_group_membership",
        oldValue: nameMap.get(hotelGroupId) ?? hotelGroupId,
        newValue: undefined,
      });
    }

    return {
      success: true as const,
      addedCount: toAdd.length,
      removedCount: toRemove.length,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update hotel group memberships";
    return { error: message };
  }
}

/**
 * Region options for the new-location form picker. Lightweight (id + name)
 * — locations can only be created with a known region post-0022, so this is
 * the source of truth for that dropdown.
 */
export async function listRegionOptions(): Promise<Array<{ id: string; name: string }>> {
  try {
    const session = await requireRole("admin", "member", "viewer");
    const ctx: UserCtx = {
      id: session.user.id,
      userType:
        (session.user as { userType?: "internal" | "external" }).userType ??
        "internal",
      role: (session.user.role as UserCtx["role"]) ?? null,
    };
    // Only show regions that have at least one location the user is allowed
    // to see (Task 3.9). Admin/system users get all regions because the
    // helper returns the full active set unrestricted.
    const scopedActiveIds = await getScopedActiveLocationIds(ctx);
    if (scopedActiveIds.length === 0) return [];
    const rows = await db
      .select({ id: regions.id, name: regions.name })
      .from(regions)
      .where(
        sql`${regions.id} IN (
          SELECT ${locationRegionMemberships.regionId}
          FROM ${locationRegionMemberships}
          WHERE ${inArray(locationRegionMemberships.locationId, scopedActiveIds)}
        )`,
      )
      .orderBy(regions.name);
    return rows;
  } catch {
    return [];
  }
}

/**
 * List users that can be assigned as an internal POC / assignee on a location.
 * Admin and member roles are allowed candidates; viewers are excluded since
 * they cannot act on records. Available to admin + member callers only.
 */
export async function listPocCandidates(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  try {
    await requireRole("admin", "member", "viewer");
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role })
      .from(user)
      .orderBy(user.name);

    return rows
      .filter((r) => r.role === "admin" || r.role === "member")
      .map((r) => ({ id: r.id, name: r.name, email: r.email }));
  } catch {
    return [];
  }
}
