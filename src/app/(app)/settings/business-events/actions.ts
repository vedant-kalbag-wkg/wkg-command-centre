"use server";

import { db } from "@/db";
import { businessEvents, eventCategories, user } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Business events + event categories server actions — admin only
// ---------------------------------------------------------------------------

// -- Types ------------------------------------------------------------------

export type CategoryRow = {
  id: string;
  name: string;
  color: string;
  isCore: boolean;
  createdAt: string;
};

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  startDate: string;
  endDate: string | null;
  scopeType: string | null;
  scopeValue: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

// -- Categories -------------------------------------------------------------

export async function listCategories(): Promise<
  { categories: CategoryRow[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const rows = await db
      .select()
      .from(eventCategories)
      .orderBy(eventCategories.name);

    const categories: CategoryRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      isCore: r.isCore,
      createdAt: r.createdAt.toISOString(),
    }));

    return { categories };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list categories";
    return { error: message };
  }
}

export async function createCategory(data: {
  name: string;
  color: string;
  isCore?: boolean;
}): Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const [row] = await db
      .insert(eventCategories)
      .values({
        name: data.name,
        color: data.color,
        isCore: data.isCore ?? false,
      })
      .returning({ id: eventCategories.id });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "event_category",
      entityId: row.id,
      entityName: data.name,
      action: "create",
    });

    return { success: true, id: row.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create category";
    return { error: message };
  }
}

export async function updateCategory(
  id: string,
  data: { name?: string; color?: string; isCore?: boolean },
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    // eventCategories has no updatedAt column — only update the provided fields
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.color !== undefined) updates.color = data.color;
    if (data.isCore !== undefined) updates.isCore = data.isCore;

    if (Object.keys(updates).length > 0) {
      await db
        .update(eventCategories)
        .set(updates)
        .where(eq(eventCategories.id, id));
    }

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "event_category",
      entityId: id,
      entityName: data.name ?? id,
      action: "update",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update category";
    return { error: message };
  }
}

export async function deleteCategory(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    // Check if any events reference this category
    const eventsUsingCategory = await db
      .select({ id: businessEvents.id })
      .from(businessEvents)
      .where(eq(businessEvents.categoryId, id))
      .limit(1);

    if (eventsUsingCategory.length > 0) {
      return {
        error:
          "Cannot delete category — it is used by one or more business events. Reassign those events first.",
      };
    }

    const [existing] = await db
      .select({ name: eventCategories.name })
      .from(eventCategories)
      .where(eq(eventCategories.id, id));

    await db.delete(eventCategories).where(eq(eventCategories.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "event_category",
      entityId: id,
      entityName: existing?.name ?? id,
      action: "delete",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete category";
    return { error: message };
  }
}

// -- Events -----------------------------------------------------------------

export async function listEvents(): Promise<
  { events: EventRow[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const rows = await db
      .select({
        id: businessEvents.id,
        title: businessEvents.title,
        description: businessEvents.description,
        categoryId: businessEvents.categoryId,
        categoryName: eventCategories.name,
        categoryColor: eventCategories.color,
        startDate: businessEvents.startDate,
        endDate: businessEvents.endDate,
        scopeType: businessEvents.scopeType,
        scopeValue: businessEvents.scopeValue,
        createdBy: businessEvents.createdBy,
        createdByName: user.name,
        createdAt: businessEvents.createdAt,
      })
      .from(businessEvents)
      .leftJoin(eventCategories, eq(businessEvents.categoryId, eventCategories.id))
      .leftJoin(user, eq(businessEvents.createdBy, user.id))
      .orderBy(businessEvents.startDate);

    const events: EventRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      categoryId: r.categoryId,
      categoryName: r.categoryName ?? "Unknown",
      categoryColor: r.categoryColor ?? "#666666",
      startDate: r.startDate,
      endDate: r.endDate,
      scopeType: r.scopeType,
      scopeValue: r.scopeValue,
      createdBy: r.createdBy,
      createdByName: r.createdByName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return { events };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list events";
    return { error: message };
  }
}

export async function createEvent(data: {
  title: string;
  description?: string;
  categoryId: string;
  startDate: string;
  endDate?: string;
  scopeType?: string;
  scopeValue?: string;
}): Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const [row] = await db
      .insert(businessEvents)
      .values({
        title: data.title,
        description: data.description || null,
        categoryId: data.categoryId,
        startDate: data.startDate,
        endDate: data.endDate || null,
        scopeType: (data.scopeType as "global" | "hotel" | "region" | "hotel_group") || null,
        scopeValue: data.scopeValue || null,
        createdBy: session.user.id,
      })
      .returning({ id: businessEvents.id });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "business_event",
      entityId: row.id,
      entityName: data.title,
      action: "create",
    });

    return { success: true, id: row.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create event";
    return { error: message };
  }
}

export async function updateEvent(
  id: string,
  data: {
    title?: string;
    description?: string;
    categoryId?: string;
    startDate?: string;
    endDate?: string | null;
    scopeType?: string | null;
    scopeValue?: string | null;
  },
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined)
      updates.description = data.description || null;
    if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
    if (data.startDate !== undefined) updates.startDate = data.startDate;
    if (data.endDate !== undefined) updates.endDate = data.endDate;
    if (data.scopeType !== undefined) updates.scopeType = data.scopeType;
    if (data.scopeValue !== undefined) updates.scopeValue = data.scopeValue;

    await db
      .update(businessEvents)
      .set(updates)
      .where(eq(businessEvents.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "business_event",
      entityId: id,
      entityName: data.title ?? id,
      action: "update",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update event";
    return { error: message };
  }
}

export async function deleteEvent(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await requireRole("admin");

    const [existing] = await db
      .select({ title: businessEvents.title })
      .from(businessEvents)
      .where(eq(businessEvents.id, id));

    await db.delete(businessEvents).where(eq(businessEvents.id, id));

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "business_event",
      entityId: id,
      entityName: existing?.title ?? id,
      action: "delete",
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete event";
    return { error: message };
  }
}
