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

  // metricMode applied per-aggregate via FILTER on the SUM/COUNT clauses inside
  // the pivot engine (D1 — counts mode-invariant; SUM swaps fee/non-fee).
  const combined = combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
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

  return mergeComparisonResults(currentResult, prevResult, config.rowFields);
}

/**
 * Merge a previous-period PivotResponse into the current one, appending
 * `<cellKey>_change` cells that show % delta against the prev row at the
 * same dimension key.
 *
 * Exported for unit testing (Task 2.6). Pure function — no DB access. Pairs
 * current/prev cells by key, NOT by position. The previous positional
 * fallback misattributed prev-period values whenever the two periods had
 * different cell sets (e.g. a column-pivoted month present in current but
 * not prev, or different row sets between periods).
 */
export function mergeComparisonResults(
  currentResult: PivotResponse,
  prevResult: PivotResponse,
  rowFields: string[],
): PivotResponse {
  // Build lookup of previous period row → cells by dimension key.
  const prevRowMap = new Map<string, Record<string, PivotCell>>();
  for (const row of prevResult.rows) {
    const key = rowFields.map((f) => row.dimensions[f] ?? "").join("|||");
    prevRowMap.set(key, row.cells);
  }

  // Merge change columns into current result.
  const mergedRows = currentResult.rows.map((row) => {
    const key = rowFields.map((f) => row.dimensions[f] ?? "").join("|||");
    const prevCells = prevRowMap.get(key);

    const changeCells: Record<string, PivotCell> = {};

    if (prevCells) {
      for (const cellKey of Object.keys(row.cells)) {
        const cur = row.cells[cellKey].value;
        // 2.6: exact-key match only (no positional fallback).
        const prevCell = prevCells[cellKey];
        changeCells[`${cellKey}_change`] = computeChangeCell(cur, prevCell);
      }
    } else {
      // No matching row in previous period at all.
      for (const cellKey of Object.keys(row.cells)) {
        changeCells[`${cellKey}_change`] = { value: 0, formatted: "—" };
      }
    }

    return { ...row, cells: { ...row.cells, ...changeCells } };
  });

  // Add change headers.
  const changeHeaders = currentResult.headers
    .slice(rowFields.length)
    .map((h) => `${h} (% Change)`);

  // Add change grand totals (same key-match policy).
  const changeGrandTotals: Record<string, PivotCell> = {};
  for (const [key, cell] of Object.entries(currentResult.grandTotals)) {
    const prevCell = prevResult.grandTotals[key];
    changeGrandTotals[`${key}_change`] = computeChangeCell(cell.value, prevCell);
  }

  return {
    headers: [...currentResult.headers, ...changeHeaders],
    rows: mergedRows,
    grandTotals: { ...currentResult.grandTotals, ...changeGrandTotals },
    rowCount: mergedRows.length,
    truncated: currentResult.truncated,
  };
}

/** Format a single % change cell from a current value and a (possibly missing) previous cell. */
function computeChangeCell(cur: number, prevCell: PivotCell | undefined): PivotCell {
  if (prevCell == null) {
    return { value: 0, formatted: "—" };
  }
  if (prevCell.value === 0) {
    return {
      value: cur > 0 ? 100 : 0,
      formatted: cur > 0 ? "New" : "—",
    };
  }
  const change = ((cur - prevCell.value) / prevCell.value) * 100;
  return {
    value: change,
    formatted: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
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

