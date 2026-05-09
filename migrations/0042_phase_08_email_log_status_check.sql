-- Phase 8 Plan 08-01 — DB-level CHECK on email_log.status (PR #37 review).
--
-- The Drizzle schema (`text("status", { enum: ["sent","failed"] })`) gives
-- TypeScript-level enforcement, but the DDL still accepts arbitrary strings
-- against any future code path that bypasses the ORM (raw psql, ad-hoc
-- migration script, etc.). Add the constraint at the DB level so the column
-- shape is the same wherever it's read from.
--
-- Idempotent — guarded with NOT EXISTS lookup against pg_constraint so
-- re-applying on UAT / preview branches that may already have the
-- constraint is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_log_status_check'
  ) THEN
    ALTER TABLE "email_log"
      ADD CONSTRAINT "email_log_status_check"
      CHECK (status IN ('sent', 'failed'));
  END IF;
END $$;
