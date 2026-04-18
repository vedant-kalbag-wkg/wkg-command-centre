export type TrafficLight = "red" | "amber" | "green";

export type ThresholdConfig = {
  redMax: number;
  greenMin: number;
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
