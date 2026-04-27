/**
 * Pivot Engine — builds parameterized SQL for crosstab pivot queries.
 *
 * Adapted from data-dashboard's pivot engine for kiosk-tool schema:
 *   - sales_records (sr), locations (l), products (p) as table aliases
 *   - Column allowlist maps logical names → qualified SQL expressions
 *   - Derived group columns (sale_month, sale_year, sale_hour) via SQL functions
 *
 * Exports:
 *   - validatePivotConfig  — validates dimensions + metrics against allowlist
 *   - buildPivotSQL        — builds parameterized SQL string
 *   - formatPivotResults   — transforms flat rows → PivotResponse
 *   - buildPivotData       — crosstab pivot builder (row × column matrix)
 */

import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type {
  PivotConfig,
  PivotValueConfig,
  PivotAggregation,
  PivotResponse,
  PivotRow,
  PivotCell,
} from "@/lib/analytics/types";

// ─── Column Allowlists ──────────────────────────────────────────────────────

/**
 * Raw-SQL form of `buildIsFeeCondition()` (queries/shared.ts). Pivot builds
 * raw SQL strings (not Drizzle SQL objects), so we inline the predicate here.
 * MUST stay in lockstep with `buildIsFeeCondition()` — both must match the
 * same fee rows (9991 Booking Fee + 9992 Cash Handling Fee), otherwise a
 * pivot total and a trend total over the same range will diverge.
 */
const IS_FEE_RAW_SQL = "sales_records.is_weknow_fee = true";

/**
 * Raw-SQL form of `buildSalesTxnCondition()` — D1's "real customer transaction"
 * predicate (non-fee AND non-reversal). Used to scope Pivot's COUNT aggregation
 * so the "Transactions" metric matches the rest of the analytics surface.
 */
const IS_SALES_TXN_RAW_SQL =
  "sales_records.is_weknow_fee = false AND sales_records.is_reversal = false";

/**
 * Maps logical column names to qualified SQL expressions.
 *
 * IMPORTANT: These use fully-qualified table names (NOT aliases) because the
 * WHERE clause is built by shared Drizzle helpers in `queries/shared.ts` which
 * emit references like `"sales_records"."transaction_date"`. Mixing aliases
 * in the FROM/SELECT with full table names in the WHERE triggers Postgres
 * error 42P01 ("invalid reference to FROM-clause entry"). Keeping both sides
 * un-aliased avoids that mismatch.
 */
export const ALLOWED_COLUMNS = new Map<string, string>([
  ["product_name", "products.name"],
  ["outlet_code", "locations.outlet_code"],
  ["hotel_name", "locations.name"],
  // Denormalised text columns on `locations`; see migration 0022.
  ["hotel_group", "locations.hotel_group"],
  ["location_group", "locations.location_group"],
  // `net_amount` is the universal value column; `booking_fee` isolates fee-row
  // revenue (9991 + 9992) using IS_FEE_RAW_SQL — see migration 0022.
  ["net_amount", "sales_records.net_amount::numeric"],
  ["booking_fee", `(CASE WHEN ${IS_FEE_RAW_SQL} THEN sales_records.net_amount::numeric ELSE 0 END)`],
]);

/**
 * Derived group columns that require SQL expressions (not simple column refs).
 *
 * D6 / Task 2.12: `sale_hour` is now timezone-aware. The expression is built
 * lazily by `derivedGroupColumns(displayTz)` so the target zone (per-row
 * `locations.iana_timezone` for `'local'` mode, constant `'UTC'` for the
 * debug mode) can be wired in at SQL build time. We keep the static map
 * exported for any consumer that just needs the legacy UTC form (and tests
 * that pin the pre-D6 contract for `sale_month` / `sale_year`).
 */
export const DERIVED_GROUP_COLUMNS = new Map<string, string>([
  ["sale_month", "TO_CHAR(sales_records.transaction_date, 'Mon YYYY')"],
  ["sale_year", "EXTRACT(YEAR FROM sales_records.transaction_date)::TEXT"],
  ["sale_hour", "EXTRACT(HOUR FROM sales_records.transaction_time)::TEXT"],
]);

export type PivotDisplayTimezone = "local" | "utc";

