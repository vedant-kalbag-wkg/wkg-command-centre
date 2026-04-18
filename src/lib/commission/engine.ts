import type {
  TierConfig,
  VersionedTierConfig,
  TierBreakdownEntry,
  CommissionResult,
} from "./types";

/**
 * Find the active tier configuration for a given transaction date.
 * Filters to configs where effectiveFrom <= transactionDate, then
 * returns the one with the latest effectiveFrom.
 */
export function getActiveTierConfig(
  history: VersionedTierConfig[],
  transactionDate: string,
): VersionedTierConfig | null {
  const eligible = history.filter((h) => h.effectiveFrom <= transactionDate);
  if (eligible.length === 0) return null;

  return eligible.reduce((latest, cur) =>
    cur.effectiveFrom > latest.effectiveFrom ? cur : latest,
  );
}

/**
 * Calculate waterfall commission across tier brackets.
 *
 * @param commissionableAmount - revenue from this single transaction
 * @param cumulativeBeforeThis - cumulative revenue already processed before this transaction
 * @param tiers - tier brackets (will be sorted by minRevenue ascending)
 *
 * A single transaction can span multiple tiers. The cumulative cursor
 * determines where within the bracket structure this transaction starts.
 */
export function calculateWaterfallCommission(
  commissionableAmount: number,
  cumulativeBeforeThis: number,
  tiers: TierConfig[],
): { commissionAmount: number; breakdown: TierBreakdownEntry[] } {
  if (commissionableAmount <= 0 || tiers.length === 0) {
    return { commissionAmount: 0, breakdown: [] };
  }

  const sorted = [...tiers].sort((a, b) => a.minRevenue - b.minRevenue);

  let remaining = commissionableAmount;
  let cursor = cumulativeBeforeThis;
  let totalCommission = 0;
  const breakdown: TierBreakdownEntry[] = [];

  for (const tier of sorted) {
    if (remaining <= 0) break;

    const tierCeiling = tier.maxRevenue ?? Infinity;

    // Skip tiers the cursor has already passed
    if (cursor >= tierCeiling) continue;

    // If cursor is below this tier's floor, advance it
    const effectiveStart = Math.max(cursor, tier.minRevenue);
    const spaceInTier = tierCeiling - effectiveStart;
    const revenueInTier = Math.min(remaining, spaceInTier);

    if (revenueInTier <= 0) continue;

    const commission = Math.round(revenueInTier * tier.rate * 100) / 100;
    totalCommission += commission;
    breakdown.push({
      tierRate: tier.rate,
      revenueInTier,
      commission,
    });

    remaining -= revenueInTier;
    cursor = effectiveStart + revenueInTier;
  }

  return { commissionAmount: totalCommission, breakdown };
}

/**
 * Top-level commission calculation for a single transaction.
 *
 * @param grossAmount - gross transaction amount
 * @param _bookingFee - booking fee (reserved for future use)
 * @param cumulativeBeforeThis - cumulative revenue already processed
 * @param tierHistory - versioned tier configurations
 * @param transactionDate - ISO date string of the transaction
 */
export function calculateCommission(
  grossAmount: number,
  _bookingFee: number,
  cumulativeBeforeThis: number,
  tierHistory: VersionedTierConfig[],
  transactionDate: string,
): CommissionResult | null {
  const activeTier = getActiveTierConfig(tierHistory, transactionDate);
  if (!activeTier) return null;

  const commissionableAmount = grossAmount;
  const { commissionAmount, breakdown } = calculateWaterfallCommission(
    commissionableAmount,
    cumulativeBeforeThis,
    activeTier.tiers,
  );

  return {
    commissionableAmount,
    commissionAmount,
    tierBreakdown: breakdown,
    tierVersionEffectiveFrom: activeTier.effectiveFrom,
  };
}
