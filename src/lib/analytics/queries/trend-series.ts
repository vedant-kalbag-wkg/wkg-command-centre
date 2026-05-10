import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  businessEvents,
  eventCategories,
  locations,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
} from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import { getScopedActiveLocationIds } from "@/lib/scoping/scoped-active-locations";
import {
  buildDimensionFilters,
  buildIsFeeCondition,
  buildMaturityCondition,
  buildNonFeeCondition,
  buildSalesTxnCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { unstable_cache } from "next/cache";
import { withStats } from "@/lib/analytics/cache-stats";
import {
  INTERNAL_SCOPE_KEY,
  INTERNAL_USER_CTX,
  type CachedQueryScope,
} from "@/lib/analytics/cached-query";
import type {
  AnalyticsFilters,
  TrendMetric,
  SeriesFilters,
  TrendDataPoint,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build series-specific dimension filters ───────────────────────

function buildSeriesDimensionFilters(filters: SeriesFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.productIds?.length) {
    conditions.push(inArray(salesRecords.productId, filters.productIds));
  }
  if (filters.locationIds?.length) {
    conditions.push(inArray(salesRecords.locationId, filters.locationIds));
  }
  if (filters.hotelGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, filters.hotelGroupIds)}
      )`,
    );
  }
  if (filters.regionIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, filters.regionIds)}
      )`,
    );
  }
  if (filters.locationGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, filters.locationGroupIds)}
      )`,
    );
  }
  return conditions;
}

// ─── Internal: metric aggregation expression ─────────────────────────────────
//
// Avg-basket numerator and denominator are split out (Task 2.7) so the chart
// can compute a weighted weekly/monthly average — see `metricSelectColumns`.
//
// Phase 9.1 / D-11: every `SUM(net_amount)` site dual-emits. Trend series is a
// single-column-per-row contract (the chart reads `value`), so the public
// `metricExpression` returns the GBP arm — D-12 says cross-time aggregation
// uses GBP so a multi-currency portfolio's trend doesn't oscillate with FX.
// The native-arm sibling `metricExpressionNative` is exposed alongside for any
// future native-display surface (renderer dispatch in 09.1-07).

function avgBasketNumeratorExpr(): SQL {
  // D-12 — avg-basket numerator GBP for cross-region trend stability.
  return sql`SUM(${salesRecords.netAmountGbp}::numeric) FILTER (WHERE ${buildNonFeeCondition()})`;
}

function avgBasketNumeratorNativeExpr(): SQL {
  // D-11 — native sibling for future single-currency trend surfaces.
  return sql`SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${buildNonFeeCondition()})`;
}

function avgBasketDenominatorExpr(): SQL {
  return sql`COUNT(*) FILTER (WHERE ${buildSalesTxnCondition()})`;
}

function metricExpression(metric: TrendMetric): SQL {
  switch (metric) {
    case "revenue":
      // Customer-paid sales (D1 sales-mode "Total Sales") — non-fee only.
      // D-12: trend uses GBP-bound revenue.
      return sql`SUM(${salesRecords.netAmountGbp}::numeric) FILTER (WHERE ${buildNonFeeCondition()})`;
    case "transactions":
      // D1 mode-invariant transactions: non-fee, non-reversal.
      return sql`COUNT(*) FILTER (WHERE ${buildSalesTxnCondition()})::numeric`;
    case "avg_basket_value":
      // Avg Basket = SUM(non-fee net) / COUNT(sales txns) — see D1.
      return sql`${avgBasketNumeratorExpr()} / NULLIF(${avgBasketDenominatorExpr()}, 0)`;
    case "booking_fee":
      // Fee revenue (9991 + 9992). is_weknow_fee=true covers both post-D10.
      // D-12: trend bound to GBP.
      return sql`SUM(${salesRecords.netAmountGbp}::numeric) FILTER (WHERE ${buildIsFeeCondition()})`;
  }
}

function metricExpressionNative(metric: TrendMetric): SQL {
  // D-11 sibling — native arm of the same metric. Returned alongside the
  // GBP arm by the trend-series query so plan 09.1-07's renderer can pick
  // native for single-currency series.
  switch (metric) {
    case "revenue":
      return sql`SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${buildNonFeeCondition()})`;
    case "transactions":
      return sql`COUNT(*) FILTER (WHERE ${buildSalesTxnCondition()})::numeric`;
    case "avg_basket_value":
      return sql`${avgBasketNumeratorNativeExpr()} / NULLIF(${avgBasketDenominatorExpr()}, 0)`;
    case "booking_fee":
      return sql`SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${buildIsFeeCondition()})`;
  }
}

function currencyKeyExpr(): SQL {
  // D-11 — single-currency-cohort key per row group. Trend series buckets by
  // transaction_date, so a single-day single-region series will resolve to
  // that region's currency; mixed-region or daily-mix days resolve to NULL.
  return sql`CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) = 1
                  THEN MIN(${salesRecords.currency})
                  ELSE NULL END`;
}

// ─── Main Query ──────────────────────────────────────────────────────────────

export async function getTrendSeriesData(
  metric: TrendMetric,
  seriesFilters: SeriesFilters,
  globalFilters: AnalyticsFilters,
  dateFrom: string,
  dateTo: string,
  userCtx: UserCtx,
): Promise<TrendDataPoint[]> {
  // Phase 1 #6: `buildActiveLocationCondition` replaces the old
  // `buildExclusionCondition` + INNER JOIN locations. Dropping the JOIN keeps
  // this query on the sales_records covering index alone.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = sql`${salesRecords.transactionDate} >= ${dateFrom} AND ${salesRecords.transactionDate} <= ${dateTo}`;
  const seriesConditions = buildSeriesDimensionFilters(seriesFilters);
  // Global FilterBar dimensions intersect with per-series filters (PR-18c).
  // metricMode is intentionally not threaded — trend metrics carry their own
  // per-metric FILTER (revenue=non-fee, booking_fee=fee).
  const globalDimensionConditions = buildDimensionFilters(globalFilters);
  const globalMaturityCondition = buildMaturityCondition(globalFilters);

  const whereClause = combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    ...seriesConditions,
    ...globalDimensionConditions,
    globalMaturityCondition,
  ]);

  // For `avg_basket_value` we also project the per-day numerator (non-fee
  // revenue) and denominator (sales-txn count). The chart re-weights these
  // when bucketing into weekly/monthly granularity (Task 2.7) — without it,
  // SUM-ing daily means produced wildly inflated values (£600 vs £15.62 in
  // live UAT).
  if (metric === "avg_basket_value") {
    const rows = await executeRows<{
      date: string;
      value: string;
      value_native: string;
      currency_key: string | null;
      numerator: string;
      denominator: string;
    }>(sql`
      SELECT
        ${salesRecords.transactionDate}::text AS date,
        -- D-12: public value reads GBP arm; native + currency_key materialised
        -- for renderer dispatch (09.1-07). The numerator/denominator pair
        -- continues to feed weekly/monthly weighted re-aggregation.
        COALESCE(${avgBasketNumeratorExpr()}       / NULLIF(${avgBasketDenominatorExpr()}, 0), 0) AS value,
        COALESCE(${avgBasketNumeratorNativeExpr()} / NULLIF(${avgBasketDenominatorExpr()}, 0), 0) AS value_native,
        ${currencyKeyExpr()} AS currency_key,
        COALESCE(${avgBasketNumeratorExpr()}, 0) AS numerator,
        COALESCE(${avgBasketDenominatorExpr()}, 0) AS denominator
      FROM ${salesRecords}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${salesRecords.transactionDate}
      ORDER BY ${salesRecords.transactionDate} ASC
    `);

    return rows.map((row) => ({
      date: row.date,
      // D-12 — public `value` is GBP-bound; renderer in 09.1-07 reads
      // value_native + currency_key to surface native for single-currency days.
      value: Number(row.value),
      numerator: Number(row.numerator),
      denominator: Number(row.denominator),
    }));
  }

  const rows = await executeRows<{
    date: string;
    value: string;
    value_native: string;
    currency_key: string | null;
  }>(sql`
    SELECT
      ${salesRecords.transactionDate}::text AS date,
      -- D-11 dual-emit: GBP-bound public value + native sibling + currency_key.
      COALESCE(${metricExpression(metric)},       0) AS value,
      COALESCE(${metricExpressionNative(metric)}, 0) AS value_native,
      ${currencyKeyExpr()} AS currency_key
    FROM ${salesRecords}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${salesRecords.transactionDate}
    ORDER BY ${salesRecords.transactionDate} ASC
  `);

  return rows.map((row) => ({
    date: row.date,
    // D-12 — trend chart line is GBP for cross-currency stability.
    value: Number(row.value),
  }));
}

// ─── Business Events Query ───────────────────────────────────────────────────

// Task 4.17 — locations.id-anchored dimension predicates for the
// effective-locations subquery in getBusinessEvents. Mirrors the membership
// join shape of `buildDimensionFilters` but flips the LHS to `locations.id`
// (the sales-records-anchored helper isn't usable here because the events
// visibility check operates over the location universe, not over rows in
// `sales_records`).
function buildEffectiveLocationsPredicate(filters: AnalyticsFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.hotelIds?.length) {
    conditions.push(inArray(locations.id, filters.hotelIds));
  }
  if (filters.hotelGroupIds?.length) {
    conditions.push(
      sql`${locations.id} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, filters.hotelGroupIds)}
      )`,
    );
  }
  if (filters.regionIds?.length) {
    conditions.push(
      sql`${locations.id} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, filters.regionIds)}
      )`,
    );
  }
  if (filters.locationGroupIds?.length) {
    conditions.push(
      sql`${locations.id} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, filters.locationGroupIds)}
      )`,
    );
  }
  if (filters.locationTypes?.length) {
    conditions.push(inArray(locations.locationType, filters.locationTypes));
  }
  if (!filters.includeInternalAccounts) {
    conditions.push(sql`${locations.locationType} IS DISTINCT FROM 'internal'`);
  }
  return conditions;
}

/**
 * Hierarchical visibility filter for business events (Task 4.17).
 *
 * An event is visible to the user iff one of:
 *   - scope_type='global' (always visible)
 *   - scope_type='hotel' AND scope_value is in the user's effective set
 *   - scope_type='region' AND any location in that region is in the
 *     effective set
 *   - scope_type='hotel_group' AND any location in that group is in the
 *     effective set
 *
 * The "effective set" is the user's scoped, active locations further
 * restricted by any dimension filters on the global FilterBar. When no
 * filters are set, the effective set is every scoped active location, so
 * every event with at least one matching location remains visible.
 *
 * The events table is small (≤ a few hundred rows in prod), so the four
 * scope branches each running an EXISTS / IN over a per-request
 * effective-locations CTE is fine — index hits dominate.
 */
export async function getBusinessEvents(
  dateFrom: string,
  dateTo: string,
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<BusinessEventDisplay[]> {
  const scopedActiveIds = await getScopedActiveLocationIds(userCtx);
  // No locations in scope → no events can satisfy any non-global predicate;
  // global events still pass through, so we fall through with an effective
  // set of `FALSE` and let the SQL handle it uniformly.
  const effectivePredicates = buildEffectiveLocationsPredicate(filters);
  const scopedActiveCondition =
    scopedActiveIds.length === 0
      ? sql`FALSE`
      : sql`${locations.id} = ANY(${sql.param(scopedActiveIds)}::uuid[])`;
  const effectiveWhere = combineConditions([
    scopedActiveCondition,
    ...effectivePredicates,
  ]);

  // CTE: effective_locations — the location set the user can "see" right
  // now. Reused across all three non-global scope branches below.
  const effectiveLocationsCte = sql`
    WITH effective_locations AS (
      SELECT ${locations.id} AS id
      FROM ${locations}
      WHERE ${effectiveWhere ?? sql`TRUE`}
    )
  `;

  const visibilityPredicate = sql`(
    ${businessEvents.scopeType} = 'global'
    OR (
      ${businessEvents.scopeType} = 'hotel'
      AND ${businessEvents.scopeValue}::uuid IN (SELECT id FROM effective_locations)
    )
    OR (
      ${businessEvents.scopeType} = 'region'
      AND EXISTS (
        SELECT 1 FROM ${locationRegionMemberships}
        WHERE ${locationRegionMemberships.regionId} = ${businessEvents.scopeValue}::uuid
          AND ${locationRegionMemberships.locationId} IN (SELECT id FROM effective_locations)
      )
    )
    OR (
      ${businessEvents.scopeType} = 'hotel_group'
      AND EXISTS (
        SELECT 1 FROM ${locationHotelGroupMemberships}
        WHERE ${locationHotelGroupMemberships.hotelGroupId} = ${businessEvents.scopeValue}::uuid
          AND ${locationHotelGroupMemberships.locationId} IN (SELECT id FROM effective_locations)
      )
    )
  )`;

  const rows = await executeRows<{
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    category_id: string;
    category_name: string;
    category_color: string;
    scope_type: string | null;
    scope_value: string | null;
  }>(sql`
    ${effectiveLocationsCte}
    SELECT
      ${businessEvents.id}::text AS id,
      ${businessEvents.title} AS title,
      ${businessEvents.description} AS description,
      ${businessEvents.startDate}::text AS start_date,
      ${businessEvents.endDate}::text AS end_date,
      ${businessEvents.categoryId}::text AS category_id,
      ${eventCategories.name} AS category_name,
      ${eventCategories.color} AS category_color,
      ${businessEvents.scopeType} AS scope_type,
      ${businessEvents.scopeValue} AS scope_value
    FROM ${businessEvents}
      INNER JOIN ${eventCategories} ON ${businessEvents.categoryId} = ${eventCategories.id}
    WHERE ${businessEvents.startDate} <= ${dateTo}
      AND (${businessEvents.endDate} IS NULL OR ${businessEvents.endDate} >= ${dateFrom})
      AND ${visibilityPredicate}
    ORDER BY ${businessEvents.startDate} ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    scopeType: (row.scope_type ?? "global") as BusinessEventDisplay["scopeType"],
    scopeValue: row.scope_value,
  }));
}