/**
 * Build the derived-column map for a given display-timezone mode. Same shape
 * as `DERIVED_GROUP_COLUMNS` but with the `sale_hour` expression rewritten to
 * the AT-TIME-ZONE form documented on `getHourlyDistribution`.
 *
 * `'utc'` reproduces the pre-D6 naïve behaviour (modulo the `(date + time)`
 * reconstruction, which is a no-op semantically since both sides land in
 * UTC). `'local'` is the default: each row buckets by
 * `locations.iana_timezone`, the per-property zone seeded by migration 0033.
 */
export function derivedGroupColumns(
  displayTz: PivotDisplayTimezone = "local",
): Map<string, string> {
  const targetZoneSql =
    displayTz === "utc" ? "'UTC'" : "locations.iana_timezone";
  const saleHourExpr =
    `EXTRACT(HOUR FROM ` +
    `((sales_records.transaction_date + sales_records.transaction_time) AT TIME ZONE 'UTC') ` +
    `AT TIME ZONE ${targetZoneSql})::TEXT`;
  return new Map<string, string>([
    ["sale_month", "TO_CHAR(sales_records.transaction_date, 'Mon YYYY')"],
    ["sale_year", "EXTRACT(YEAR FROM sales_records.transaction_date)::TEXT"],
    ["sale_hour", saleHourExpr],
  ]);
}

/** All columns that can appear as dimension fields (GROUP BY targets). */
const DIMENSION_COLUMNS = new Set([
  "product_name",
  "outlet_code",
  "hotel_name",
  "hotel_group",
  "location_group",
  "sale_month",
  "sale_year",
  "sale_hour",
]);

/** Columns that can appear as value/metric fields (aggregation targets). */
const METRIC_COLUMNS = new Set([
  "net_amount",
  "booking_fee",
]);

const VALID_AGGREGATIONS = new Set<PivotAggregation>([
  "sum",
  "avg",
  "count",
  "min",
  "max",
]);

const MAX_ROWS = 10_000;

// ─── Validation ─────────────────────────────────────────────────────────────

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Validates a PivotConfig against the column allowlist.
 * Returns an array of errors (empty = valid).
 */
export function validatePivotConfig(config: PivotConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Must have at least one value
  if (!config.values || config.values.length === 0) {
    errors.push({ field: "values", message: "At least one value/metric is required" });
  }

  // Validate row fields
  for (const field of config.rowFields) {
    if (!DIMENSION_COLUMNS.has(field)) {
      errors.push({
        field: "rowFields",
        message: `Unknown or disallowed row field: ${field}`,
      });
    }
  }

  // Validate column fields
  for (const field of config.columnFields) {
    if (!DIMENSION_COLUMNS.has(field)) {
      errors.push({
        field: "columnFields",
        message: `Unknown or disallowed column field: ${field}`,
      });
    }
  }

  // Validate value configs
  for (const v of config.values ?? []) {
    if (!METRIC_COLUMNS.has(v.field)) {
      errors.push({
        field: "values",
        message: `Unknown or disallowed value field: ${v.field}`,
      });
    }
    if (!VALID_AGGREGATIONS.has(v.aggregation)) {
      errors.push({
        field: "values",
        message: `Invalid aggregation: ${v.aggregation}`,
      });
    }
  }

  // No overlap between row and column fields
  const rowSet = new Set(config.rowFields);
  for (const col of config.columnFields) {
    if (rowSet.has(col)) {
      errors.push({
        field: "columnFields",
        message: `Field "${col}" cannot appear in both rows and columns`,
      });
    }
  }

  return errors;
}

// ─── SQL Builder ────────────────────────────────────────────────────────────

/**
 * Resolves a logical field name to a SQL expression string.
 * Checks ALLOWED_COLUMNS first, then the derived-group map for the active
 * display-timezone mode (D6 / Task 2.12 — `sale_hour` is zone-aware).
 */
function resolveColumn(
  field: string,
  derived: Map<string, string>,
): string | null {
  return ALLOWED_COLUMNS.get(field) ?? derived.get(field) ?? null;
}

