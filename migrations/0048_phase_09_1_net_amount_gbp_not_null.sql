-- Phase 9.1 Plan 09.1-05 — Multi-currency forex normalisation: net_amount_gbp NOT NULL flip (FX-02).
--
-- MUST NOT be applied until scripts/backfill-net-amount-gbp.ts has reported
-- zero NULL rows (CONTEXT.md / RESEARCH.md Pitfall 7 — applying this before
-- backfill completes locks the table and stalls the deploy).
--
-- Verification gate (operator runs before applying):
--   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sales_records WHERE net_amount_gbp IS NULL;"
--   Expected: 0
--
-- Companion to migration 0047 which added net_amount_gbp as NULLABLE so the
-- pipeline-stamping (plan 09.1-05 Task 1) and the backfill (Task 3) could
-- land independently of this NOT NULL flip.
--
-- Idempotent: only flips when the column is currently NULLABLE — re-running
-- on an already-NOT-NULL column is a no-op (project house style, see 0044's
-- guard pattern around constraint flips).
--
-- Deltas:
--   1. ALTER COLUMN net_amount_gbp SET NOT NULL

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_records'
      AND column_name = 'net_amount_gbp'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "sales_records" ALTER COLUMN "net_amount_gbp" SET NOT NULL;
  END IF;
END $body$;
--> statement-breakpoint
