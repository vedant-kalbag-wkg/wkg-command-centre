import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { getOutletTierThresholdsCached } from "@/lib/analytics/thresholds-server";
import type { OutletTierConfig } from "@/lib/analytics/thresholds";
import { classifyOutletTier } from "@/lib/analytics/metrics";
import {
  calculateCompositeScore,
  calculateRevenuePerRoom,
  calculateTxnPerKiosk,
  calculateAvgBasketValue,
} from "@/lib/analytics/metrics";
import type { Tier } from "@/lib/performance-alerts/classify-dispatch";

/**
 * Default heat-map composite-score weights. Mirrors `DEFAULT_SCORE_WEIGHTS`
 * in `src/lib/analytics/queries/heat-map.ts` — the source of truth for
 * dashboard-side ranking. We snapshot the values here (not import) to keep
 * the alert classifier resilient to a future refactor that moves weights into
 * `app_settings`; the email's footnote renders these values verbatim, so
 * keeping them in code (and grepable) is intentional.
 */
export const DEFAULT_COMPOSITE_WEIGHTS = {
  revenue: 0.3,
  transactions: 0.2,
  revenuePerRoom: 0.25,
  txnPerKiosk: 0.15,
  basketValue: 0.1,
} as const;

/**
 * Maturity gate: a hotel is "mature" once its first kiosk has been live for
 * at least this many days. Excludes ramp-up sites whose composite score is
 * artificially low because they're still onboarding. 90 days = ~3 months,
 * matching the heat-map's "3-6mo / 6-9mo / 9+mo" maturity buckets used as
 * "mature only" elsewhere in the app.
 */
const MATURITY_DAYS = 90;

export type SubMetric = {
  /** Raw metric value in native units (revenue / count / rate). null when not computable. */
  value: number | null;
  /** Percentile rank within the eligible cohort, 0–100. null when value is null. */
  percentile: number | null;
};

export type ClassifiedLocationRow = {
  locationId: string;
  internalPocId: string | null;
  hotelName: string;
  region: string;
  /** Modal ISO-4217 currency code on this hotel's sales over the window. */
  currency: string;
  /** Total revenue in the trailing window, native currency. */
  totalRevenue: number;
  /** Distinct transactions in the trailing window. */
  totalTransactions: number;
  /** Distinct kiosks active at this location during the window. */
  kioskCount: number;
  /** Configured room count from `locations.numRooms`. null when unknown. */
  numRooms: number | null;
  /** Sub-metric breakdown that the email body and the cohort percentile lookup share. */
  subMetrics: {
    revenue: SubMetric;
    transactions: SubMetric;
    revenuePerRoom: SubMetric;
    txnPerKiosk: SubMetric;
    basketValue: SubMetric;
  };
  /** Weighted percentile composite, 0–100; the value also fed to the tier classifier. */
  compositeScore: number;
  /** Tier classification of the composite score under tierConfig (Premium/Standard/Developing/Emerging). */
  tier: Tier;
};

/**
 * Classify every eligible hotel by composite-score percentile. Mirrors the
 * dashboard heat-map: 5 sub-metrics percentile-ranked across the cohort,
 * weighted-summed via `DEFAULT_COMPOSITE_WEIGHTS`, then the composite tier-
 * classified using the admin-configurable `OutletTierConfig`.
 *
 * Eligibility:
 *  - locations.archived_at IS NULL
 *  - locations.alert_silenced_at IS NULL  (admin per-hotel silencing)
 *  - locations.location_type IS DISTINCT FROM 'internal'  (excludes the
 *    internal-only book-keeping rows that contaminate analytics elsewhere)
 *  - has at least one active kiosk currently at `pipeline_stage_id = Live`
 *  - mature: first kiosk assignment >= MATURITY_DAYS old (excludes ramp-up)
 *  - has at least 1 sales_record in the trailing-window date range (no-data
 *    locations would otherwise score 0 across all metrics and dominate the
 *    Emerging tier — the alert is meant to flag underperformance, not absence
 *    of data)
 *
 * Cross-currency forex normalisation is NOT applied — the percentile ranks
 * compare raw revenue across currencies. Acceptable for the current GBP-only
 * portfolio; tracked in #39 for multi-currency rollouts.
 *
 * Single-eligible-hotel cohort: `percentRanks` returns 50 for every metric
 * (matching the heat-map's lone-hotel convention), giving a composite of 50.
 * That sits above the default Bottom cutoff (20), so a one-hotel fleet is
 * effectively never alerted — there is no peer to be "underperforming" against.
 * Intentional and consistent with the dashboard.
 */
