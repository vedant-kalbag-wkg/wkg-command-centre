import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations, kioskAssignments } from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
  kioskLiveDateSubquery,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
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

  return combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

// ─── Internal: min-max normalize to 0-100 ───────────────────────────────────

function minMaxNormalize(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  if (max === min) return 50; // all equal — midpoint
  return ((value - min) / (max - min)) * 100;
}

// ─── Heat Map Query ─────────────────────────────────────────────────────────

export async function getHeatMapData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  weightsInput?: ScoreWeights,
): Promise<HeatMapData> {
  const SCORE_WEIGHTS = resolveWeights(weightsInput);
  const whereClause = await buildHeatMapWhere(filters, userCtx);

  // 1. Query sales grouped by location
  const rows = await executeRows<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    num_rooms: string | null;
    live_date: string | null;
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
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COALESCE(SUM(${salesRecords.quantity}), 0)::text AS quantity
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

    return {
      locationId: row.location_id,
      outletCode: row.outlet_code,
      hotelName: row.hotel_name,
      liveDate: row.live_date,
      revenue,
      transactions,
      revenuePerRoom: calculateRevenuePerRoom(revenue, numRooms),
      txnPerKiosk: calculateTxnPerKiosk(transactions, kiosks),
      avgBasketValue: calculateAvgBasketValue(revenue, transactions) ?? 0,
    };
  });

  // 3. Min-max normalize each metric to 0-100
  const revenueValues = rawHotels.map((h) => h.revenue);
  const txnValues = rawHotels.map((h) => h.transactions);
  const rprValues = rawHotels.map((h) => h.revenuePerRoom).filter((v): v is number => v !== null);
  const tpkValues = rawHotels.map((h) => h.txnPerKiosk).filter((v): v is number => v !== null);
  const abvValues = rawHotels.map((h) => h.avgBasketValue);

  const minOf = (arr: number[]) => arr.reduce((a, b) => Math.min(a, b), Infinity);
  const maxOf = (arr: number[]) => arr.reduce((a, b) => Math.max(a, b), -Infinity);

  const ranges = {
    revenue: { min: minOf(revenueValues), max: maxOf(revenueValues) },
    transactions: { min: minOf(txnValues), max: maxOf(txnValues) },
    revenuePerRoom: rprValues.length > 0
      ? { min: minOf(rprValues), max: maxOf(rprValues) }
      : null,
    txnPerKiosk: tpkValues.length > 0
      ? { min: minOf(tpkValues), max: maxOf(tpkValues) }
      : null,
    basketValue: { min: minOf(abvValues), max: maxOf(abvValues) },
  };

  // 4. Calculate composite scores
  const scored: (Omit<HeatMapHotel, "rank">)[] = rawHotels.map((hotel) => {
    const normRevenue = minMaxNormalize(hotel.revenue, ranges.revenue.min, ranges.revenue.max);
    const normTxn = minMaxNormalize(hotel.transactions, ranges.transactions.min, ranges.transactions.max);
    const normRPR = ranges.revenuePerRoom
      ? minMaxNormalize(hotel.revenuePerRoom, ranges.revenuePerRoom.min, ranges.revenuePerRoom.max)
      : null;
    const normTPK = ranges.txnPerKiosk
      ? minMaxNormalize(hotel.txnPerKiosk, ranges.txnPerKiosk.min, ranges.txnPerKiosk.max)
      : null;
    const normABV = minMaxNormalize(hotel.avgBasketValue, ranges.basketValue.min, ranges.basketValue.max);

    const compositeScore = calculateCompositeScore([
      { value: normRevenue, weight: SCORE_WEIGHTS.revenue },
      { value: normTxn, weight: SCORE_WEIGHTS.transactions },
      { value: normRPR, weight: SCORE_WEIGHTS.revenuePerRoom },
      { value: normTPK, weight: SCORE_WEIGHTS.txnPerKiosk },
      { value: normABV, weight: SCORE_WEIGHTS.basketValue },
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
    };
  });

  // 5. Sort by score DESC, assign ranks
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const allPerformers: HeatMapHotel[] = scored.map((hotel, idx) => ({
    ...hotel,
    rank: idx + 1,
  }));

  // 6. Return top 20, bottom 20, all
  const topPerformers = allPerformers.slice(0, 20);
  const bottomPerformers = allPerformers.slice(-20).reverse();

  return {
    topPerformers,
    bottomPerformers: bottomPerformers.length === allPerformers.length
      ? [] // Don't duplicate if fewer than 20 total
      : bottomPerformers,
    allPerformers,
    scoreWeights: SCORE_WEIGHTS,
  };
}
