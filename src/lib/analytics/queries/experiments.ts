import { db } from "@/db";
import { salesRecords, locations } from "@/db/schema";
import { sql, inArray, notInArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildAmountModeCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  buildSalesTxnCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { getComparisonDates } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  TemporalComparison,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

/**
 * Aggregate revenue + transactions for a specific set of location IDs,
 * respecting global filters (date range, exclusions, scoping).
 */
export async function getCohortMetrics(
  locationIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<{ revenue: number; transactions: number; avgRevenue: number }> {
  if (locationIds.length === 0) {
    return { revenue: 0, transactions: 0, avgRevenue: 0 };
  }

  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
  // No locations columns are used in SELECT, so we also drop the JOIN.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  const locationCondition = inArray(salesRecords.locationId, locationIds);

  // metricMode applied per-aggregate via FILTER (D1 — counts mode-invariant).
  const where = combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    locationCondition,
    ...dimensionConditions,
  ]);

  const rows = await db
    .select({
      // Phase 9.1 / D-11 — dual-emit native + GBP + currency_key.
      revenueNative: sql<string>`COALESCE(SUM(${salesRecords.netAmount}::numeric)     FILTER (WHERE ${amountMode}), 0)`,
      revenueGbp:    sql<string>`COALESCE(SUM(${salesRecords.netAmountGbp}::numeric) FILTER (WHERE ${amountMode}), 0)`,
      currencyKey:   sql<string | null>`CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1 THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode}) ELSE NULL END`,
      transactions:  sql<number>`COUNT(*) FILTER (WHERE ${salesTxn})::int`,
    })
    .from(salesRecords)
    .where(where);

  const row = rows[0];
  // D-12 — cohort metrics rank cross-cohort, so the public `revenue` is GBP.
  // currencyKey is materialised to support the future renderer dispatch (D-10).
  const revenue = Number(row?.revenueGbp ?? 0);
  const transactions = Number(row?.transactions ?? 0);
  const avgRevenue = transactions > 0 ? revenue / transactions : 0;

  return { revenue, transactions, avgRevenue };
}

/**
 * Aggregate revenue + transactions for ALL locations NOT in the given set,
 * i.e. the "rest of portfolio" control group.
 */
