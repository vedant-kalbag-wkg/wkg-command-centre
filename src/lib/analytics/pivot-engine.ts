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
  ["hotel_group", "locations.hotel_group"],
  ["region", "locations.region"],
  ["location_group", "locations.location_group"],
  ["gross_amount", "sales_records.gross_amount::numeric"],
  ["quantity", "sales_records.quantity"],
  ["booking_fee", "sales_records.booking_fee::numeric"],
  ["sale_commission", "sales_records.sale_commission::numeric"],
  ["discount_amount", "sales_records.discount_amount::numeric"],
]);

/** Derived group columns that require SQL expressions (not simple column refs). */
export const DERIVED_GROUP_COLUMNS = new Map<string, string>([
  ["sale_month", "TO_CHAR(sales_records.transaction_date, 'Mon YYYY')"],
  ["sale_year", "EXTRACT(YEAR FROM sales_records.transaction_date)::TEXT"],
  ["sale_hour", "EXTRACT(HOUR FROM sales_records.transaction_time)::TEXT"],
]);

/** All columns that can appear as dimension fields (GROUP BY targets). */
const DIMENSION_COLUMNS = new Set([
  "product_name",
  "outlet_code",
  "hotel_name",
  "hotel_group",
  "region",
  "location_group",
  "sale_month",
  "sale_year",
  "sale_hour",
]);

/** Columns that can appear as value/metric fields (aggregation targets). */
const METRIC_COLUMNS = new Set([
  "gross_amount",
  "quantity",
  "booking_fee",
  "sale_commission",
  "discount_amount",
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
 * Checks ALLOWED_COLUMNS first, then DERIVED_GROUP_COLUMNS.
 */
function resolveColumn(field: string): string | null {
  return ALLOWED_COLUMNS.get(field) ?? DERIVED_GROUP_COLUMNS.get(field) ?? null;
}

/**
 * Builds a SQL query string for the pivot config.
 *
 * @param config  - The validated pivot configuration
 * @param whereClause - Optional raw SQL WHERE clause (without "WHERE" keyword)
 * @returns SQL query string
 */
export function buildPivotSQL(
  config: PivotConfig,
  whereClause?: string,
): string {
  const allGroupFields = [...config.rowFields, ...config.columnFields];

  // SELECT: dimension columns + aggregated value columns
  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  for (const field of allGroupFields) {
    const expr = resolveColumn(field);
    if (!expr) continue;
    selectParts.push(`${expr} AS "${field}"`);
    groupByParts.push(expr);
  }

  // Value aggregations
  for (const v of config.values) {
    const expr = resolveColumn(v.field);
    if (!expr) continue;
    const alias = `${v.aggregation}_${v.field}`;
    if (v.aggregation === "count") {
      selectParts.push(`COUNT(${expr})::numeric AS "${alias}"`);
    } else {
      selectParts.push(
        `${v.aggregation.toUpperCase()}(COALESCE(${expr}, 0)) AS "${alias}"`,
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
  const isCurrency =
    field === "gross_amount" ||
    field === "booking_fee" ||
    field === "sale_commission" ||
    field === "discount_amount";

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
      const cellKey = values.length > 1 ? `${colKey} | ${alias}` : colKey;
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

  // Grand totals — aggregate across all raw rows per value config
  const grandTotals: Record<string, PivotCell> = {};
  for (const v of config.values) {
    const alias = `${v.aggregation}_${v.field}`;
    const nums = trimmed.map((r) => Number(r[alias] ?? 0));

    let total: number;
    if (v.aggregation === "sum" || v.aggregation === "count") {
      total = nums.reduce((a, b) => a + b, 0);
    } else if (v.aggregation === "avg") {
      total = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    } else if (v.aggregation === "min") {
      total = nums.length > 0 ? Math.min(...nums) : 0;
    } else {
      // max
      total = nums.length > 0 ? Math.max(...nums) : 0;
    }

    grandTotals[alias] = formatCell(total, v.field, v.aggregation);
  }

  return {
    headers,
    rows,
    grandTotals,
    rowCount: rows.length,
    truncated,
  };
}

// ─── Label Helpers ──────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  product_name: "Product",
  outlet_code: "Outlet Code",
  hotel_name: "Hotel",
  hotel_group: "Hotel Group",
  region: "Region",
  location_group: "Location Group",
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
