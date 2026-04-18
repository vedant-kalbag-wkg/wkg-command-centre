export type TierConfig = {
  minRevenue: number;
  maxRevenue: number | null;
  rate: number;
};

export type VersionedTierConfig = {
  effectiveFrom: string;
  tiers: TierConfig[];
};

export type TierBreakdownEntry = {
  tierRate: number;
  revenueInTier: number;
  commission: number;
};

export type CommissionResult = {
  commissionableAmount: number;
  commissionAmount: number;
  tierBreakdown: TierBreakdownEntry[];
  tierVersionEffectiveFrom: string;
};
