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
 *
 * Cold-start interaction (intentional): on the first cron run, the caller
 * suppresses ALL alerts and writes state rows with `lastAlertedAt: null`.
 * On the SECOND run, any kiosk that is still Emerging hits the
 * `prior.lastAlertedAt === null` branch below and resolves to "chronic" —
 * not "flip-in". This is correct: the kiosk has been Emerging for the
 * entire observed history, so the operator gets the chronic-underperformance
 * signal rather than a "newly slipped" framing. The `flip-in` framing is
 * reserved for kiosks that were previously NOT Emerging and have just
 * dropped into the bottom tier.
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
