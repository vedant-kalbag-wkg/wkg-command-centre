/**
 * Pivot query executor.
 *
 * Orchestrates pivot engine + shared query helpers to execute pivot queries
 * against the database. Supports optional period comparison (MoM/YoY).
 */

import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { sql } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  buildMetricModeCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationConditionForRawContext } from "@/lib/analytics/active-locations";
import { getComparisonDates } from "@/lib/analytics/metrics";
import {
  validatePivotConfig,
  buildPivotSQL,
  formatPivotResults,
} from "@/lib/analytics/pivot-engine";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import type {
  AnalyticsFilters,
  PivotConfig,
  PivotResponse,
  PivotCell,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build raw WHERE clause string for pivot queries ──────────────
// The pivot engine works with raw SQL strings (not Drizzle SQL objects) because
// it constructs queries using string interpolation with validated column names.
// We still use Drizzle helpers for filters, then serialize to a raw string.

async function buildPivotWhereString(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<string | undefined> {
  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
  // Use the raw-context variant here because this function serializes the
  // Drizzle SQL to a literal string (see loop below); the ANY($::uuid[])
  // form would stringify its single array param incorrectly, whereas the
  // IN ($1, $2, …) form yields scalar params the loop handles natively.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationConditionForRawContext(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);
  const metricModeCondition = buildMetricModeCondition(filters);

  const combined = combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    metricModeCondition,
    ...dimensionConditions,
  ]);

  if (!combined) return undefined;

  // Serialize the Drizzle SQL object to a raw string via db query builder.
  // We use sql`...`.getSQL() pattern, but since Drizzle doesn't have a simple
  // .toString(), we use the query compiler to get the raw SQL.
  //
  // NOTE: use un-aliased table name here so Drizzle emits references like
  // `"sales_records"."transaction_date"`. The pivot SQL in `pivot-engine.ts`
  // also uses un-aliased tables, so the resulting WHERE clause resolves
  // correctly against the pivot query's FROM.
  const query = db
    .select({ v: sql`1` })
    .from(sql`sales_records`)
    .where(combined)
    .toSQL();

  // Extract just the WHERE clause from the generated SQL.
  // The Drizzle output is: SELECT 1 FROM sales_records WHERE <condition>
  // We want just the <condition> part.
  const fullSql = query.sql;
  const whereIdx = fullSql.indexOf(" where ");
  if (whereIdx === -1) return undefined;

  let rawWhere = fullSql.substring(whereIdx + 7); // skip " where "

  // Replace Drizzle's $1, $2, etc. placeholders with actual parameter values.
  const params = query.params;
  for (let i = params.length; i >= 1; i--) {
    const param = params[i - 1];
    const placeholder = `$${i}`;
    const escaped =
      typeof param === "string"
        ? `'${param.replace(/'/g, "''")}'`
        : String(param);
    rawWhere = rawWhere.replaceAll(placeholder, escaped);
  }

  return rawWhere;
}

// ─── Main executor ──────────────────────────────────────────────────────────

/**
 * Execute a pivot query with the given config and filters.
 *
 * @param config  - Pivot configuration (rows, columns, values, comparison)
 * @param filters - Analytics filters (date range, dimension filters)
 * @param userCtx - Authenticated user context for scoping
 * @returns PivotResponse with headers, rows, and grand totals
 */
