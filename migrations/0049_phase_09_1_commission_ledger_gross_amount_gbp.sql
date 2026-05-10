-- Phase 9.1 / PR #40 review (observation A) — rename
-- commission_ledger.gross_amount → gross_amount_gbp.
--
-- Why: Phase 9.1 plan 09.1-07 (FX-04) switched the commission processor to
-- store the GBP-normalised commission base in this column (D-15 — tier
-- brackets are GBP-denominated, so the ledger reads back without a per-row
-- FX conversion at the dashboard read path). The column NAME stayed
-- `gross_amount`, which silently misleads any future engineer who joins the
-- ledger and expects the row's native gross. The PR #40 reviewer flagged
-- this as a scheduled rename; doing it now while the schema delta from
-- Phase 9.1 is still fresh in the operator's mind avoids a "why does this
-- column hold GBP" surprise later.
--
-- Idempotent: the rename is guarded on column existence so re-applying on
-- a database that already shipped this migration is a no-op (project house
-- style, see 0048's NOT NULL guard pattern).
--
-- No data migration required — the rename is metadata only; row contents
-- are unchanged. Existing values WERE GBP-equivalent already (commission
-- processor has stored GBP since FX-04 landed); the rename just brings the
-- column name into sync with the value semantics.
--
-- Deltas:
--   1. RENAME COLUMN gross_amount → gross_amount_gbp on commission_ledger.

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_ledger'
      AND column_name = 'gross_amount'
  ) THEN
    ALTER TABLE "commission_ledger" RENAME COLUMN "gross_amount" TO "gross_amount_gbp";
  END IF;
END $body$;
--> statement-breakpoint
