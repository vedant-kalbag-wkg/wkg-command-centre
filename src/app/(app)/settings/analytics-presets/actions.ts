"use server";

import { db } from "@/db";
import { analyticsPresets, user } from "@/db/schema";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, or } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Analytics preset server actions — admin only for CRUD
// ---------------------------------------------------------------------------

export type PresetRow = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  config: unknown;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function listPresets(): Promise<
  { presets: PresetRow[] } | { error: string }
> {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;

    // Fetch presets that are shared OR owned by the current user
    const rows = await db
      .select({
        id: analyticsPresets.id,
        name: analyticsPresets.name,
        ownerId: analyticsPresets.ownerId,
        ownerName: user.name,
        config: analyticsPresets.config,
        isShared: analyticsPresets.isShared,
        createdAt: analyticsPresets.createdAt,
        updatedAt: analyticsPresets.updatedAt,
      })
      .from(analyticsPresets)
      .leftJoin(user, eq(analyticsPresets.ownerId, user.id))
      .where(
        or(
          eq(analyticsPresets.isShared, true),
          eq(analyticsPresets.ownerId, userId),
        ),
      )
      .orderBy(analyticsPresets.createdAt);

    const presets: PresetRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      ownerName: r.ownerName ?? "Unknown",
      config: r.config,
      isShared: r.isShared,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return { presets };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list presets";
    return { error: message };
  }
}

export async function createPreset(data: {
  name: string;
  config: Record<string, unknown>;
  isShared: boolean;
}): Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const [row] = await db
      .insert(analyticsPresets)
      .values({
        name: data.name,
        ownerId: session.user.id,
        config: data.config,
        isShared: data.isShared,
      })
      .returning({ id: analyticsPresets.id });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "analytics_preset",
      entityId: row.id,
      entityName: data.name,
      action: "create",
    });

    return { success: true, id: row.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create preset";
    return { error: message };
  }
}

export async function updatePreset(
  id: string,
  data: {
    name?: string;
    config?: Record<string, unknown>;
    isShared?: boolean;
  },
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    await db
      .update(analyticsPresets)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
        ...(data.isShared !== undefined ? { isShared: data.isShared } : {}),
        updatedAt: new Date(),
      })
      .where(eq(analyticsPresets.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "analytics_preset",
      entityId: id,
      entityName: data.name ?? id,
      action: "update",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update preset";
    return { error: message };
  }
}

export async function deletePreset(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    // Fetch name for audit log before deletion
    const [existing] = await db
      .select({ name: analyticsPresets.name })
      .from(analyticsPresets)
      .where(eq(analyticsPresets.id, id));

    await db.delete(analyticsPresets).where(eq(analyticsPresets.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "analytics_preset",
      entityId: id,
      entityName: existing?.name ?? id,
      action: "delete",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete preset";
    return { error: message };
  }
}
