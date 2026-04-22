-- Phase 2 indexes: non-CONCURRENTLY form. On prod, these indexes are
-- built out-of-band via scripts/phase-2-apply-indexes.ts (which uses
-- CREATE INDEX CONCURRENTLY) BEFORE drizzle-kit's migrator runs this
-- marker — so `IF NOT EXISTS` makes both statements no-ops.
--
-- On fresh dev/CI databases with no rows, drizzle-kit runs this file
-- inside its default BEGIN/COMMIT wrapper; the brief table lock is
-- acceptable (no live traffic).
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, which is
-- why the prod path bypasses drizzle-kit entirely.

CREATE INDEX IF NOT EXISTS "sales_records_txn_loc_covering_idx"
  ON "sales_records" ("transaction_date", "location_id")
  INCLUDE ("gross_amount", "quantity", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_assignments_loc_assigned_idx"
  ON "kiosk_assignments" ("location_id", "assigned_at");
