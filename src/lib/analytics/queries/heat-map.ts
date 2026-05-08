import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations, kioskAssignments } from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  activeKioskCountFragment,
  buildAmountModeCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  buildSalesTxnCondition,
  canonicalHotelGroupNameFragment,
  combineConditions,
  kioskLiveDateSubquery,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import {
  calculateCompositeScore,
  calculateRevenuePerRoom,
  calculateTxnPerKiosk,
  calculateAvgBasketValue,
} from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  HeatMapData,
  HeatMapHotel,
  ScoreWeights,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Score Weights ──────────────────────────────────────────────────────────

const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  revenue: 0.3,
  transactions: 0.2,
  revenuePerRoom: 0.25,
  txnPerKiosk: 0.15,
  basketValue: 0.1,
};

/**
 * Accepts fraction weights summing to ~1. If input is missing, invalid, or
 * sums to zero, falls back to defaults. This is a defensive guard — the UI
 * already enforces sum=100 before submitting.
 */
function resolveWeights(input?: ScoreWeights): ScoreWeights {
  if (!input) return DEFAULT_SCORE_WEIGHTS;
  const values = [
    input.revenue,
    input.transactions,
    input.revenuePerRoom,
    input.txnPerKiosk,
    input.basketValue,
  ];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return DEFAULT_SCORE_WEIGHTS;
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return DEFAULT_SCORE_WEIGHTS;
  return input;
}

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildHeatMapWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
  // JOIN stays — heat-map SELECTs outletCode/name/numRooms — but the
  // predicate lets the planner filter sales_records on its covering index
  // before joining.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  // metricMode is applied per-aggregate via FILTER (D1 — counts mode-invariant).
  return combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

// ─── Internal: percentile rank to 0-100 ─────────────────────────────────────
//
// D7: Per-metric normalisation uses percentile rank, not min-max. This
// matches Postgres `PERCENT_RANK()` semantics — `(min_rank_among_ties - 1)
// / (n - 1)` — so tied values share the better (higher) rank. Higher is
// better for every Heat Map metric (revenue, transactions, rev/room,
// txn/kiosk, avg basket), so no inversion is needed.
//
// Computed in JS rather than SQL because two of the five metrics
// (revenuePerRoom, txnPerKiosk) are derived from a separate kiosk-count
// query and aren't available in the aggregation CTE without a larger
// restructure. Result is mathematically identical to Postgres PERCENT_RANK().
function percentRanks(values: (number | null)[]): (number | null)[] {
  // Build (originalIndex, value) pairs for non-null entries, sort by value.
  const indexed = values
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v !== null)
    .sort((a, b) => a.v - b.v);

  const n = indexed.length;
  // Singleton or empty cohort: PERCENT_RANK is undefined (division by zero).
  // Return midpoint so a lone hotel scores 50, matching the prior min-max
  // "all equal" behaviour.
  if (n <= 1) {
    return values.map((v) => (v === null ? null : 50));
  }

  // Assign each value its min-rank-among-ties (1-indexed). Walk sorted
  // pairs; whenever the value changes, the rank jumps to the current
  // position. This is the "min" tie-handling Postgres PERCENT_RANK uses.
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

// ─── Heat Map Query ─────────────────────────────────────────────────────────

