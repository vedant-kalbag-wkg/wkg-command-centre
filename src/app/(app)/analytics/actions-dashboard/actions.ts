"use server";

import { db } from "@/db";
import { actionItems, locations, user } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq, and, sql } from "drizzle-orm";
import type {
  ActionItem,
  ActionItemStatus,
  ActionItemType,
} from "@/lib/analytics/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth() {
  const ctx = await getUserCtx();
  const { auth } = await import("@/lib/auth");
  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");
  return { ctx, actorId: session.user.id, actorName: session.user.name };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List action items with optional filters, joining location name + owner name.
 */
export async function listActionItems(
  filters?: {
    status?: string;
    actionType?: string;
    ownerId?: string;
  },
): Promise<ActionItem[]> {
  await getUserCtx(); // auth gate

  const conditions: ReturnType<typeof eq>[] = [];

  if (filters?.status) {
    conditions.push(eq(actionItems.status, filters.status as ActionItemStatus));
  }
  if (filters?.actionType) {
    conditions.push(eq(actionItems.actionType, filters.actionType as ActionItemType));
  }
  if (filters?.ownerId) {
    conditions.push(eq(actionItems.ownerId, filters.ownerId));
  }

  const owner = db
    .select({ id: user.id, name: user.name })
    .from(user)
    .as("owner");

  const rows = await db
    .select({
      id: actionItems.id,
      sourceType: actionItems.sourceType,
      sourceId: actionItems.sourceId,
      locationId: actionItems.locationId,
      locationName: locations.name,
      actionType: actionItems.actionType,
      title: actionItems.title,
      description: actionItems.description,
      ownerName: owner.name,
      ownerId: actionItems.ownerId,
      dueDate: actionItems.dueDate,
      status: actionItems.status,
      outcomeNotes: actionItems.outcomeNotes,
      resolvedAt: actionItems.resolvedAt,
      createdAt: actionItems.createdAt,
    })
    .from(actionItems)
    .leftJoin(locations, eq(actionItems.locationId, locations.id))
    .leftJoin(owner, eq(actionItems.ownerId, owner.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(actionItems.createdAt);

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType as ActionItem["sourceType"],
    sourceId: r.sourceId,
    locationId: r.locationId,
    locationName: r.locationName ?? null,
    actionType: r.actionType as ActionItemType,
    title: r.title,
    description: r.description,
    ownerName: r.ownerName ?? null,
    ownerId: r.ownerId,
    dueDate: r.dueDate,
    status: r.status as ActionItemStatus,
    outcomeNotes: r.outcomeNotes,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new action item.
 */
export async function createActionItem(data: {
  title: string;
  actionType: ActionItemType;
  description?: string;
  ownerId?: string;
  dueDate?: string;
  locationId?: string;
  sourceType: "flag" | "manual" | "data_quality";
  sourceId?: string;
}): Promise<ActionItem> {
  const { actorId, actorName } = await requireAuth();

  const [row] = await db
    .insert(actionItems)
    .values({
      title: data.title,
      actionType: data.actionType,
      description: data.description ?? null,
      ownerId: data.ownerId ?? null,
      dueDate: data.dueDate ?? null,
      locationId: data.locationId ?? null,
      sourceType: data.sourceType,
      sourceId: data.sourceId ?? null,
      createdBy: actorId,
    })
    .returning();

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "action_item",
    entityId: row.id,
    entityName: data.title,
    action: "create",
    newValue: data.actionType,
    field: "actionType",
  });

  // Re-fetch with joins for location/owner name
  const items = await listActionItems();
  return items.find((i) => i.id === row.id) ?? {
    id: row.id,
    sourceType: row.sourceType as ActionItem["sourceType"],
    sourceId: row.sourceId,
    locationId: row.locationId,
    locationName: null,
    actionType: row.actionType as ActionItemType,
    title: row.title,
    description: row.description,
    ownerName: null,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    status: row.status as ActionItemStatus,
    outcomeNotes: row.outcomeNotes,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Update the status of an action item. If status is "resolved", also set
 * resolvedAt. Optionally attach outcome notes.
 */
export async function updateActionItemStatus(
  id: string,
  status: ActionItemStatus,
  outcomeNotes?: string,
): Promise<ActionItem> {
  const { actorId, actorName } = await requireAuth();

  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (outcomeNotes !== undefined) {
    updates.outcomeNotes = outcomeNotes;
  }

  if (status === "resolved") {
    updates.resolvedAt = new Date();
  }

  const [row] = await db
    .update(actionItems)
    .set(updates)
    .where(eq(actionItems.id, id))
    .returning();

  if (!row) throw new Error("Action item not found");

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "action_item",
    entityId: row.id,
    entityName: row.title,
    action: "update",
    field: "status",
    newValue: status,
  });

  // Re-fetch with joins
  const items = await listActionItems();
  return items.find((i) => i.id === row.id) ?? {
    id: row.id,
    sourceType: row.sourceType as ActionItem["sourceType"],
    sourceId: row.sourceId,
    locationId: row.locationId,
    locationName: null,
    actionType: row.actionType as ActionItemType,
    title: row.title,
    description: row.description,
    ownerName: null,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    status: row.status as ActionItemStatus,
    outcomeNotes: row.outcomeNotes,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * List users for the owner assignment picker.
 */
export async function listUsersForPicker(): Promise<
  { id: string; name: string }[]
> {
  await getUserCtx(); // auth gate

  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(user.name);

  return rows;
}
