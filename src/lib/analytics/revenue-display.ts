// Phase 9.1 / FX-03 — dual-emit revenue contract (D-11)
//
// Every analytics SUM site emits three columns: `revenue_native`, `revenue_gbp`,
// and `currency_key`. The renderer (plan 09.1-07) dispatches per D-10:
//   currency_key set    → render revenue_native using formatNativeCurrency
//   currency_key null   → render revenue_gbp using formatCurrency (GBP-pinned)
//
// `currency_key` is non-null only when COUNT(DISTINCT currency) = 1 over the
// aggregate group (single-currency cohort); NULL otherwise (multi-currency).
// Sort/ranking always use revenue_gbp per D-12 — cross-cohort comparison only
// makes sense in GBP.
//
// Lives in its own dependency-free module so client components ("use client")
// can import the D-10 dispatch without dragging the drizzle / postgres /
// active-locations server graph into the browser bundle (Turbopack does not
// tree-shake side-effecting top-level imports out of `queries/shared.ts`).

export type DualEmitRevenueRow = {
  revenue_native: string;
  revenue_gbp: string;
  currency_key: string | null;
};

/**
 * D-10 single-source-of-truth dispatch for native-vs-GBP rendering. Returns
 * the display value + currency the renderer should format with. Plan 09.1-07's
 * metric-tile renderers call this so the dispatch rule lives in exactly one
 * place — adding a second toggle later is a one-file change.
 */
export function pickRevenueDisplay(row: DualEmitRevenueRow): {
  value: number;
  currency: string;
} {
  return row.currency_key
    ? { value: Number(row.revenue_native), currency: row.currency_key }
    : { value: Number(row.revenue_gbp), currency: "GBP" };
}