// ─── Cached variants (Phase 3) ───────────────────────────────────────────────
//
// trend-series has two queries with non-standard shapes that don't fit
// wrapAnalyticsQuery (which assumes `(AnalyticsFilters, UserCtx, ...rest)`):
//
//   getTrendSeriesData: `(metric, SeriesFilters, dateFrom, dateTo, userCtx)`
//   getBusinessEvents:  `(dateFrom, dateTo, filters, userCtx)` — D9-scoped via
//                       buildEffectiveLocationsPredicate; cached with the same
//                       canonicalised filter signature + scopeKey shape as
//                       getTrendSeriesData so different filter contexts cache
//                       separately. Scope participation is mandatory now —
//                       previously this fn was scope-free and returned every
//                       event in the date range regardless of user filters
//                       (PR-29 / Task 4.17).
//
// Both wrap directly with unstable_cache + withStats. Scope participates in
// each cache key via scopeKey, collapsing internal users while isolating
// external scopes.
//
// TTL = 24h, aligned with overnight UK ETL.
// Tags: ['analytics', 'analytics:trend-builder'] — invalidate via /admin/cache.

const TREND_BUILDER_TAGS = ['analytics', 'analytics:trend-builder'];

// Normalise SeriesFilters before hashing so equivalent selections collapse to
// one cache entry. Without this `['a','b']` and `['b','a']` fragment.
function canonicaliseSeriesFilters(f: SeriesFilters): SeriesFilters {
  const sortedUnique = (xs: string[] | undefined): string[] | undefined => {
    if (!xs || xs.length === 0) return undefined;
    const out = [...new Set(xs)].sort();
    return out.length > 0 ? out : undefined;
  };
  return {
    productIds: sortedUnique(f.productIds),
    locationIds: sortedUnique(f.locationIds),
    hotelGroupIds: sortedUnique(f.hotelGroupIds),
    regionIds: sortedUnique(f.regionIds),
    locationGroupIds: sortedUnique(f.locationGroupIds),
  };
}