export async function classifyEligibleLocations(): Promise<{
  rows: ClassifiedLocationRow[];
  tierConfig: OutletTierConfig;
  windowDays: number;
  liveStageId: string;
  weights: typeof DEFAULT_COMPOSITE_WEIGHTS;
}> {
  const [windowDaysRow, liveStageRow, tierConfig] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, "underperformance_window_days")),
    db.select().from(appSettings).where(eq(appSettings.key, "pipeline_stage_id_live")),
    getOutletTierThresholdsCached(),
  ]);

  const windowDays = Number(windowDaysRow[0]?.value ?? 30);
  const liveStageId = liveStageRow[0]?.value;
  if (!liveStageId) {
    throw new Error("app_settings.pipeline_stage_id_live is missing — run migration 0043 first.");
  }

  // Per-location aggregation for the trailing window:
  //   revenue          — SUM(net_amount) over the window
  //   transactions     — COUNT(*) over the window
  //   kiosk_count      — DISTINCT kiosks with active assignment to this location
  //   num_rooms        — denormalised from locations.numRooms
  //   currency         — modal currency among in-window transactions, fallback GBP
  //   first_live_at    — MIN(kiosk_assignments.assigned_at) for any kiosk at location
  //   has_live_kiosk   — TRUE iff at least one current kiosk is Live-staged
  //   poc_user_id      — locations.internal_poc_id (the hotel-level POC)
  //   region_name      — regions.name via locations.primary_region_id
  const result = await db.execute(sql`
    SELECT
      l.id::text                                                        AS location_id,
      l.name                                                            AS hotel_name,
      r.name                                                            AS region_name,
      l.internal_poc_id                                                 AS internal_poc_id,
      l.num_rooms                                                       AS num_rooms,
      COALESCE(rev.total_revenue, 0)::float                             AS total_revenue,
      COALESCE(rev.total_transactions, 0)::int                          AS total_transactions,
      COALESCE(rev.currency, 'GBP')                                     AS currency,
      kn.kiosk_count::int                                               AS kiosk_count,
      ml.first_live_at                                                  AS first_live_at,
      kn.has_live_kiosk                                                 AS has_live_kiosk
    FROM locations l
    LEFT JOIN regions r
      ON r.id = l.primary_region_id

    -- Distinct kiosks currently assigned + flag whether any is at the Live stage.
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT ka.kiosk_id)::int AS kiosk_count,
        BOOL_OR(k.pipeline_stage_id = ${liveStageId}::uuid AND k.archived_at IS NULL) AS has_live_kiosk
      FROM kiosk_assignments ka
      JOIN kiosks k ON k.id = ka.kiosk_id
      WHERE ka.location_id = l.id
        AND ka.unassigned_at IS NULL
    ) kn ON TRUE

    -- Maturity: when did the FIRST kiosk land at this location? Used to gate
    -- ramp-up sites out of the alert cohort.
    LEFT JOIN LATERAL (
      SELECT MIN(ka2.assigned_at) AS first_live_at
      FROM kiosk_assignments ka2
      WHERE ka2.location_id = l.id
    ) ml ON TRUE

    -- In-window aggregates: revenue, txn count, modal currency.
    LEFT JOIN LATERAL (
      SELECT
        SUM(s.net_amount::numeric) AS total_revenue,
        COUNT(*) AS total_transactions,
        (
          SELECT s2.currency
          FROM sales_records s2
          WHERE s2.location_id = l.id
            AND s2.transaction_date >= NOW() - (${windowDays} || ' days')::interval
          GROUP BY s2.currency
          ORDER BY COUNT(*) DESC, s2.currency
          LIMIT 1
        ) AS currency
      FROM sales_records s
      WHERE s.location_id = l.id
        AND s.transaction_date >= NOW() - (${windowDays} || ' days')::interval
    ) rev ON TRUE

    WHERE l.archived_at IS NULL
      AND l.alert_silenced_at IS NULL
      AND COALESCE(l.location_type, '') <> 'internal'
      AND kn.has_live_kiosk = TRUE
      AND ml.first_live_at IS NOT NULL
      AND ml.first_live_at <= NOW() - (${MATURITY_DAYS} || ' days')::interval
      AND COALESCE(rev.total_transactions, 0) > 0
  `);

  const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

  type Raw = {
    location_id: string;
    hotel_name: string | null;
    region_name: string | null;
    internal_poc_id: string | null;
    num_rooms: number | null;
    total_revenue: number;
    total_transactions: number;
    currency: string;
    kiosk_count: number;
    first_live_at: Date | null;
    has_live_kiosk: boolean;
  };

  const parsed = rawRows as Raw[];
  if (parsed.length === 0) {
    return { rows: [], tierConfig, windowDays, liveStageId, weights: DEFAULT_COMPOSITE_WEIGHTS };
  }

  // Compute the 5 sub-metrics per row.
  const rowsRaw = parsed.map((r) => {
    const revenue = Number(r.total_revenue);
    const transactions = Number(r.total_transactions);
    const numRooms = r.num_rooms === null ? null : Number(r.num_rooms);
    const kiosks = Number(r.kiosk_count);
    return {
      raw: r,
      metrics: {
        revenue,
        transactions,
        revenuePerRoom: calculateRevenuePerRoom(revenue, numRooms),
        txnPerKiosk: calculateTxnPerKiosk(transactions, kiosks),
        // calculateAvgBasketValue may return null when transactions === 0; we've
        // already filtered those rows out at the SQL level so this is non-null.
        basketValue: calculateAvgBasketValue(revenue, transactions) ?? 0,
      },
    };
  });

  // Cohort-wide percentile ranks per metric. Higher = better for every
  // metric (revenue, transactions, rev/room, txn/kiosk, basket value), so
  // no inversion needed. percentRanks gives [0, 100] with NULL passthrough.
  const percentRevenue = percentRanks(rowsRaw.map((r) => r.metrics.revenue));
  const percentTxns = percentRanks(rowsRaw.map((r) => r.metrics.transactions));
  const percentRPR = percentRanks(rowsRaw.map((r) => r.metrics.revenuePerRoom));
  const percentTPK = percentRanks(rowsRaw.map((r) => r.metrics.txnPerKiosk));
  const percentABV = percentRanks(rowsRaw.map((r) => r.metrics.basketValue));

  const rows: ClassifiedLocationRow[] = rowsRaw.map(({ raw, metrics }, idx) => {
    const subMetrics = {
      revenue: { value: metrics.revenue, percentile: percentRevenue[idx] },
      transactions: { value: metrics.transactions, percentile: percentTxns[idx] },
      revenuePerRoom: { value: metrics.revenuePerRoom, percentile: percentRPR[idx] },
      txnPerKiosk: { value: metrics.txnPerKiosk, percentile: percentTPK[idx] },
      basketValue: { value: metrics.basketValue, percentile: percentABV[idx] },
    };

    const composite = calculateCompositeScore([
      { value: subMetrics.revenue.percentile, weight: DEFAULT_COMPOSITE_WEIGHTS.revenue },
      { value: subMetrics.transactions.percentile, weight: DEFAULT_COMPOSITE_WEIGHTS.transactions },
      { value: subMetrics.revenuePerRoom.percentile, weight: DEFAULT_COMPOSITE_WEIGHTS.revenuePerRoom },
      { value: subMetrics.txnPerKiosk.percentile, weight: DEFAULT_COMPOSITE_WEIGHTS.txnPerKiosk },
      { value: subMetrics.basketValue.percentile, weight: DEFAULT_COMPOSITE_WEIGHTS.basketValue },
    ]);
    const compositeRounded = Math.round(composite * 100) / 100;
    const tier = classifyOutletTier(compositeRounded, tierConfig) as Tier;

    return {
      locationId: raw.location_id,
      internalPocId: raw.internal_poc_id,
      hotelName: raw.hotel_name ?? "(no name)",
      region: raw.region_name ?? "(no region)",
      currency: raw.currency,
      totalRevenue: metrics.revenue,
      totalTransactions: metrics.transactions,
      kioskCount: Number(raw.kiosk_count),
      numRooms: raw.num_rooms === null ? null : Number(raw.num_rooms),
      subMetrics,
      compositeScore: compositeRounded,
      tier,
    };
  });

  return { rows, tierConfig, windowDays, liveStageId, weights: DEFAULT_COMPOSITE_WEIGHTS };
}

/**
 * Per-cohort percentile rank — Postgres `PERCENT_RANK()` semantics
 * (`(min_rank_among_ties - 1) / (n - 1) * 100`). Mirrors the implementation
 * in `src/lib/analytics/queries/heat-map.ts`; duplicated rather than
 * exported from there to keep the heat-map module's surface unchanged.
 *
 * NULL inputs pass through as NULL outputs. Single-element cohort returns
 * 50 (matches heat-map's "lone hotel" convention).
 */
function percentRanks(values: (number | null)[]): (number | null)[] {
  const indexed = values
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v !== null)
    .sort((a, b) => a.v - b.v);
  const n = indexed.length;
  if (n <= 1) {
    return values.map((v) => (v === null ? null : 50));
  }
  const ranks = new Array<number>(values.length);
  let currentRank = 1;
  for (let pos = 0; pos < n; pos++) {
    if (pos > 0 && indexed[pos].v !== indexed[pos - 1].v) {
      currentRank = pos + 1;
    }
    ranks[indexed[pos].i] = currentRank;
  }
  return values.map((v, i) =>
    v === null ? null : ((ranks[i] - 1) / (n - 1)) * 100,
  );
}
