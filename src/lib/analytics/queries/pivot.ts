/**
 * Pivot query executor.
 *
 * Orchestrates pivot engine + shared query helpers to execute pivot queries
 * against the database. Supports optional period comparison (MoM/YoY).
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { getComparisonDates } from "@/lib/analytics/metrics";
import {
  validatePivotConfig,
  buildPivotSQL,
  formatPivotResults,
} from "@/lib/analytics/pivot-engine";
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
  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  const combined = combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
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
  const rawRows = await db.execute(sql.raw(pivotSQL));

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
  const prevRawRows = await db.execute(sql.raw(prevSQL));
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

