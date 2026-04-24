"use server";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { getThresholds, THRESHOLDS_TAG } from "@/lib/analytics/thresholds-server";
import { revalidateTag } from "next/cache";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";

export async function fetchThresholds(): Promise<ThresholdConfig> {
  await requireRole("admin");
  return getThresholds();
}

export async function saveThresholds(
  config: ThresholdConfig,
): Promise<{ success: true } | { error: string }> {
  const session = await requireRole("admin");

  if (config.redMax < 0 || config.greenMin < 0) {
    return { error: "Threshold values must be non-negative" };
  }
  if (config.redMax >= config.greenMin) {
    return { error: "Red Max must be less than Green Min" };
  }

  try {
    const old = await getThresholds();

    // Upsert threshold_red_max
    await db
      .insert(appSettings)
      .values({ key: "threshold_red_max", value: String(config.redMax) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: String(config.redMax), updatedAt: new Date() },
      });

    // Upsert threshold_green_min
    await db
      .insert(appSettings)
      .values({ key: "threshold_green_min", value: String(config.greenMin) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: String(config.greenMin), updatedAt: new Date() },
      });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "app_setting",
      entityId: "traffic_light_thresholds",
      entityName: "Traffic Light Thresholds",
      action: "update",
      field: "redMax,greenMin",
      oldValue: JSON.stringify(old),
      newValue: JSON.stringify(config),
    });

    revalidateTag(THRESHOLDS_TAG, "max");

    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save thresholds",
    };
  }
}
