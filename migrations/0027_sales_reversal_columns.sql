-- Reversal handling per audit decision D2 (tasks/todo.md).
--
-- Adds four columns to sales_records so the analytics layer can reason about
-- refund/cancellation pairs without re-deriving them from net_amount sign +
-- ref_no joins on every query:
--
--   is_reversal           — true for refund rows (net_amount < 0).
--   is_partial_reversal   — true when |refund.net_amount| < |original.net_amount|
--                           for the matched original. Drives the Partial Refunds
--                           KPI; computed alongside original_record_id.
--   original_record_id    — FK back to the matched original row. NULL for orphan
--                           refunds (original predates the data window or no
--                           matching positive-amount row sharing ref_no exists).
--   processed_at_location_id — preserves the historical outlet that handled
--                           the refund (e.g. Customer Service "BK"). At ingest,
--                           location_id is rewritten to the matched original's
--                           location_id so cancellations attribute to the
--                           booking outlet; this column retains the original
--                           CSV attribution for audit.
--
-- All four are pure additions — existing rows take defaults / NULL until the
-- one-shot scripts/backfill-reversals.ts populates them.

ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "is_reversal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "is_partial_reversal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "original_record_id" uuid;
--> statement-breakpoint

ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "processed_at_location_id" uuid;
--> statement-breakpoint

ALTER TABLE "sales_records"
  DROP CONSTRAINT IF EXISTS "sales_records_original_record_id_fkey";
--> statement-breakpoint

ALTER TABLE "sales_records"
  ADD CONSTRAINT "sales_records_original_record_id_fkey"
  FOREIGN KEY ("original_record_id") REFERENCES "sales_records" ("id")
  ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "sales_records"
  DROP CONSTRAINT IF EXISTS "sales_records_processed_at_location_id_fkey";
--> statement-breakpoint

ALTER TABLE "sales_records"
  ADD CONSTRAINT "sales_records_processed_at_location_id_fkey"
  FOREIGN KEY ("processed_at_location_id") REFERENCES "locations" ("id")
  ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_records_is_reversal_idx"
  ON "sales_records" ("is_reversal");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_records_original_record_id_idx"
  ON "sales_records" ("original_record_id");
