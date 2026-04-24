"use server";

import { z } from "zod/v4";
import { db } from "@/db";
import {
  installations,
  milestones,
  installationKiosks,
  installationMembers,
  user,
  kiosks,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, and, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createInstallationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
  status: z.enum(["planned", "active", "complete"]).optional().default("planned"),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
}).refine(
  (d) => {
    if (d.plannedStart && d.plannedEnd) {
      return new Date(d.plannedEnd) >= new Date(d.plannedStart);
    }
    return true;
  },
  { message: "Planned end date must not be before planned start date" }
);

const updateInstallationSchema = z.object({
  name: z.string().min(1).optional(),
  region: z.string().optional(),
  status: z.enum(["planned", "active", "complete"]).optional(),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
}).refine(
  (d) => {
    if (d.plannedStart && d.plannedEnd) {
      return new Date(d.plannedEnd) >= new Date(d.plannedStart);
    }
    return true;
  },
  { message: "Planned end date must not be before planned start date" }
);

const createMilestoneSchema = z.object({
  installationId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["contract_signing", "go_live", "review_date", "other"]),
  targetDate: z.string().min(1, "Target date is required"),
});

const addInstallationMemberSchema = z.object({
  installationId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["project_lead", "installer", "coordinator"]),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MilestoneRecord = {
  id: string;
  installationId: string;
  name: string;
  type: string;
  targetDate: Date;
  createdAt: Date;
};

export type InstallationMemberRecord = {
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
};

export type InstallationWithRelations = {
  id: string;
  name: string;
  region: string | null;
  status: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  internalPocId: string | null;
  internalPocName: string | null;
  createdAt: Date;
  updatedAt: Date;
  milestones: MilestoneRecord[];
  members: InstallationMemberRecord[];
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a new installation project.
 */
export async function createInstallation(
  data: z.input<typeof createInstallationSchema>
) {
  try {
    const session = await requireRole("admin", "member");
    const validated = createInstallationSchema.parse(data);

    const [newInstallation] = await db
      .insert(installations)
      .values({
        name: validated.name,
        region: validated.region ?? null,
        status: validated.status ?? "planned",
        plannedStart: validated.plannedStart
          ? new Date(validated.plannedStart)
          : null,
        plannedEnd: validated.plannedEnd
          ? new Date(validated.plannedEnd)
          : null,
      })
      .returning({ id: installations.id, name: installations.name });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "installation",
      entityId: newInstallation.id,
      entityName: newInstallation.name,
      action: "create",
    });

    return { success: true as const, id: newInstallation.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create installation";
    return { error: message };
  }
}

/**
 * List all installations with their milestones and members.
 */
export async function listInstallations(): Promise<
  InstallationWithRelations[] | { error: string }
> {
  try {
    await requireRole("admin", "member", "viewer");

    const installationRows = await db
      .select({
        id: installations.id,
        name: installations.name,
        region: installations.region,
        status: installations.status,
        plannedStart: installations.plannedStart,
        plannedEnd: installations.plannedEnd,
        internalPocId: installations.internalPocId,
        internalPocName: user.name,
        createdAt: installations.createdAt,
        updatedAt: installations.updatedAt,
      })
      .from(installations)
      .leftJoin(user, eq(installations.internalPocId, user.id))
      .orderBy(installations.createdAt);

    // Early return is load-bearing: the inArray() calls below require a non-empty array
    if (installationRows.length === 0) return [];

    const installationIds = installationRows.map((i) => i.id);

    // Fetch all milestones for these installations
    const milestoneRows = await db
      .select()
      .from(milestones)
      .where(
        installationIds.length === 1
          ? eq(milestones.installationId, installationIds[0])
          : inArray(milestones.installationId, installationIds)
      )
      .orderBy(milestones.targetDate);

    // Fetch all members with user names
    const memberRows = await db
      .select({
        installationId: installationMembers.installationId,
        userId: installationMembers.userId,
        role: installationMembers.role,
        userName: user.name,
        userEmail: user.email,
      })
      .from(installationMembers)
      .innerJoin(user, eq(installationMembers.userId, user.id))
      .where(
        installationIds.length === 1
          ? eq(installationMembers.installationId, installationIds[0])
          : inArray(installationMembers.installationId, installationIds)
      );

    // Group milestones and members by installationId
    const milestonesByInstallation = new Map<string, MilestoneRecord[]>();
    for (const m of milestoneRows) {
      const existing = milestonesByInstallation.get(m.installationId) ?? [];
      existing.push(m);
      milestonesByInstallation.set(m.installationId, existing);
    }

    const membersByInstallation = new Map<string, InstallationMemberRecord[]>();
    for (const m of memberRows) {
      const existing = membersByInstallation.get(m.installationId) ?? [];
      existing.push({
        userId: m.userId,
        userName: m.userName,
        userEmail: m.userEmail,
        role: m.role,
      });
      membersByInstallation.set(m.installationId, existing);
    }

    return installationRows.map((i) => ({
      ...i,
      internalPocName: i.internalPocName ?? null,
      milestones: milestonesByInstallation.get(i.id) ?? [],
      members: membersByInstallation.get(i.id) ?? [],
    }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list installations";
    return { error: message };
  }
}

/**
 * Get a single installation with full detail: milestones, members, and linked kiosks.
 */
export async function getInstallation(id: string): Promise<
  | (InstallationWithRelations & {
      linkedKiosks: Array<{ kioskId: string; kioskLabel: string }>;
    })
  | { error: string }
> {
  try {
    await requireRole("admin", "member", "viewer");

    const [row] = await db
      .select({
        id: installations.id,
        name: installations.name,
        region: installations.region,
        status: installations.status,
        plannedStart: installations.plannedStart,
        plannedEnd: installations.plannedEnd,
        internalPocId: installations.internalPocId,
        internalPocName: user.name,
        createdAt: installations.createdAt,
        updatedAt: installations.updatedAt,
      })
      .from(installations)
      .leftJoin(user, eq(installations.internalPocId, user.id))
      .where(eq(installations.id, id))
      .limit(1);

    if (!row) return { error: "Not found" };

    const milestoneRows = await db
      .select()
      .from(milestones)
      .where(eq(milestones.installationId, id))
      .orderBy(milestones.targetDate);

    const memberRows = await db
      .select({
        installationId: installationMembers.installationId,
        userId: installationMembers.userId,
        role: installationMembers.role,
        userName: user.name,
        userEmail: user.email,
      })
      .from(installationMembers)
      .innerJoin(user, eq(installationMembers.userId, user.id))
      .where(eq(installationMembers.installationId, id));

    const kioskRows = await db
      .select({
        kioskId: installationKiosks.kioskId,
        kioskLabel: kiosks.kioskId,
      })
      .from(installationKiosks)
      .innerJoin(kiosks, eq(installationKiosks.kioskId, kiosks.id))
      .where(eq(installationKiosks.installationId, id));

    return {
      ...row,
      internalPocName: row.internalPocName ?? null,
      milestones: milestoneRows,
      members: memberRows.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        userEmail: m.userEmail,
        role: m.role,
      })),
      linkedKiosks: kioskRows.map((k) => ({
        kioskId: k.kioskId,
        kioskLabel: k.kioskLabel,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get installation";
    return { error: message };
  }
}

/**
 * Update an existing installation's fields.
 */
export async function updateInstallation(
  id: string,
  data: z.input<typeof updateInstallationSchema>
) {
  try {
    const session = await requireRole("admin", "member");
    const validated = updateInstallationSchema.parse(data);

    const [existing] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, id))
      .limit(1);

    if (!existing) return { error: "Not found" };

    const updateData: Partial<typeof installations.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (validated.name !== undefined) updateData.name = validated.name;
    if (validated.region !== undefined) updateData.region = validated.region;
    if (validated.status !== undefined) updateData.status = validated.status;
    if (validated.plannedStart !== undefined) {
      updateData.plannedStart = validated.plannedStart
        ? new Date(validated.plannedStart)
        : null;
    }
    if (validated.plannedEnd !== undefined) {
      updateData.plannedEnd = validated.plannedEnd
        ? new Date(validated.plannedEnd)
        : null;
    }

    await db
      .update(installations)
      .set(updateData)
      .where(eq(installations.id, id));

    // Write audit log for each changed field
    const changedFields = Object.keys(validated) as Array<
      keyof typeof validated
    >;
    for (const field of changedFields) {
      if (validated[field] !== undefined) {
        const oldVal = existing[field as keyof typeof existing];
        const newVal = validated[field];
        await writeAuditLog({
          actorId: session.user.id,
          actorName: session.user.name,
          entityType: "installation",
          entityId: id,
          entityName: existing.name,
          action: "update",
          field,
          oldValue: oldVal !== null && oldVal !== undefined ? String(oldVal) : undefined,
          newValue: newVal !== null && newVal !== undefined ? String(newVal) : undefined,
        });
      }
    }

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update installation";
    return { error: message };
  }
}

/**
 * Hard-delete an installation (cascades to milestones, members, kiosk links).
 */
export async function deleteInstallation(id: string) {
  try {
    const session = await requireRole("admin");

    const [existing] = await db
      .select({ name: installations.name })
      .from(installations)
      .where(eq(installations.id, id))
      .limit(1);

    if (!existing) return { error: "Not found" };

    await db.delete(installations).where(eq(installations.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "installation",
      entityId: id,
      entityName: existing.name,
      action: "delete",
    });

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete installation";
    return { error: message };
  }
}

/**
 * Create a milestone on an installation.
 */
export async function createMilestone(
  data: z.input<typeof createMilestoneSchema>
) {
  try {
    await requireRole("admin", "member");
    const validated = createMilestoneSchema.parse(data);

    const [newMilestone] = await db
      .insert(milestones)
      .values({
        installationId: validated.installationId,
        name: validated.name,
        type: validated.type,
        targetDate: new Date(validated.targetDate),
      })
      .returning({ id: milestones.id });

    return { success: true as const, id: newMilestone.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create milestone";
    return { error: message };
  }
}

/**
 * Hard-delete a milestone by ID.
 */
export async function deleteMilestone(id: string) {
  try {
    await requireRole("admin", "member");

    await db.delete(milestones).where(eq(milestones.id, id));

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete milestone";
    return { error: message };
  }
}

/**
 * Add a team member to an installation with a role.
 */
export async function addInstallationMember(
  data: z.input<typeof addInstallationMemberSchema>
) {
  try {
    await requireRole("admin", "member");
    const validated = addInstallationMemberSchema.parse(data);

    await db.insert(installationMembers).values({
      installationId: validated.installationId,
      userId: validated.userId,
      role: validated.role,
    });

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add installation member";
    return { error: message };
  }
}

/**
 * Remove a team member from an installation.
 */
export async function removeInstallationMember(
  installationId: string,
  userId: string
) {
  try {
    await requireRole("admin", "member");

    await db
      .delete(installationMembers)
      .where(
        and(
          eq(installationMembers.installationId, installationId),
          eq(installationMembers.userId, userId)
        )
      );

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to remove installation member";
    return { error: message };
  }
}

/**
 * List users for member assignment dropdowns. Available to admin and member roles.
 */
export async function listUsersForSelect(): Promise<
  Array<{ id: string; name: string; email: string }> | { error: string }
> {
  try {
    await requireRole("admin", "member");

    const users = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .orderBy(user.name);

    return users;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list users";
    return { error: message };
  }
}

/**
 * List admin/member users eligible as the installation-level internal POC /
 * assignee. Mirrors the locations + kiosks helpers for parity across tables.
 */
export async function listInstallationPocCandidates(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  try {
    await requireRole("admin", "member", "viewer");
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      .from(user)
      .orderBy(user.name);

    return rows
      .filter((r) => r.role === "admin" || r.role === "member")
      .map((r) => ({ id: r.id, name: r.name, email: r.email }));
  } catch {
    return [];
  }
}

/**
 * Field-level inline update for an installation. Mirrors updateLocationField /
 * updateKioskField so the same EditableCell wiring works on the installations
 * table. Narrowed to the editable column allow-list.
 */
const EDITABLE_INSTALLATION_FIELDS = [
  "name",
  "region",
  "status",
  "plannedStart",
  "plannedEnd",
  "internalPocId",
] as const;

export type EditableInstallationField = (typeof EDITABLE_INSTALLATION_FIELDS)[number];

export async function updateInstallationField(
  installationId: string,
  field: string,
  value: string | null,
  oldValue?: string
) {
  try {
    const session = await requireRole("admin", "member");

    if (!(EDITABLE_INSTALLATION_FIELDS as readonly string[]).includes(field)) {
      return { error: `Invalid field: ${field}` };
    }
    const validField = field as EditableInstallationField;

    const [existing] = await db
      .select({ name: installations.name })
      .from(installations)
      .where(eq(installations.id, installationId))
      .limit(1);

    if (!existing) return { error: "Not found" };

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (validField === "plannedStart" || validField === "plannedEnd") {
      updateData[validField] = value ? new Date(value) : null;
    } else if (validField === "status") {
      // Enum: planned | active | complete. Fall back to "planned" if invalid
      // input slips past the UI.
      const allowed = new Set(["planned", "active", "complete"]);
      if (value && !allowed.has(value)) {
        return { error: `Invalid status: ${value}` };
      }
      updateData.status = value ?? "planned";
    } else if (validField === "internalPocId") {
      updateData.internalPocId = value && value !== "" ? value : null;
    } else {
      updateData[validField] = value;
    }

    await db
      .update(installations)
      .set(updateData)
      .where(eq(installations.id, installationId));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "installation",
      entityId: installationId,
      entityName: existing.name,
      action: "update",
      field: validField,
      oldValue,
      newValue: value !== null && value !== undefined ? String(value) : undefined,
    });

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update field";
    return { error: message };
  }
}

/**
 * Link a kiosk to an installation.
 */
export async function linkKioskToInstallation(
  installationId: string,
  kioskId: string
) {
  try {
    await requireRole("admin", "member");

    await db.insert(installationKiosks).values({ installationId, kioskId });

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to link kiosk to installation";
    return { error: message };
  }
}

/**
 * Unlink a kiosk from an installation.
 */
export async function unlinkKioskFromInstallation(
  installationId: string,
  kioskId: string
) {
  try {
    await requireRole("admin", "member");

    await db
      .delete(installationKiosks)
      .where(
        and(
          eq(installationKiosks.installationId, installationId),
          eq(installationKiosks.kioskId, kioskId)
        )
      );

    return { success: true as const };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to unlink kiosk from installation";
    return { error: message };
  }
}
