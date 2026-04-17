import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";

export type TrafficLight = "red" | "amber" | "green";

export type ThresholdConfig = {
  redMax: number;
  greenMin: number;
};

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

export function classifyTrafficLight(
  revenue: number,
  config: ThresholdConfig,
): TrafficLight {
  if (revenue <= config.redMax) return "red";
  if (revenue >= config.greenMin) return "green";
  return "amber";
}

export function trafficLightColor(light: TrafficLight): string {
  switch (light) {
    case "red":
      return "text-red-600";
    case "amber":
      return "text-amber-500";
    case "green":
      return "text-green-600";
  }
}

export function trafficLightBgColor(light: TrafficLight): string {
  switch (light) {
    case "red":
      return "bg-red-100 text-red-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "green":
      return "bg-green-100 text-green-700";
  }
}
