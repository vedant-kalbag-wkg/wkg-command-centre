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

import {
  formatCurrency,
  formatNativeCurrency,
  formatNumber,
} from "@/lib/analytics/formatters";
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
 *
 * Phase 9.1 / D-17 / Pitfall 4 — saved-pivot back-compat:
 *   The field ids `"net_amount"` and `"booking_fee"` are PRESERVED in the
 *   public allowlist so saved pivots in production (which serialise
 *   {field: "net_amount", aggregation: "sum"} into JSON) keep resolving.
 *   The underlying SQL fragment is unchanged — every aggregate over
 *   `net_amount` continues to compute the native (raw-currency) sum. The
 *   GBP arm is added via the parallel `CURRENCY_GBP_COLUMNS` map below;
 *   `buildPivotSQL` auto-emits `<alias>_gbp` and `currency_key_<field>`
 *   companions whenever a value config references one of these fields, so
 *   the pivot row carries the substrate plan 09.1-07 needs to dispatch
 *   per D-10. No saved-pivot config changes hands.
 */
export const ALLOWED_COLUMNS = new Map<string, string>([
  ["product_name", "products.name"],
  // Phase 07-06 — locations.outlet_code is gone; the pivot engine's
  // logical "outlet_code" dimension is now sourced from customer_code
  // (the canonical hotel-level identifier). Operator-facing label
  // "Outlet Code" stays the same; the underlying column changes.
  ["outlet_code", "locations.customer_code"],
  ["hotel_name", "locations.name"],
  // Denormalised text columns on `locations`; see migration 0022.
  ["hotel_group", "locations.hotel_group"],
  ["location_group", "locations.location_group"],
  // `net_amount` is the universal value column; `booking_fee` isolates fee-row
  // revenue (9991 + 9992) using IS_FEE_RAW_SQL — see migration 0022.
  // FX-03 / D-17: field id PRESERVED. SQL fragment unchanged. GBP companion
  // is wired below — see CURRENCY_GBP_COLUMNS + buildPivotSQL.
  ["net_amount", "sales_records.net_amount::numeric"],
  ["booking_fee", `(CASE WHEN ${IS_FEE_RAW_SQL} THEN sales_records.net_amount::numeric ELSE 0 END)`],
]);

/**
 * FX-03 / D-11 sibling map — for each currency-typed metric field, the SQL
 * expression that computes its GBP-normalised companion. The pivot SQL
 * builder auto-emits an additional `<alias>_gbp` column whenever a value
 * config references one of these fields, alongside a `currency_key_<field>`
 * column resolved per D-10 (single-currency cohort → ISO code, multi → NULL).
 *
 * The field ID stays the same — saved pivots that reference
 * `{field: "net_amount", ...}` get the dual-emit substrate transparently
 * without any saved-pivot rewrite (Pitfall 4 back-compat).
 *
 * Renderer dispatch (D-10) lands in plan 09.1-07; this plan ships the SQL
 * contract so the renderer has the columns to dispatch on.
 */
export const CURRENCY_GBP_COLUMNS = new Map<string, string>([
  ["net_amount", "sales_records.net_amount_gbp::numeric"],
  ["booking_fee", `(CASE WHEN ${IS_FEE_RAW_SQL} THEN sales_records.net_amount_gbp::numeric ELSE 0 END)`],
]);

/**
 * FX-03 / D-11 helper — returns true iff the given metric field has a
 * GBP-normalised sibling (i.e., is currency-typed). The pivot SQL builder
 * uses this to decide whether to emit `<alias>_gbp` and `currency_key_<field>`
 * columns alongside the primary value column.
 */
export function isCurrencyField(field: string): boolean {
  return CURRENCY_GBP_COLUMNS.has(field);
}

/**
 * FX-03 / D-11 — alias for the GBP sibling of a value config. Mirrors the
 * `${agg}_${field}` shape used by buildPivotSQL so renderer code (plan 09.1-07)
 * can derive the GBP cell key directly from the value config.
 */