// 2.4 — Companion-column aliases for AVG. Carried in raw rows so grand totals
// can recompute SUM(sums)/SUM(counts) instead of mean-of-per-row-means.
// Prefixed with `__` to flag them as engine-internal (never headers/cells).
function avgSumAlias(field: string): string {
  return `__avg_sum_${field}`;
}

function avgCountAlias(field: string): string {
  return `__avg_count_${field}`;
}

/**
 * Cell-key composer for crosstab pivot.
 *
 * Both `buildPivotData` and `formatPivotResults` (grand totals) need to agree
 * on how cells are keyed when columnFields are present, otherwise the grand
 * total cell never resolves and the UI renders "—" (Task 2.5).
 *
 * - 1 value config:    key = colKey
 * - 2+ value configs:  key = `${colKey} | ${alias}`
 */
function pivotCellKey(colKey: string, alias: string, valueCount: number): string {
  return valueCount > 1 ? `${colKey} | ${alias}` : colKey;
}

/**
 * Builds a SQL query string for the pivot config.
 *
 * @param config  - The validated pivot configuration
 * @param whereClause - Optional raw SQL WHERE clause (without "WHERE" keyword)
 * @param displayTz - D6 display-timezone mode for `sale_hour` (default 'local')
 * @returns SQL query string
 */
export function buildPivotSQL(
  config: PivotConfig,
  whereClause?: string,
  displayTz: PivotDisplayTimezone = "local",
): string {
  const derived = derivedGroupColumns(displayTz);
  const allGroupFields = [...config.rowFields, ...config.columnFields];

  // SELECT: dimension columns + aggregated value columns
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  for (const field of allGroupFields) {
    const expr = resolveColumn(field, derived);
    if (!expr) continue;
    selectParts.push(`${expr} AS "${field}"`);
    groupByParts.push(expr);
  }

  // Value aggregations
  for (const v of config.values) {
    const expr = resolveColumn(v.field, derived);
    if (!expr) continue;
    const alias = `${v.aggregation}_${v.field}`;
    if (v.aggregation === "count") {
      // D1: "Transactions" count is non-fee + non-reversal (same predicate
      // as buildSalesTxnCondition in queries/shared.ts).
      selectParts.push(
        `COUNT(${expr}) FILTER (WHERE ${IS_SALES_TXN_RAW_SQL})::numeric AS "${alias}"`,
      );
    } else {
      selectParts.push(
        `${v.aggregation.toUpperCase()}(COALESCE(${expr}, 0)) AS "${alias}"`,
      );
    }

    // 2.4 Simpson's-paradox fix: for AVG, also project the underlying SUM
    // and COUNT so grand-total avg can be recomputed as SUM(sums)/SUM(counts)
    // across rows instead of mean-of-per-row-means. These companion columns
    // are consumed only by formatPivotResults; they are not exposed as
    // headers or cells.
    if (v.aggregation === "avg") {
      selectParts.push(
        `SUM(COALESCE(${expr}, 0)) AS "${avgSumAlias(v.field)}"`,
      );
      selectParts.push(
        `COUNT(${expr}) AS "${avgCountAlias(v.field)}"`,
      );
    }
  }

  // FROM with JOINs (always join locations + products).
  // Uses un-aliased table names so that the WHERE clause built by shared
  // Drizzle helpers (which reference e.g. "sales_records"."transaction_date")
  // resolves correctly. See ALLOWED_COLUMNS comment above.
  const fromClause = [
    "sales_records",
    "INNER JOIN locations ON sales_records.location_id = locations.id",
    "INNER JOIN products ON sales_records.product_id = products.id",
  ].join("\n    ");

  // WHERE
  const wherePart = whereClause ? `WHERE ${whereClause}` : "";

  // GROUP BY
  const groupPart =
    groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(", ")}` : "";

  // ORDER BY (dimension columns in order)
  const orderPart =
    groupByParts.length > 0 ? `ORDER BY ${groupByParts.join(", ")}` : "";

  return [
    `SELECT`,
    `    ${selectParts.join(",\n    ")}`,
    `FROM ${fromClause}`,
    wherePart,
    groupPart,
    orderPart,
    `LIMIT ${MAX_ROWS + 1}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Formats a numeric value into a display cell. */
