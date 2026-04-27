"use server";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  getAnalyticsDisplayTimezone,
  DISPLAY_TIMEZONE_TAG,
  type AnalyticsDisplayTimezone,
} from "@/lib/analytics/display-timezone-server";
import { revalidateTag } from "next/cache";

const KEY = "analytics_display_timezone";

export async function fetchAnalyticsDisplayTimezone(): Promise<AnalyticsDisplayTimezone> {
  await requireRole("admin");
  return getAnalyticsDisplayTimezone();
}

export async function saveAnalyticsDisplayTimezone(
  value: AnalyticsDisplayTimezone,
): Promise<{ success: true } | { error: string }> {
  const session = await requireRole("admin");

  if (value !== "local" && value !== "utc") {
    return { error: "Invalid timezone mode" };
  }

  try {
    const old = await getAnalyticsDisplayTimezone();

    await db
      .insert(appSettings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "app_setting",
      entityId: KEY,
      entityName: "Analytics Display Timezone",
      action: "update",
      field: "value",
      oldValue: old,
      newValue: value,
    });

    revalidateTag(DISPLAY_TIMEZONE_TAG, "max");

    return { success: true };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to save analytics display timezone",
    };
  }
}