export function gbpAlias(agg: PivotAggregation, field: string): string {
  return `${agg}_${field}_gbp`;
}

/**
 * FX-03 / D-10 — alias for the per-row currency_key column emitted alongside
 * any currency-typed value config. One per currency-typed value config so two
 * currency metrics in the same pivot don't collide (e.g., net_amount and
 * booking_fee can each have their own resolver — though they share the
 * underlying `sales_records.currency` column).
 */
export function currencyKeyAlias(field: string): string {
  return `currency_key_${field}`;
}

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

    // FX-03 / D-11 — currency dual-emit. When the value config references a
    // currency-typed field (net_amount or booking_fee), auto-emit a GBP
    // sibling and a currency_key column. The renderer (plan 09.1-07) reads
    // these companions to dispatch native vs GBP per D-10 cell-by-cell. The
    // primary alias (`${agg}_${field}`) keeps its native semantics so saved
    // pivots that reference {field: "net_amount", ...} continue to surface
    // raw-currency sums by default — Pitfall 4 / D-17 back-compat.
    //
    // count aggregations skip the dual-emit: COUNT is currency-agnostic and
    // a "count of fee rows in GBP" is meaningless. The currency_key column
    // is also skipped for count because the dispatch is moot.
    if (v.aggregation !== "count" && isCurrencyField(v.field)) {
      const gbpExpr = CURRENCY_GBP_COLUMNS.get(v.field)!;
      selectParts.push(
        `${v.aggregation.toUpperCase()}(COALESCE(${gbpExpr}, 0)) AS "${gbpAlias(v.aggregation, v.field)}"`,
      );
      // currency_key resolver per D-10: single-currency cohort → ISO code,
      // multi → NULL. The FILTER predicate MUST track exactly the population
      // of rows the SUM "sees with non-zero contribution" (Phase 9.1 / WR-09):
      //
      //   - booking_fee: the SUM expression at line 87 wraps the value in a
      //     CASE WHEN ${IS_FEE_RAW_SQL} THEN ... ELSE 0 END — non-fee rows are
      //     in the rowset but contribute 0. currency_key MUST apply the same
      //     filter so a non-fee EUR row in a GBP-fee cohort doesn't pollute
      //     COUNT(DISTINCT currency) and force currency_key to NULL incorrectly.
      //
      //   - net_amount: the SUM is unfiltered (raw native, no CASE WHEN). Every
      //     row in the rowset contributes its native amount. currency_key
      //     MUST be unfiltered to match — so cross-currency cohorts correctly
      //     resolve to NULL (multi).
      //
      // The asymmetry is intentional and load-bearing — see pivot-engine.test.ts
      // "WR-09 currency_key symmetry" describe block. A future "tidy-up"
      // refactor that makes the two paths uniform will silently break one
      // of these contracts; the unit tests catch that drift.
      const keyFilter =
        v.field === "booking_fee" ? ` FILTER (WHERE ${IS_FEE_RAW_SQL})` : "";
      selectParts.push(
        `CASE WHEN COUNT(DISTINCT sales_records.currency)${keyFilter} = 1
              THEN MIN(sales_records.currency)${keyFilter}
              ELSE NULL END AS "${currencyKeyAlias(v.field)}"`,
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

/** Formats a numeric value into a display cell.
 *
 * FX-03 / D-10 / D-17 — auto-pick dispatch (plan 09.1-07):
 *   - For currency-typed fields (net_amount, booking_fee), the renderer reads
 *     the per-row `currency_key_<field>` companion column auto-emitted by
 *     `buildPivotSQL`. When that key is set (single-currency cohort), the cell
 *     formats with `formatNativeCurrency` against the raw native sum at the
 *     primary alias (`<agg>_<field>`). When NULL (multi-currency cohort), the
 *     cell falls back to `formatCurrency` (GBP-pinned) against the GBP arm
 *     (`<agg>_<field>_gbp`) — i.e. callers pass the GBP-side value when the
 *     cohort is multi-currency, and the native-side value when it's single.
 *
 * Saved-pivot back-compat (D-17 / Pitfall 4): the primary alias still emits
 * the native sum, so consumers that have not yet migrated to read
 * `<alias>_gbp` see the same numbers they always did. The dispatch only
 * activates when the consumer threads the `currencyKey` through.
 *
 * `currencyKey === undefined` means "no currency context available" (e.g.
 * tests pre-FX-03 contract, or consumers that haven't migrated): keep the
 * pre-FX behaviour and format the primary value as GBP via formatCurrency.
 */
function formatCell(
  value: number,
  field: string,
  agg: PivotAggregation,
  currencyKey?: string | null,
): PivotCell {
  const isCurrency = field === "net_amount" || field === "booking_fee";

  let formatted: string;
  if (agg === "count") {
    formatted = formatNumber(value, 0);
  } else if (isCurrency) {
    // D-10 dispatch: single-currency cohort → native; otherwise → GBP.
    // The caller is responsible for passing the value matching the chosen
    // currency arm (native sum when currencyKey is set; GBP sum when null).
    if (currencyKey) {
      formatted = formatNativeCurrency(value, currencyKey);
    } else {
      formatted = formatCurrency(value);
    }
  } else {
    formatted = formatNumber(value, agg === "avg" ? 2 : 0);
  }

  return { value, formatted };
}

/**
 * FX-03 / D-10 — per-cell value picker. For currency-typed value configs,
 * reads the per-row `currency_key_<field>` companion column auto-emitted by
 * buildPivotSQL: when set (single-currency cohort), returns the native sum
 * at the primary alias; when null (multi-currency cohort), returns the GBP
 * sum at the `<alias>_gbp` companion. Non-currency / count fields fall
 * through with `currencyKey: undefined` (no dispatch — formatCell renders
 * as before).
 *
 * Back-compat (D-17 / Pitfall 4): when neither `currency_key_<field>` nor
 * `<alias>_gbp` is present on the raw row (e.g. test fixtures pre-FX-03 or
 * legacy callers), fall through to the primary alias with `undefined`
 * currency key — formatCell renders as GBP via formatCurrency exactly like
 * pre-FX behaviour.
 */
function pickCellValue(
  raw: Record<string, unknown>,
  v: PivotValueConfig,
): { val: number; currencyKey?: string | null } {
  const alias = `${v.aggregation}_${v.field}`;

  // count + non-currency fields: no dispatch.
  if (v.aggregation === "count" || !isCurrencyField(v.field)) {
    return { val: Number(raw[alias] ?? 0) };
  }

  const keyAlias = currencyKeyAlias(v.field);
  const gbpKey = gbpAlias(v.aggregation, v.field);
  const hasDualEmit = keyAlias in raw || gbpKey in raw;

  // Back-compat: rows without the dual-emit substrate render as before
  // (primary alias, GBP-pinned via formatCurrency).
  if (!hasDualEmit) {
    return { val: Number(raw[alias] ?? 0) };
  }

  const rawKey = raw[keyAlias];
  const currencyKey =
    typeof rawKey === "string" && rawKey.length > 0 ? rawKey : null;

  if (currencyKey) {
    // Single-currency cohort: render the native sum at the primary alias.
    return { val: Number(raw[alias] ?? 0), currencyKey };
  }
  // Multi-currency cohort: render the GBP sum at the companion alias.
  return {
    val: Number(raw[gbpKey] ?? 0),
    currencyKey: null,
  };
}

/**
 * FX-03 / D-10 — grand-total currency-key resolver. Returns the shared ISO
 * code when every row in the bucket has the same non-null currency_key; null
 * when the bucket spans multiple currencies (or any row is null). Used by
 * formatPivotResults to dispatch the grand-total row between native and GBP.
 *
 * The single-bucket convention mirrors the SQL-side resolver (`CASE WHEN
 * COUNT(DISTINCT currency) = 1 THEN MIN(currency) ELSE NULL END`) so the
 * grand total visually matches the per-cell behaviour.
 */
function uniformCurrencyKey(
  rows: Record<string, unknown>[],
  v: PivotValueConfig,
): string | null {
  if (v.aggregation === "count" || !isCurrencyField(v.field)) return null;
  const keyAlias = currencyKeyAlias(v.field);
  let shared: string | null = null;
  for (const r of rows) {
    const k = r[keyAlias];
    if (typeof k !== "string" || k.length === 0) return null;
    if (shared === null) shared = k;
    else if (shared !== k) return null;
  }
  return shared;
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
        // D-10 dispatch: single-currency cohort → render native sum at the
        // primary alias; multi-currency cohort → render GBP sum at the
        // <alias>_gbp companion. Non-currency fields (count, etc.) fall
        // through with currencyKey=undefined (no dispatch).
        const { val, currencyKey } = pickCellValue(raw, v);
        cells[alias] = formatCell(val, v.field, v.aggregation, currencyKey);
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
      // D-10 dispatch (same rule as the no-column-pivot branch above).
      const { val, currencyKey } = pickCellValue(raw, v);
      // Cell key includes column dimension for crosstab layout
      const cellKey = pivotCellKey(colKey, alias, values.length);
      pivotRow.cells[cellKey] = formatCell(val, v.field, v.aggregation, currencyKey);
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
      // D-10 grand-total dispatch: when every row in the pivot shares the
      // same non-null currency_key, render the grand total native; otherwise
      // fall back to the GBP arm. Back-compat: rows without the dual-emit
      // substrate (no `<alias>_gbp` column) keep the pre-FX behaviour.
      const groupKey = uniformCurrencyKey(trimmed, v);
      const gbpKey = gbpAlias(v.aggregation, v.field);
      const hasGbpArm = trimmed.some((r) => gbpKey in r);
      const sumAlias = groupKey || !hasGbpArm ? alias : gbpKey;
      const nums = trimmed.map((r) => Number(r[sumAlias] ?? 0));
      const total = aggregateGrandTotal(v, trimmed, nums);
      grandTotals[alias] = formatCell(total, v.field, v.aggregation, groupKey);
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
        // Per-bucket D-10 dispatch — a bucket spanning a single currency
        // gets a native grand total even if other buckets are mixed.
        // Back-compat: bucket rows without the GBP arm keep pre-FX behaviour.
        const groupKey = uniformCurrencyKey(bucketRows, v);
        const gbpKey = gbpAlias(v.aggregation, v.field);
        const hasGbpArm = bucketRows.some((r) => gbpKey in r);
        const sumAlias = groupKey || !hasGbpArm ? alias : gbpKey;
        const nums = bucketRows.map((r) => Number(r[sumAlias] ?? 0));
        const total = aggregateGrandTotal(v, bucketRows, nums);
        const cellKey = pivotCellKey(colKey, alias, config.values.length);
        grandTotals[cellKey] = formatCell(total, v.field, v.aggregation, groupKey);
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

// FX-03 review (RESEARCH inventory line 546 — pivot-engine line 585):
//   This is the display-label map. Variant (b)/(c) per plan: it references
//   the field id `net_amount` to resolve "Revenue" — preserving the field id
//   in ALLOWED_COLUMNS (D-17 / Pitfall 4) keeps this label resolution
//   working unchanged. No dual-emit substitution is needed AT THIS LINE
//   because the label is identity-on-id, not a SUM aggregate. The dual-emit
//   substrate sits above (CURRENCY_GBP_COLUMNS + buildPivotSQL companions);
//   the renderer-side native-vs-GBP label tweak (e.g., "Revenue (native)" /
//   "Revenue (GBP)") is plan 09.1-07's call once the dispatch is live.
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
