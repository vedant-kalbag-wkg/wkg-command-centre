-- Phase 5.3 — make `kiosk_assignments.assigned_at` immutable in normal use.
--
-- Background: the April 2026 Monday import (commit 44245ca) was the first
-- time `kiosk_assignments` was populated; every row received `DEFAULT NOW()`,
-- collapsing 231 outlets into a single install cohort and breaking the
-- Maturity dashboard. Phase 5.2 backfills correct historical dates; this
-- migration prevents the same class of mass-mutation from recurring
-- silently. See `tasks/analytics-audit/phase-5-1-investigation.md` for the
-- full forensic breakdown.
--
-- Mechanism: a BEFORE UPDATE trigger that rejects any change to
-- `assigned_at` unless the connection has set
-- `app.allow_assigned_at_mutation = 'on'` for the current transaction (via
-- `SET LOCAL`). The override is intentional: the Phase 5.2 backfill script
-- needs to write through this trigger once, but every other code path —
-- the kiosk admin UI, the Monday import, ad-hoc DBA queries — should be
-- blocked. `current_setting(..., true)` returns `''` when the variable is
-- unset, which fails the equality check and triggers the EXCEPTION.
--
-- Idempotent: DROP TRIGGER / DROP FUNCTION IF EXISTS guards re-running.

CREATE OR REPLACE FUNCTION raise_immutable_assigned_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
     AND COALESCE(current_setting('app.allow_assigned_at_mutation', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'kiosk_assignments.assigned_at is immutable (Phase 5.3). To override within a backfill transaction, run: SET LOCAL app.allow_assigned_at_mutation = ''on'';'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS kiosk_assignments_assigned_at_immutable
  ON kiosk_assignments;
--> statement-breakpoint

CREATE TRIGGER kiosk_assignments_assigned_at_immutable
  BEFORE UPDATE OF assigned_at ON kiosk_assignments
  FOR EACH ROW
  EXECUTE FUNCTION raise_immutable_assigned_at();
