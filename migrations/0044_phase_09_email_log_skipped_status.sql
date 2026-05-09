-- Phase 09 plan 03: extend email_log.status CHECK to include 'queued' and 'skipped'
-- Allows the weekly POC alert job to write status='skipped' for kiosks with no internal_poc_id,
-- and status='queued' as an optional future staging state.

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_log_status_check'
  ) THEN
    ALTER TABLE "email_log" DROP CONSTRAINT "email_log_status_check";
  END IF;
END $body$;
--> statement-breakpoint

DO $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_log_status_check'
  ) THEN
    ALTER TABLE "email_log"
      ADD CONSTRAINT "email_log_status_check"
      CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
  END IF;
END $body$;
