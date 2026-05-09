export type Tier = "Premium" | "Standard" | "Developing" | "Emerging";
export type Decision = "flip-in" | "chronic" | "no-alert";

const BOTTOM_TIER: Tier = "Emerging";
const CHRONIC_CAP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Decide whether to send an underperformance alert for a kiosk this week.
 *
 * Rules (D-10):
 *  - "flip-in"  → kiosk just entered Emerging tier (was not Emerging before)
 *  - "chronic"  → kiosk remains Emerging and the 30-day cooldown has elapsed
 *  - "no-alert" → kiosk is not Emerging, or cooldown has not elapsed
 */
export function decideAlert(
  prior: { tier: Tier; lastAlertedAt: Date | null } | null,
  newTier: Tier,
  now: Date,
): Decision {
  if (newTier !== BOTTOM_TIER) return "no-alert";
  if (!prior || prior.tier !== BOTTOM_TIER) return "flip-in";
  if (
    prior.lastAlertedAt === null ||
    now.getTime() - prior.lastAlertedAt.getTime() >= CHRONIC_CAP_MS
  ) {
    return "chronic";
  }
  return "no-alert";
}
