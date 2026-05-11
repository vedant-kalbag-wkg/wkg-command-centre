-- Phase 10 (Plan 10-02) — Access Control Extended: user_scopes.role_id NOT NULL flip.
--
-- MUST NOT be applied until migration 0051 has reported zero NULL role_id rows
-- (see RESEARCH.md §"Migration ordering" + Pitfall 6 — applying this before
-- backfill completes locks the table and stalls the deploy).
--
-- Verification gate (operator runs before applying):
--   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;"
--   Expected: 0
--
-- This migration is operator-gated, NOT auto-applied. The CI/Vercel deploy
-- pipeline applies 0050 + 0051 automatically; 0052 is held back until the
-- operator confirms the count above is 0 on prod, then runs:
--   psql "$DATABASE_URL" -f migrations/0052_phase_10_user_scopes_role_id_required.sql
--
-- Idempotent: only flips when the column is currently NULLABLE — re-running
-- on an already-NOT-NULL column is a no-op. Mirrors migration 0048's
-- house style.
--
-- Deltas:
--   1. ALTER COLUMN user_scopes.role_id SET NOT NULL

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_scopes'
      AND column_name = 'role_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "user_scopes" ALTER COLUMN "role_id" SET NOT NULL;
  END IF;
END $body$;
--> statement-breakpoint
