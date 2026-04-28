"use server";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  getThresholds,
  getOutletTierThresholds,
  THRESHOLDS_TAG,
  OUTLET_TIER_THRESHOLDS_TAG,
} from "@/lib/analytics/thresholds-server";
import { revalidateTag } from "next/cache";
import type {
  ThresholdConfig,
  OutletTierConfig,
} from "@/lib/analytics/thresholds";

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

// ─── Outlet-tier thresholds (Phase 6 plan 06-05) ────────────────────────────
//
// Sibling action pair for the percentile-based outlet-tier cutoffs persisted
// at `appSettings` keys threshold_outlet_tier_{top,mid,bottom}. Kept separate
// from the heat-map traffic-light pair above so each save flow is single-
// purpose and the audit-log row carries an unambiguous `field` value.

export async function fetchOutletTierThresholds(): Promise<OutletTierConfig> {
  await requireRole("admin");
  return getOutletTierThresholds();
}

export async function saveOutletTierThresholds(
  config: OutletTierConfig,
): Promise<{ success: true } | { error: string }> {
  const session = await requireRole("admin");

  // Range checks first — caller-friendly error messages.
  if (config.top <= 0 || config.top > 100) {
    return { error: "Top cutoff must be between 1 and 100" };
  }
  if (config.mid <= 0 || config.mid > 100) {
    return { error: "Mid cutoff must be between 1 and 100" };
  }
  if (config.bottom < 0 || config.bottom > 100) {
    return { error: "Bottom cutoff must be between 0 and 100" };
  }
  // Ordering invariant — `classifyOutletTier` relies on top > mid > bottom.
  if (!(config.top > config.mid && config.mid > config.bottom)) {
    return {
      error: "Cutoffs must satisfy: top > mid > bottom (e.g. 80 > 50 > 20)",
    };
  }

  try {
    const old = await getOutletTierThresholds();

    for (const [key, value] of [
      ["threshold_outlet_tier_top", config.top],
      ["threshold_outlet_tier_mid", config.mid],
      ["threshold_outlet_tier_bottom", config.bottom],
    ] as const) {
      await db
        .insert(appSettings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: String(value), updatedAt: new Date() },
        });
    }

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "app_setting",
      entityId: "outlet_tier_thresholds",
      entityName: "Outlet Tier Thresholds",
      action: "update",
      field: "outlet_tier_thresholds",
      oldValue: JSON.stringify(old),
      newValue: JSON.stringify(config),
    });

    // Invalidate the cached reader AND the consumer query (`getOutletTiers`
    // reads via the shared "outlet_tiers" tag) so the new cutoffs surface
    // immediately on the next portfolio fetch.
    revalidateTag(OUTLET_TIER_THRESHOLDS_TAG, "max");
    revalidateTag("outlet_tiers", "max");

    return { success: true };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to save outlet tier thresholds",
    };
  }
}
