import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import type { ThresholdConfig, OutletTierConfig } from "./thresholds";

const DEFAULTS: ThresholdConfig = { redMax: 500, greenMin: 1500 };

export const THRESHOLDS_TAG = "analytics:thresholds";

const getThresholdsCached = unstable_cache(
  async (): Promise<ThresholdConfig> => {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, ["threshold_red_max", "threshold_green_min"]));

    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      redMax: Number(map.get("threshold_red_max") ?? DEFAULTS.redMax),
      greenMin: Number(map.get("threshold_green_min") ?? DEFAULTS.greenMin),
    };
  },
  ["analytics", "thresholds", "v1"],
  { revalidate: 86400, tags: ["analytics", THRESHOLDS_TAG] },
);

export async function getThresholds(): Promise<ThresholdConfig> {
  return getThresholdsCached();
}

// ─── Outlet-tier thresholds (Phase 6 plan 06-05) ────────────────────────────
//
// Sibling cached reader for the percentile-based outlet-tier cutoffs. Kept
// separate from the heat-map traffic-light reader (`getThresholds`) so the
// cache-tag invalidation surface stays tight: changing tier cutoffs shouldn't
// invalidate the heat-map cache, and vice versa. The shared `"outlet_tiers"`
// tag is also revalidated on save so consumer queries (e.g. `getOutletTiers`
// in `queries/portfolio.ts`) pick up new values immediately.

const OUTLET_TIER_DEFAULTS: OutletTierConfig = { top: 80, mid: 50, bottom: 20 };

export const OUTLET_TIER_THRESHOLDS_TAG = "analytics:outlet_tier_thresholds";

export const getOutletTierThresholdsCached = unstable_cache(
  async (): Promise<OutletTierConfig> => {
    const rows = await db
      .select()
      .from(appSettings)
      .where(
        inArray(appSettings.key, [
          "threshold_outlet_tier_top",
          "threshold_outlet_tier_mid",
          "threshold_outlet_tier_bottom",
        ]),
      );

    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      top: Number(
        map.get("threshold_outlet_tier_top") ?? OUTLET_TIER_DEFAULTS.top,
      ),
      mid: Number(
        map.get("threshold_outlet_tier_mid") ?? OUTLET_TIER_DEFAULTS.mid,
      ),
      bottom: Number(
        map.get("threshold_outlet_tier_bottom") ?? OUTLET_TIER_DEFAULTS.bottom,
      ),
    };
  },
  ["analytics", "outlet_tier_thresholds", "v1"],
  {
    revalidate: 86400,
    tags: ["analytics", OUTLET_TIER_THRESHOLDS_TAG, "outlet_tiers"],
  },
);

export async function getOutletTierThresholds(): Promise<OutletTierConfig> {
  return getOutletTierThresholdsCached();
}