export async function getHeatMapData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  weightsInput?: ScoreWeights,
): Promise<HeatMapData> {
  const SCORE_WEIGHTS = resolveWeights(weightsInput);
  const whereClause = await buildHeatMapWhere(filters, userCtx);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // 1. Query sales grouped by location
  //
  // Property-level enrichment (Phase 4.3, mirrors portfolio.ts getOutletTiers):
  //   hotel_group_name — canonical group via canonicalHotelGroupNameFragment
  //     (operating_group_id if set, else MIN(hotel_group_id) from memberships).
  //   kiosk_count — active kiosks on the property right now (unassigned_at
  //     IS NULL), used for revenue/kiosk on the tier row. This is distinct
  //     from the date-bounded kiosk count fetched below for txnPerKiosk in
  //     the composite score — that one is scoped to [dateFrom, dateTo].
  // Correlated subqueries don't need to appear in GROUP BY.
  const rows = await executeRows<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    num_rooms: string | null;
    live_date: string | null;
    hotel_group_name: string | null;
    kiosk_count: number;
    revenue: string;
    transactions: string;
    quantity: string;
  }>(sql`
    SELECT
      ${salesRecords.locationId} AS location_id,
      COALESCE(${locations.outletCode}, '') AS outlet_code,
      ${locations.name} AS hotel_name,
      ${locations.numRooms}::text AS num_rooms,
      ${kioskLiveDateSubquery}::text AS live_date,
      ${canonicalHotelGroupNameFragment()} AS hotel_group_name,
      ${activeKioskCountFragment()} AS kiosk_count,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS quantity
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${salesRecords.locationId}, ${locations.id}, ${locations.outletCode}, ${locations.name}, ${locations.numRooms}
  `);

  // Kiosk count: scoped to locations from the sales query results
  const locationIds = rows.map((r) => r.location_id);
  const kioskCountRows = locationIds.length > 0
    ? await executeRows<{
        location_id: string;
        kiosk_count: string;
      }>(sql`
        SELECT
          ${kioskAssignments.locationId} AS location_id,
          COUNT(DISTINCT ${kioskAssignments.kioskId})::text AS kiosk_count
        FROM ${kioskAssignments}
        WHERE ${inArray(kioskAssignments.locationId, locationIds)}
          AND ${kioskAssignments.assignedAt} <= ${filters.dateTo}::timestamptz
          AND (${kioskAssignments.unassignedAt} IS NULL
               OR ${kioskAssignments.unassignedAt} > ${filters.dateFrom}::timestamptz)
        GROUP BY ${kioskAssignments.locationId}
      `)
    : [];

  if (rows.length === 0) {
    return {
      topPerformers: [],
      bottomPerformers: [],
      allPerformers: [],
      scoreWeights: SCORE_WEIGHTS,
    };
  }

  // Build kiosk count lookup: locationId -> count of distinct kiosks
  const kioskCountMap = new Map<string, number>(
    kioskCountRows.map((r) => [r.location_id, Number(r.kiosk_count)]),
  );

  // 2. Calculate derived metrics per hotel
  const rawHotels = rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    const numRooms = row.num_rooms ? Number(row.num_rooms) : null;
    const kiosks = kioskCountMap.get(row.location_id) ?? null;
    // Defensive Number() — the pg driver returns ::int as a JS number already,
    // but if it ever flipped to string, undefined would silently pass the
    // `kioskCount > 0` check below and produce NaN on the divide.
    const kioskCount = Number(row.kiosk_count);
    // Null out revenue/kiosk when no kiosks are assigned — the UI renders
    // those as "—" rather than Infinity.
    const revenuePerKiosk = kioskCount > 0 ? revenue / kioskCount : null;

    return {
      locationId: row.location_id,
      outletCode: row.outlet_code,
      hotelName: row.hotel_name,
      liveDate: row.live_date,
      hotelGroupName: row.hotel_group_name,
      kioskCount,
      numRooms,
      revenue,
      transactions,
      revenuePerRoom: calculateRevenuePerRoom(revenue, numRooms),
      revenuePerKiosk,
      txnPerKiosk: calculateTxnPerKiosk(transactions, kiosks),
      avgBasketValue: calculateAvgBasketValue(revenue, transactions) ?? 0,
    };
  });

  // 3. Percentile-rank each metric over the cohort (D7).
  // Cohort = whatever survived the filter bar, which is exactly `rawHotels`.
  const normRevenueAll = percentRanks(rawHotels.map((h) => h.revenue));
  const normTxnAll = percentRanks(rawHotels.map((h) => h.transactions));
  const normRPRAll = percentRanks(rawHotels.map((h) => h.revenuePerRoom));
  const normTPKAll = percentRanks(rawHotels.map((h) => h.txnPerKiosk));
  const normABVAll = percentRanks(rawHotels.map((h) => h.avgBasketValue));

  // 4. Calculate composite scores
  const scored: (Omit<HeatMapHotel, "rank">)[] = rawHotels.map((hotel, idx) => {
    const compositeScore = calculateCompositeScore([
      { value: normRevenueAll[idx], weight: SCORE_WEIGHTS.revenue },
      { value: normTxnAll[idx], weight: SCORE_WEIGHTS.transactions },
      { value: normRPRAll[idx], weight: SCORE_WEIGHTS.revenuePerRoom },
      { value: normTPKAll[idx], weight: SCORE_WEIGHTS.txnPerKiosk },
      { value: normABVAll[idx], weight: SCORE_WEIGHTS.basketValue },
    ]);

    return {
      locationId: hotel.locationId,
      outletCode: hotel.outletCode,
      hotelName: hotel.hotelName,
      liveDate: hotel.liveDate,
      revenue: hotel.revenue,
      transactions: hotel.transactions,
      revenuePerRoom: hotel.revenuePerRoom,
      txnPerKiosk: hotel.txnPerKiosk,
      avgBasketValue: hotel.avgBasketValue,
      compositeScore: Math.round(compositeScore * 100) / 100,
      hotelGroupName: hotel.hotelGroupName,
      kioskCount: hotel.kioskCount,
      numRooms: hotel.numRooms,
      revenuePerKiosk: hotel.revenuePerKiosk,
    };
  });

  // 5. Sort by score DESC, assign ranks
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const allPerformers: HeatMapHotel[] = scored.map((hotel, idx) => ({
    ...hotel,
    rank: idx + 1,
  }));

  // 6. Return top 20, bottom 20, all
  const { top: topPerformers, bottom: bottomPerformers } = pickTopAndBottom(
    allPerformers,
    20,
  );

  return {
    topPerformers,
    bottomPerformers,
    allPerformers,
    scoreWeights: SCORE_WEIGHTS,
  };
}

// Picks the top N and bottom N from a list already sorted best→worst.
// When the list size is between N+1 and 2N, the naive `slice(-N)` overlaps with
// `slice(0, N)`. Anchoring `bottom` to start no earlier than position N
// guarantees disjoint slices for any list size while preserving the
// "no bottom shown when N or fewer total" contract.
export function pickTopAndBottom<T>(
  ranked: readonly T[],
  n: number,
): { top: T[]; bottom: T[] } {
  const top = ranked.slice(0, n);
  const bottomStart = Math.max(n, ranked.length - n);
  const bottom = ranked.slice(bottomStart).reverse();
  return { top, bottom };
}

// ─── Cached variant (Phase 3) ────────────────────────────────────────────────
//
// Wrap getHeatMapData with unstable_cache via wrapAnalyticsQuery.
// Cache key = ['analytics', 'getHeatMapData', 'v1'] + JSON.stringify(
//   canonicalFilters, scopeKey, weightsInput).
// TTL = 24h, aligned with overnight UK ETL.
// Tags: ['analytics', 'analytics:heat-map'] — invalidate via /admin/cache.
//
// Uncached export above remains callable for any non-cached code paths.

const HEAT_MAP_TAGS = ['analytics', 'analytics:heat-map'];

export const getHeatMapDataCached = wrapAnalyticsQuery(getHeatMapData, {
  name: 'getHeatMapData',
  tags: HEAT_MAP_TAGS,
});