export async function executePivot(
  config: PivotConfig,
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<PivotResponse> {
  // 1. Validate config
  const errors = validatePivotConfig(config);
  if (errors.length > 0) {
    throw new Error(
      `Invalid pivot config: ${errors.map((e) => e.message).join("; ")}`,
    );
  }

  // 2. Build WHERE clause
  const whereClause = await buildPivotWhereString(filters, userCtx);

  // 3. Build SQL
  const pivotSQL = buildPivotSQL(config, whereClause);

  // 4. Execute query
  const rawRows = await executeRows(sql.raw(pivotSQL));

  // 5. Format results
  const result = formatPivotResults(
    rawRows as unknown as Record<string, unknown>[],
    config,
  );

  // 6. Handle period comparison
  if (config.periodComparison) {
    return await addPeriodComparison(result, config, filters, userCtx);
  }

  return result;
}

// ─── Period Comparison ──────────────────────────────────────────────────────

async function addPeriodComparison(
  currentResult: PivotResponse,
  config: PivotConfig,
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<PivotResponse> {
  const { prevFrom, prevTo } = getComparisonDates(
    filters.dateFrom,
    filters.dateTo,
    config.periodComparison!,
  );

  const prevFilters: AnalyticsFilters = {
    ...filters,
    dateFrom: prevFrom,
    dateTo: prevTo,
  };

  // Strip comparison flag to avoid infinite recursion
  const prevConfig: PivotConfig = {
    ...config,
    periodComparison: null,
  };

  const prevWhereClause = await buildPivotWhereString(prevFilters, userCtx);
  const prevSQL = buildPivotSQL(prevConfig, prevWhereClause);
  const prevRawRows = await executeRows(sql.raw(prevSQL));
  const prevResult = formatPivotResults(
    prevRawRows as unknown as Record<string, unknown>[],
    prevConfig,
  );

  // Build lookup of previous period row → cells by dimension key
  const prevRowMap = new Map<string, Record<string, PivotCell>>();
  for (const row of prevResult.rows) {
    const key = config.rowFields
      .map((f) => row.dimensions[f] ?? "")
      .join("|||");
    prevRowMap.set(key, row.cells);
  }

  // Merge change columns into current result
  const mergedRows = currentResult.rows.map((row) => {
    const key = config.rowFields
      .map((f) => row.dimensions[f] ?? "")
      .join("|||");
    const prevCells = prevRowMap.get(key);

    const changeCells: Record<string, PivotCell> = {};

    if (prevCells) {
      const curKeys = Object.keys(row.cells);
      const prevKeys = Object.keys(prevCells);

      for (let i = 0; i < curKeys.length; i++) {
        const cellKey = curKeys[i];
        const cur = row.cells[cellKey].value;

        // Try exact key match first, then positional match
        const prevCell =
          prevCells[cellKey] ??
          (prevKeys[i] ? prevCells[prevKeys[i]] : undefined);

        if (prevCell != null && prevCell.value !== 0) {
          const change = ((cur - prevCell.value) / prevCell.value) * 100;
          changeCells[`${cellKey}_change`] = {
            value: change,
            formatted: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
          };
        } else if (prevCell != null && prevCell.value === 0) {
          // Previous was zero — can't calculate meaningful %
          changeCells[`${cellKey}_change`] = {
            value: cur > 0 ? 100 : 0,
            formatted: cur > 0 ? "New" : "—",
          };
        } else {
          // No comparison data available
          changeCells[`${cellKey}_change`] = {
            value: 0,
            formatted: "—",
          };
        }
      }
    } else {
      // No matching row in previous period at all
      for (const cellKey of Object.keys(row.cells)) {
        changeCells[`${cellKey}_change`] = {
          value: 0,
          formatted: "—",
        };
      }
    }

    return {
      ...row,
      cells: { ...row.cells, ...changeCells },
    };
  });

  // Add change headers
  const changeHeaders = currentResult.headers
    .slice(config.rowFields.length)
    .map((h) => `${h} (% Change)`);

  // Add change grand totals
  const changeGrandTotals: Record<string, PivotCell> = {};
  const curTotalKeys = Object.keys(currentResult.grandTotals);
  const prevTotalKeys = Object.keys(prevResult.grandTotals);

  for (let i = 0; i < curTotalKeys.length; i++) {
    const key = curTotalKeys[i];
    const cell = currentResult.grandTotals[key];
    // Try exact key match first, then positional match
    const prevCell =
      prevResult.grandTotals[key] ??
      (prevTotalKeys[i] ? prevResult.grandTotals[prevTotalKeys[i]] : undefined);

    if (prevCell != null && prevCell.value !== 0) {
      const change = ((cell.value - prevCell.value) / prevCell.value) * 100;
      changeGrandTotals[`${key}_change`] = {
        value: change,
        formatted: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
      };
    } else if (prevCell != null && prevCell.value === 0) {
      changeGrandTotals[`${key}_change`] = {
        value: cell.value > 0 ? 100 : 0,
        formatted: cell.value > 0 ? "New" : "—",
      };
    } else {
      changeGrandTotals[`${key}_change`] = {
        value: 0,
        formatted: "—",
      };
    }
  }

  return {
    headers: [...currentResult.headers, ...changeHeaders],
    rows: mergedRows,
    grandTotals: { ...currentResult.grandTotals, ...changeGrandTotals },
    rowCount: mergedRows.length,
    truncated: currentResult.truncated,
  };
}

// ─── Cached variant (Phase 3) ───────────────────────────────────────────────
//
// Wrap executePivot with unstable_cache via wrapAnalyticsQuery.
// Cache key = ['analytics', 'executePivot', 'v1'] + JSON.stringify(canonicalFilters, scopeKey, config).
// TTL = 24h, aligned with overnight UK ETL.
// Tags: ['analytics', 'analytics:pivot-table'] — invalidate via /admin/cache.
//
// `executePivot` takes args in the unusual order `(config, filters, userCtx)`.
// `wrapAnalyticsQuery` expects `(filters, userCtx, ...rest)`, so we reorder
// internally via an un-exported shim.

async function executePivotReordered(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  config: PivotConfig,
): Promise<PivotResponse> {
  return executePivot(config, filters, userCtx);
}

export const executePivotCached = wrapAnalyticsQuery(executePivotReordered, {
  name: 'executePivot',
  tags: ['analytics', 'analytics:pivot-table'],
});