function formatCell(value: number, field: string, agg: PivotAggregation): PivotCell {
  const isCurrency = field === "net_amount" || field === "booking_fee";

  let formatted: string;
  if (agg === "count") {
    formatted = formatNumber(value, 0);
  } else if (isCurrency) {
    formatted = formatCurrency(value);
  } else {
    formatted = formatNumber(value, agg === "avg" ? 2 : 0);
  }

  return { value, formatted };
}

/**
 * Builds a crosstab (row x column) pivot from flat query result rows.
 *
 * @param rawRows      - Flat rows from the SQL query
 * @param rowFields    - Fields used as row dimensions
 * @param columnFields - Fields used as column dimensions
 * @param values       - Value configs (field + aggregation)
 * @returns Array of PivotRow objects with dimension labels + cell values
 */
export function buildPivotData(
  rawRows: Record<string, unknown>[],
  rowFields: string[],
  columnFields: string[],
  values: PivotValueConfig[],
): PivotRow[] {
  if (columnFields.length === 0) {
    // No column pivoting — each raw row becomes a PivotRow
    return rawRows.map((raw) => {
      const dimensions: Record<string, string> = {};
      for (const f of rowFields) {
        dimensions[f] = String(raw[f] ?? "");
      }

      const cells: Record<string, PivotCell> = {};
      for (const v of values) {
        const alias = `${v.aggregation}_${v.field}`;
        const val = Number(raw[alias] ?? 0);
        cells[alias] = formatCell(val, v.field, v.aggregation);
      }

      return { dimensions, cells };
    });
  }

  // With column pivoting, group raw rows by row-key, then spread column values
  const rowMap = new Map<string, PivotRow>();

  for (const raw of rawRows) {
    // Build row key from row dimension values
    const rowKey = rowFields.map((f) => String(raw[f] ?? "")).join("|||");

    if (!rowMap.has(rowKey)) {
      const dimensions: Record<string, string> = {};
      for (const f of rowFields) {
        dimensions[f] = String(raw[f] ?? "");
      }
      rowMap.set(rowKey, { dimensions, cells: {} });
    }

    const pivotRow = rowMap.get(rowKey)!;

    // Build column key from column dimension values
    const colKey = columnFields.map((f) => String(raw[f] ?? "")).join(" | ");

    for (const v of values) {
      const alias = `${v.aggregation}_${v.field}`;
      const val = Number(raw[alias] ?? 0);
      // Cell key includes column dimension for crosstab layout
      const cellKey = pivotCellKey(colKey, alias, values.length);
      pivotRow.cells[cellKey] = formatCell(val, v.field, v.aggregation);
    }
  }

  return Array.from(rowMap.values());
}

/**
 * Transforms flat SQL result rows into a fully-formed PivotResponse.
 *
 * @param rawRows - Flat rows from db.execute
 * @param config  - The pivot configuration
 * @returns PivotResponse with headers, pivoted rows, and grand totals
 */
