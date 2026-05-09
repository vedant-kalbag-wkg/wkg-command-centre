-- Phase 9.1 Plan 09.1-02 — Multi-currency forex normalisation: sales_records.net_amount_gbp NULLABLE (FX-02).
--
-- Adds:
--   1. sales_records.net_amount_gbp numeric(12,2) NULLABLE.
--
-- NULLABLE is intentional. The companion 0048 migration (Phase 9.1 Plan 09.1-05)
-- flips this column to NOT NULL, but ONLY after the backfill script
-- (scripts/backfill-net-amount-gbp.ts) reports zero NULL rows. Applying 0048
-- before backfill completes will lock the table and stall the deploy
-- (CONTEXT.md / RESEARCH.md Pitfall 7).
--
-- No standalone index is added: existing (location_id, transaction_date) and
-- (region_id, transaction_date) composite indexes already cover every analytics
-- access pattern. SUM(net_amount_gbp) does not benefit from a value-column index.
--
-- Deltas:
--   1. sales_records.net_amount_gbp NULLABLE column

ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "net_amount_gbp" numeric(12, 2);
--> statement-breakpoint
