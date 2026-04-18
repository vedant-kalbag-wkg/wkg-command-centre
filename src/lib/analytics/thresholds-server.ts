import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { ThresholdConfig } from "./thresholds";

const DEFAULTS: ThresholdConfig = { redMax: 500, greenMin: 1500 };

export async function getThresholds(): Promise<ThresholdConfig> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, ["threshold_red_max", "threshold_green_min"]));

  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    redMax: Number(map.get("threshold_red_max") ?? DEFAULTS.redMax),
    greenMin: Number(map.get("threshold_green_min") ?? DEFAULTS.greenMin),
  };
}