export function formatPivotResults(
  rawRows: Record<string, unknown>[],
  config: PivotConfig,
): PivotResponse {
  const truncated = rawRows.length > MAX_ROWS;
  const trimmed = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows;

  // Build pivot rows
  const rows = buildPivotData(
    trimmed,
    config.rowFields,
    config.columnFields,
    config.values,
  );

  // Compute headers
  const headers: string[] = [];

  // Row dimension headers
  for (const f of config.rowFields) {
    headers.push(dimensionLabel(f));
  }

  if (config.columnFields.length === 0) {
    // No column pivoting — value headers are just aggregation labels
    for (const v of config.values) {
      headers.push(valueLabel(v));
    }
  } else {
    // Column pivoting — collect unique column keys from built rows
    const colKeys = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.cells)) {
        colKeys.add(key);
      }
    }
    for (const key of colKeys) {
      headers.push(key);
    }
  }

  // Grand totals — aggregate across raw rows.
  //
  // Two correctness fixes baked in here:
  //   2.4 (Simpson's paradox): for `avg`, recompute as
  //        SUM(per-row sum) / SUM(per-row count)
  //        using the __avg_sum_<field> / __avg_count_<field> companions
  //        projected by buildPivotSQL. Falling back to mean-of-means would
  //        weight a 5-txn row equally with a 1000-txn row.
  //   2.5 (column-pivot key alignment): when columnFields are present, keys
  //        must mirror buildPivotData's `pivotCellKey(colKey, alias, n)` so
  //        the UI can find each grand-total cell. The previous code keyed
  //        only by `${aggregation}_${field}`, which never matches a
  //        crosstab cell key → every grand-total cell rendered as "—".
  const grandTotals: Record<string, PivotCell> = {};

  if (config.columnFields.length === 0) {
    // No column pivoting — one grand total per value config.
    for (const v of config.values) {
      const alias = `${v.aggregation}_${v.field}`;
      const nums = trimmed.map((r) => Number(r[alias] ?? 0));
      const total = aggregateGrandTotal(v, trimmed, nums);
      grandTotals[alias] = formatCell(total, v.field, v.aggregation);
    }
  } else {
    // Column pivoting — bucket raw rows by their column-key, then compute
    // a grand total per (column-key, value) pair using cell keys that match
    // buildPivotData's `pivotCellKey`.
    const buckets = new Map<string, Record<string, unknown>[]>();
    for (const raw of trimmed) {
      const colKey = config.columnFields
        .map((f) => String(raw[f] ?? ""))
        .join(" | ");
      const bucket = buckets.get(colKey);
      if (bucket) bucket.push(raw);
      else buckets.set(colKey, [raw]);
    }

    for (const [colKey, bucketRows] of buckets) {
      for (const v of config.values) {
        const alias = `${v.aggregation}_${v.field}`;
        const nums = bucketRows.map((r) => Number(r[alias] ?? 0));
        const total = aggregateGrandTotal(v, bucketRows, nums);
        const cellKey = pivotCellKey(colKey, alias, config.values.length);
        grandTotals[cellKey] = formatCell(total, v.field, v.aggregation);
      }
    }
  }

  return {
    headers,
    rows,
    grandTotals,
    rowCount: rows.length,
    truncated,
  };
}

/**
 * Compute a grand-total scalar for a single (value-config × row-set).
 * Pulled out so the with-column-pivot and without-column-pivot paths in
 * formatPivotResults stay identical w.r.t. avg / sum / count / min / max
 * semantics.
 */
function aggregateGrandTotal(
  v: PivotValueConfig,
  rows: Record<string, unknown>[],
  nums: number[],
): number {
  if (v.aggregation === "sum" || v.aggregation === "count") {
    return nums.reduce((a, b) => a + b, 0);
  }
  if (v.aggregation === "avg") {
    // 2.4: weighted recombination from raw sum + count companions.
    // If the companions aren't present (e.g. tests that pass synthesized
    // rows without them), fall back to mean-of-per-row-means so the engine
    // still degrades gracefully rather than dividing by zero.
    let sumNum = 0;
    let sumDen = 0;
    let haveCompanions = false;
    for (const r of rows) {
      const rs = r[avgSumAlias(v.field)];
      const rc = r[avgCountAlias(v.field)];
      if (rs !== undefined && rc !== undefined) {
        haveCompanions = true;
        sumNum += Number(rs ?? 0);
        sumDen += Number(rc ?? 0);
      }
    }
    if (haveCompanions) {
      return sumDen > 0 ? sumNum / sumDen : 0;
    }
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }
  if (v.aggregation === "min") {
    return nums.length > 0 ? Math.min(...nums) : 0;
  }
  // max
  return nums.length > 0 ? Math.max(...nums) : 0;
}

// ─── Label Helpers ──────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  product_name: "Product",
  outlet_code: "Outlet Code",
  hotel_name: "Hotel",
  hotel_group: "Hotel Group",
  location_group: "Location Group",
  net_amount: "Revenue",
  booking_fee: "Booking Fee",
  sale_month: "Month",
  sale_year: "Year",
  sale_hour: "Hour",
};

function dimensionLabel(field: string): string {
  return DIMENSION_LABELS[field] ?? field;
}

function valueLabel(v: PivotValueConfig): string {
  const aggLabel = v.aggregation.charAt(0).toUpperCase() + v.aggregation.slice(1);
  const fieldLabel = DIMENSION_LABELS[v.field] ?? v.field.replace(/_/g, " ");
  return `${aggLabel} of ${fieldLabel}`;
}