export async function getRestOfPortfolioMetrics(
  excludeLocationIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<{ revenue: number; transactions: number; avgRevenue: number }> {
  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
  // No locations columns used in SELECT — drop the JOIN.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // metricMode applied per-aggregate via FILTER (D1 — counts mode-invariant).
  const conditions: (SQL | undefined)[] = [
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    ...dimensionConditions,
  ];

  if (excludeLocationIds.length > 0) {
    conditions.push(
      sql`${salesRecords.locationId} NOT IN (${sql.join(
        excludeLocationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  const where = combineConditions(conditions);

  const rows = await db
    .select({
      // Phase 9.1 / D-11 — dual-emit native + GBP + currency_key.
      revenueNative: sql<string>`COALESCE(SUM(${salesRecords.netAmount}::numeric)     FILTER (WHERE ${amountMode}), 0)`,
      revenueGbp:    sql<string>`COALESCE(SUM(${salesRecords.netAmountGbp}::numeric) FILTER (WHERE ${amountMode}), 0)`,
      currencyKey:   sql<string | null>`CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1 THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode}) ELSE NULL END`,
      transactions:  sql<number>`COUNT(*) FILTER (WHERE ${salesTxn})::int`,
    })
    .from(salesRecords)
    .where(where);

  const row = rows[0];
  // D-12 — rest-of-portfolio comparison ranks cross-cohort, so GBP is the
  // canonical numerator. The native arm is kept for the renderer (09.1-07).
  const revenue = Number(row?.revenueGbp ?? 0);
  const transactions = Number(row?.transactions ?? 0);
  const avgRevenue = transactions > 0 ? revenue / transactions : 0;

  return { revenue, transactions, avgRevenue };
}

/**
 * Find locations similar to the cohort based on room count and revenue.
 * Returns up to 10 matched location IDs, excluding the cohort locations.
 */
export async function findSimilarLocations(
  cohortLocationIds: string[],
  userCtx: UserCtx,
  filters: AnalyticsFilters,
): Promise<string[]> {
  if (cohortLocationIds.length === 0) return [];

  // 1. Get the cohort locations' avg room count
  const cohortProfiles = await db
    .select({
      avgRooms: sql<string>`COALESCE(AVG(${locations.numRooms}), 0)`,
    })
    .from(locations)
    .where(inArray(locations.id, cohortLocationIds));

  const avgRooms = Number(cohortProfiles[0]?.avgRooms ?? 0);

  // 2. Get cohort avg revenue per location
  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);
  const dateCondition = buildDateCondition(filters);

  const cohortRevRows = await db
    .select({
      // D-11 — dual-emit; D-12 — peer-matching is intrinsically cross-currency
      // (matching against the entire portfolio). The avg-rev-per-location bound
      // for similarity must be in GBP so a EUR cohort doesn't fail to match
      // its GBP peers because of the raw-value gap. Native is materialised for
      // any future native-side similarity report.
      avgRevPerLocationNative: sql<string>`COALESCE(SUM(${salesRecords.netAmount}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0)`,
      avgRevPerLocationGbp:    sql<string>`COALESCE(SUM(${salesRecords.netAmountGbp}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0)`,
      currencyKey:             sql<string | null>`CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) = 1 THEN MIN(${salesRecords.currency}) ELSE NULL END`,
    })
    .from(salesRecords)
    .where(
      combineConditions([
        dateCondition,
        scopeCondition,
        activeLocationCondition,
        inArray(salesRecords.locationId, cohortLocationIds),
      ]),
    );

  const avgRevPerLocation = Number(cohortRevRows[0]?.avgRevPerLocationGbp ?? 0);

  // 3. Build room count bounds: ±30% or ±20 rooms, whichever is larger
  const roomMarginPct = avgRooms * 0.3;
  const roomMargin = Math.max(roomMarginPct, 20);
  const roomLow = Math.max(0, avgRooms - roomMargin);
  const roomHigh = avgRooms + roomMargin;

  // 4. Revenue bounds: ±40%
  const revLow = avgRevPerLocation * 0.6;
  const revHigh = avgRevPerLocation * 1.4;

  // 5. Find matching locations
  //
  // D-11 / D-12 — the SELECT dual-emits revenue (native + GBP + currency_key)
  // for any caller that wants the materialised columns; the HAVING that bounds
  // the similarity range has been switched to net_amount_gbp so the revLow/
  // revHigh thresholds (computed in GBP via the cohort SUM above) compare to
  // a like-for-like number. Pre-FX a EUR-only cohort matched against a USD-only
  // peer pool would exclude valid peers because raw-currency magnitudes don't
  // line up.
  const matchRows = await db
    .select({
      locationId: locations.id,
      revenueNative: sql<string>`COALESCE(SUM(${salesRecords.netAmount}::numeric),     0)`,
      revenueGbp:    sql<string>`COALESCE(SUM(${salesRecords.netAmountGbp}::numeric), 0)`,
      currencyKey:   sql<string | null>`CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) = 1 THEN MIN(${salesRecords.currency}) ELSE NULL END`,
    })
    .from(locations)
    .leftJoin(
      salesRecords,
      combineConditions([
        sql`${salesRecords.locationId} = ${locations.id}`,
        dateCondition,
        scopeCondition,
        activeLocationCondition,
      ]),
    )
    .where(
      combineConditions([
        notInArray(locations.id, cohortLocationIds),
        // §4 follow-up — exclude archived locations from peer matching.
        // Without this, cohort vs control comparisons could pick a peer
        // that has been retired and thus has no recent sales, biasing the
        // delta toward the cohort.
        sql`${locations.archivedAt} IS NULL`,
        sql`${locations.numRooms} IS NOT NULL`,
        sql`${locations.numRooms} >= ${roomLow}`,
        sql`${locations.numRooms} <= ${roomHigh}`,
      ]),
    )
    .groupBy(locations.id)
    .having(
      // D-12 — bound on GBP so revLow/revHigh (themselves GBP) are like-for-like.
      sql`COALESCE(SUM(${salesRecords.netAmountGbp}::numeric), 0) >= ${revLow} AND COALESCE(SUM(${salesRecords.netAmountGbp}::numeric), 0) <= ${revHigh}`,
    )
    .limit(10);

  return matchRows.map((r) => r.locationId);
}

/**
 * Get temporal comparison for a cohort around its intervention date.
 * Returns metrics for pre-period, during-period, and YoY equivalents.
 *
 * The `filters` argument is forwarded to every underlying `getCohortMetrics`
 * call (region / hotel-group / maturity / metricMode / etc. all flow through);
 * only `dateFrom`/`dateTo` are overridden per period.
 */
export async function getCohortTemporalComparison(
  locationIds: string[],
  interventionDate: string,
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<TemporalComparison> {
  const intervention = new Date(interventionDate);

  // Pre-period: 30 days before intervention
  const preFrom = new Date(intervention);
  preFrom.setDate(preFrom.getDate() - 30);
  const preTo = new Date(intervention);
  preTo.setDate(preTo.getDate() - 1);

  // During: intervention date to 30 days after
  const duringFrom = new Date(intervention);
  const duringTo = new Date(intervention);
  duringTo.setDate(duringTo.getDate() + 30);

  const preFromStr = preFrom.toISOString().split("T")[0];
  const preToStr = preTo.toISOString().split("T")[0];
  const duringFromStr = duringFrom.toISOString().split("T")[0];
  const duringToStr = duringTo.toISOString().split("T")[0];

  // YoY dates
  const { prevFrom: yoyPreFrom, prevTo: yoyPreTo } = getComparisonDates(
    preFromStr,
    preToStr,
    "yoy",
  );
  const { prevFrom: yoyDuringFrom, prevTo: yoyDuringTo } = getComparisonDates(
    duringFromStr,
    duringToStr,
    "yoy",
  );

  // Fetch all 4 periods in parallel
  const [pre, during, yoyPre, yoyDuring] = await Promise.all([
    getCohortMetrics(locationIds, { ...filters, dateFrom: preFromStr, dateTo: preToStr }, userCtx),
    getCohortMetrics(locationIds, { ...filters, dateFrom: duringFromStr, dateTo: duringToStr }, userCtx),
    getCohortMetrics(locationIds, { ...filters, dateFrom: yoyPreFrom, dateTo: yoyPreTo }, userCtx),
    getCohortMetrics(locationIds, { ...filters, dateFrom: yoyDuringFrom, dateTo: yoyDuringTo }, userCtx),
  ]);

  return {
    pre: {
      ...pre,
      periodLabel: "Pre (30d before)",
      dateFrom: preFromStr,
      dateTo: preToStr,
    },
    during: {
      ...during,
      periodLabel: "During (30d after)",
      dateFrom: duringFromStr,
      dateTo: duringToStr,
    },
    yoyPre: {
      ...yoyPre,
      periodLabel: "YoY Pre",
      dateFrom: yoyPreFrom,
      dateTo: yoyPreTo,
    },
    yoyDuring: {
      ...yoyDuring,
      periodLabel: "YoY During",
      dateFrom: yoyDuringFrom,
      dateTo: yoyDuringTo,
    },
  };
}
