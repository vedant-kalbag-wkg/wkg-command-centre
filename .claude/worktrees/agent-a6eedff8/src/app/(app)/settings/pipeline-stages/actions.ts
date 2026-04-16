"use server";

import { db } from "@/db";
import { pipelineStages, kiosks } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { eq, isNull, count, max } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Pipeline stage server actions — admin only
// ---------------------------------------------------------------------------

export async function createStage(name: string, color?: string) {
  try {
    await requireRole("admin");

    // Find max position, then append at max + 1000
    const [{ maxPos }] = await db
      .select({ maxPos: max(pipelineStages.position) })
      .from(pipelineStages);

    const newPosition = (maxPos ?? 0) + 1000;

    const [newStage] = await db
      .insert(pipelineStages)
      .values({
        name,
        color: color ?? "#00A6D3",
        position: newPosition,
        isDefault: false,
      })
      .returning({ id: pipelineStages.id });

    return { success: true as const, id: newStage.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create stage";
    return { error: message };
  }
}

export async function updateStage(
  stageId: string,
  data: { name?: string; color?: string; isDefault?: boolean }
) {
  try {
    await requireRole("admin");

    // If setting as default, unset all others first
    if (data.isDefault) {
      await db
        .update(pipelineStages)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(pipelineStages.isDefault, true));
    }

    await db
      .update(pipelineStages)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pipelineStages.id, stageId));

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update stage";
    return { error: message };
  }
}

export async function deleteStage(stageId: string, reassignToStageId?: string) {
  try {
    await requireRole("admin");

    // Cannot delete the last remaining stage
    const [{ stageCount }] = await db
      .select({ stageCount: count() })
      .from(pipelineStages);

    if (stageCount <= 1) {
      return { error: "Cannot delete the last remaining stage" };
    }

    // Count kiosks in this stage
    const [{ kioskCount }] = await db
      .select({ kioskCount: count() })
      .from(kiosks)
      .where(eq(kiosks.pipelineStageId, stageId));

    if (kioskCount > 0 && !reassignToStageId) {
      return { error: "Stage has kiosks", kioskCount };
    }

    // Reassign kiosks if needed
    if (kioskCount > 0 && reassignToStageId) {
      await db
        .update(kiosks)
        .set({ pipelineStageId: reassignToStageId, updatedAt: new Date() })
        .where(eq(kiosks.pipelineStageId, stageId));
    }

    // Delete the stage
    await db.delete(pipelineStages).where(eq(pipelineStages.id, stageId));

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete stage";
    return { error: message };
  }
}

export async function reorderStage(
  stageId: string,
  afterPosition: number | null,
  beforePosition: number | null
) {
  try {
    await requireRole("admin");

    let newPosition: number;

    if (afterPosition === null && beforePosition !== null) {
      // Moving to first position
      newPosition = beforePosition / 2;
    } else if (afterPosition !== null && beforePosition === null) {
      // Moving to last position
      newPosition = afterPosition + 1000;
    } else if (afterPosition !== null && beforePosition !== null) {
      // Moving between two stages — midpoint
      newPosition = (afterPosition + beforePosition) / 2;
    } else {
      return { error: "Invalid reorder parameters" };
    }

    await db
      .update(pipelineStages)
      .set({ position: newPosition, updatedAt: new Date() })
      .where(eq(pipelineStages.id, stageId));

    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder stage";
    return { error: message };
  }
}

export async function getStageKioskCount(stageId: string) {
  try {
    const [{ kioskCount }] = await db
      .select({ kioskCount: count() })
      .from(kiosks)
      .where(
        eq(kiosks.pipelineStageId, stageId)
      );

    return { count: kioskCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get kiosk count";
    return { error: message };
  }
}
