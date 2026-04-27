// Task 2.10 — Plateau detection insight for the maturity dashboard.
//
// The previous implementation compared `bucketMetrics["1-3mo"]` vs
// `bucketMetrics["9+mo"]`, i.e. today's young cohort vs today's mature cohort.
// Those are different populations — one is "kiosks installed 1-3 months ago",
// the other "kiosks installed 9+ months ago" — so the delta reflects launch
// quality, kiosk model, market shifts, etc. rather than any cohort's
// trajectory over time.
//
// Real plateau detection asks: *for the same kiosks*, does revenue flatten as
// they age? `rampCurve` from `getRevenueRampCurve` is the right shape: each
// point is "average revenue per location while they were in maturity stage N".
// Each location contributes to every stage it has reached, so comparing
// rampCurve[1-3mo] vs rampCurve[9+mo] is approximately the same-cohort
// progression (survival bias remains — locations that died before reaching
// 9mo aren't in the denominator — but it's strictly closer to correct than
// the cross-section comparison, and it's the data we already have on the wire).

import type { MaturityAnalysis, RevenueRampPoint } from "./types";

// Plateau threshold — % change in average revenue from the young (1-3mo)
// ramp point to the mature (9+mo) ramp point. Within ±PLATEAU_THRESHOLD_PCT
// the cohort is considered to have plateaued. Tune here; if/when an admin
// settings table grows a "maturity insight thresholds" section, lift this
// out and read from there.
export const PLATEAU_THRESHOLD_PCT = 10;

// `monthsSinceInstall` on `RevenueRampPoint` is the bucket's lower edge
// (see getRevenueRampCurve): 0, 1, 3, 6, 9. We anchor the comparison to
// 1 (start of "1-3mo") and 9 ("9+mo"), the same anchors the previous
// bucketMetrics implementation used — except now from the same-cohort series.
const YOUNG_RAMP_INDEX = 1;
const MATURE_RAMP_INDEX = 9;

export type PlateauInsight = { text: string; color: string };

const COLOR_GROW = "#166534";
const COLOR_DECLINE = "#991B1B";
const COLOR_NEUTRAL = "#6B7280";

const INSUFFICIENT: PlateauInsight = {
  text: "Insufficient data to determine maturity trend",
  color: COLOR_NEUTRAL,
};

function findRampPoint(
  rampCurve: RevenueRampPoint[],
  monthsSinceInstall: number,
): RevenueRampPoint | undefined {
  return rampCurve.find((p) => p.monthsSinceInstall === monthsSinceInstall);
}

export function getPlateauInsight(
  data: MaturityAnalysis,
  metricLabel: string,
  thresholdPct: number = PLATEAU_THRESHOLD_PCT,
): PlateauInsight {
  const rampCurve = data.rampCurve;
  if (!rampCurve || rampCurve.length === 0) return INSUFFICIENT;

  const young = findRampPoint(rampCurve, YOUNG_RAMP_INDEX);
  const mature = findRampPoint(rampCurve, MATURE_RAMP_INDEX);

  if (
    !young ||
    !mature ||
    young.locationCount === 0 ||
    mature.locationCount === 0
  ) {
    return INSUFFICIENT;
  }

  const avgYoung = young.avgRevenue;
  const avgMature = mature.avgRevenue;

  // Guard against zero AND negative — a negative `avgYoung` (theoretical, but
  // possible if revenue includes refunds / chargebacks net-of-fees) flips the
  // sign of `pctChange` and produces a misleading insight.
  if (avgYoung <= 0) return INSUFFICIENT;

  const pctChange = ((avgMature - avgYoung) / avgYoung) * 100;

  if (pctChange > thresholdPct) {
    return {
      text: `Mature kiosks continue to grow (+${pctChange.toFixed(1)}%)`,
      color: COLOR_GROW,
    };
  }
  if (pctChange < -thresholdPct) {
    return {
      text: `${metricLabel} declines after maturity (${pctChange.toFixed(1)}%)`,
      color: COLOR_DECLINE,
    };
  }
  return {
    text: `${metricLabel} plateaus after 9 months`,
    color: COLOR_NEUTRAL,
  };
}
