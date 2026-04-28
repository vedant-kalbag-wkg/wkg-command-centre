export type TrafficLight = "red" | "amber" | "green";

export type ThresholdConfig = {
  redMax: number;
  greenMin: number;
};

/**
 * Outlet-tier percentile cutoffs used by `classifyOutletTier`. Mirror the
 * three keys persisted in `app_settings`: `threshold_outlet_tier_top`,
 * `threshold_outlet_tier_mid`, `threshold_outlet_tier_bottom`. Defaults are
 * 80 / 50 / 20 (per CONTEXT D-06). Caller is responsible for ensuring
 * `top > mid > bottom`; the form layer validates this on save.
 */
export type OutletTierConfig = {
  top: number;
  mid: number;
  bottom: number;
};

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
