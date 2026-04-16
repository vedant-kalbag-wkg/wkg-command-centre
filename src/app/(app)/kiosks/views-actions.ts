"use server";

import { z } from "zod/v4";
import { db } from "@/db";
import { userViews } from "@/db/schema";
import { getSessionOrThrow } from "@/lib/rbac";
import { eq, and } from "drizzle-orm";
import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KioskViewConfig {
  columnFilters?: ColumnFiltersState;
  sorting?: SortingState;
  grouping?: string[];
  columnVisibility?: VisibilityState;
}

const ENTITY_TYPE = "kiosk";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const saveViewSchema = z.object({
  name: z.string().min(1, "View name is required").max(100, "Name must be 100 characters or fewer"),
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function saveView(name: string, config: KioskViewConfig, viewType: string = "table") {
  const parsed = saveViewSchema.parse({ name });
  const session = await getSessionOrThrow();

  const [view] = await db
    .insert(userViews)
    .values({
      userId: session.user.id,
      name: parsed.name,
      entityType: ENTITY_TYPE,
      viewType,
      config: config as Record<string, unknown>,
    })
    .returning({ id: userViews.id, name: userViews.name });

  return { success: true as const, id: view.id, name: view.name };
}

export async function listSavedViews(viewType: string = "table") {
  const session = await getSessionOrThrow();
  return db
    .select()
    .from(userViews)
    .where(
      and(
        eq(userViews.userId, session.user.id),
        eq(userViews.entityType, ENTITY_TYPE),
        eq(userViews.viewType, viewType)
      )
    )
    .orderBy(userViews.createdAt);
}

export async function updateView(viewId: string, name: string, config: KioskViewConfig) {
  const parsed = saveViewSchema.parse({ name });
  const session = await getSessionOrThrow();

  // Verify ownership
  const [existing] = await db
    .select({ id: userViews.id })
    .from(userViews)
    .where(
      and(
        eq(userViews.id, viewId),
        eq(userViews.userId, session.user.id),
        eq(userViews.entityType, ENTITY_TYPE)
      )
    )
    .limit(1);

  if (!existing) return { error: "View not found" };

  await db
    .update(userViews)
    .set({
      name: parsed.name,
      config: config as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(userViews.id, viewId));

  return { success: true as const };
}

export async function deleteView(viewId: string) {
  const session = await getSessionOrThrow();

  // Verify ownership
  const [existing] = await db
    .select({ id: userViews.id })
    .from(userViews)
    .where(
      and(
        eq(userViews.id, viewId),
        eq(userViews.userId, session.user.id),
        eq(userViews.entityType, ENTITY_TYPE)
      )
    )
    .limit(1);

  if (!existing) return { error: "View not found" };

  await db.delete(userViews).where(eq(userViews.id, viewId));

  return { success: true as const };
}