// Same idea for the global FilterBar shape. metricMode is stripped because
// trend metrics aren't mode-aware (see getTrendSeriesData), so two requests
// differing only in metricMode must collide on the cache key. dateFrom/dateTo
// are also dropped — the per-series query has always owned its own date range
// (passed positionally), so the global bar's range is irrelevant to the SQL.
function canonicaliseGlobalFilters(g: AnalyticsFilters): Partial<AnalyticsFilters> {
  const sortedUnique = (xs: string[] | undefined): string[] | undefined => {
    if (!xs || xs.length === 0) return undefined;
    const out = [...new Set(xs)].sort();
    return out.length > 0 ? out : undefined;
  };
  return {
    hotelIds: sortedUnique(g.hotelIds),
    regionIds: sortedUnique(g.regionIds),
    productIds: sortedUnique(g.productIds),
    hotelGroupIds: sortedUnique(g.hotelGroupIds),
    locationGroupIds: sortedUnique(g.locationGroupIds),
    maturityBuckets: sortedUnique(g.maturityBuckets),
    locationTypes: g.locationTypes && g.locationTypes.length > 0
      ? ([...new Set(g.locationTypes)].sort() as AnalyticsFilters["locationTypes"])
      : undefined,
  };
}

export const getTrendSeriesDataCached = unstable_cache(
  withStats(
    'getTrendSeriesData',
    async (
      metric: TrendMetric,
      seriesFilters: SeriesFilters,
      globalFilters: AnalyticsFilters,
      dateFrom: string,
      dateTo: string,
      scopeKey: CachedQueryScope,
    ): Promise<TrendDataPoint[]> => {
      if (scopeKey !== INTERNAL_SCOPE_KEY) {
        throw new Error(`getTrendSeriesData: external scope not yet supported (got ${scopeKey})`);
      }
      const canonicalSeries = canonicaliseSeriesFilters(seriesFilters);
      // Anchor maturity buckets to the per-series query window's end (dateTo
      // arg) — the per-series window supersedes the global bar's range, so
      // bucket boundaries must be relative to the actual analysis window.
      const canonicalGlobal: AnalyticsFilters = {
        ...canonicaliseGlobalFilters(globalFilters),
        dateFrom,
        dateTo,
      };
      return getTrendSeriesData(metric, canonicalSeries, canonicalGlobal, dateFrom, dateTo, INTERNAL_USER_CTX);
    },
  ),
  // v2 — global filters now part of cache key (PR-18c)
  ['analytics', 'getTrendSeriesData', 'v2'],
  { revalidate: 86400, tags: TREND_BUILDER_TAGS },
);

// v2 — getBusinessEvents now applies hierarchical scope-type visibility
// (Task 4.17). The filter signature participates in the cache key so two
// distinct filter contexts cache independently.
export const getBusinessEventsCached = unstable_cache(
  withStats(
    'getBusinessEvents',
    async (
      dateFrom: string,
      dateTo: string,
      filters: AnalyticsFilters,
      scopeKey: CachedQueryScope,
    ): Promise<BusinessEventDisplay[]> => {
      if (scopeKey !== INTERNAL_SCOPE_KEY) {
        throw new Error(`getBusinessEvents: external scope not yet supported (got ${scopeKey})`);
      }
      // Strip product/maturity/dateFrom/dateTo from the filter — events
      // visibility doesn't depend on them, so different values must collide
      // on the cache key. Reuse the same canonicaliser as trend-series.
      const canonicalGlobal: AnalyticsFilters = {
        ...canonicaliseGlobalFilters(filters),
        dateFrom,
        dateTo,
      };
      return getBusinessEvents(dateFrom, dateTo, canonicalGlobal, INTERNAL_USER_CTX);
    },
  ),
  ['analytics', 'getBusinessEvents', 'v2'],
  { revalidate: 86400, tags: TREND_BUILDER_TAGS },
);
