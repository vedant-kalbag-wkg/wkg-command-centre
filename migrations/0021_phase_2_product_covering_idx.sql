-- Phase 2 refinement: second covering index targeting product-grouped
-- queries (#2 getTopProducts, #3 getCategoryPerformance). These queries
-- GROUP BY products.name with a date predicate — the (transaction_date,
-- location_id) covering index from 0020 doesn't match their shape.
-- A covering index keyed (transaction_date, product_id) INCLUDE
-- (gross_amount, quantity) lets the planner do an index-only scan.
--
-- Same idempotency model as 0020: IF NOT EXISTS makes this a no-op on
-- prod (where scripts/phase-2-apply-indexes.ts runs CREATE INDEX
-- CONCURRENTLY first), and bootstraps fresh dev/CI under drizzle-kit's
-- transaction wrapper.

CREATE INDEX IF NOT EXISTS "sales_records_txn_prod_covering_idx"
  ON "sales_records" ("transaction_date", "product_id")
  INCLUDE ("gross_amount", "quantity");
