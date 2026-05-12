-- Phase 10 (Plan 10-02 close-out) — Swap user_scopes UNIQUE from
-- (user_id, dimension_type, dimension_id) to
-- (user_id, role_id, dimension_type, dimension_id).
--
-- Why this exists (gap fix):
--   - Migration 0005 created user_scopes with UNIQUE(user_id, dimension_type,
--     dimension_id) — pre-Phase-10, when scopes were not bound to a role.
--   - Plan 10-02 (migration 0050) added the `role_id` column and the Drizzle
--     schema definition was updated to declare
--     `unique().on(userId, roleId, dimensionType, dimensionId)`.
--     0050's docstring stated "0052 (if shipped) replaces the constraint" —
--     but 0052's actual SQL only does the NOT-NULL flip, NEVER swapping the
--     UNIQUE constraint. So the DB has the 3-column UNIQUE while the schema
--     and call-sites assume the 4-column UNIQUE.
--   - `_addScopeForActor` in `scopes-internal.ts` calls `onConflictDoNothing`
--     with target=[userId, roleId, dimensionType, dimensionId] — which fails
--     in Postgres with "there is no unique or exclusion constraint matching
--     the ON CONFLICT specification" because no such constraint exists yet.
--
-- Semantics:
--   The 4-column UNIQUE allows the same (user, dim_type, dim_id) to bind to
--   multiple roles (one row per role). It also allows multiple rows with
--   role_id = NULL for the same (user, dim_type, dim_id) because Postgres
--   treats NULL as not-equal-to-NULL in UNIQUE — but legacy pre-Plan-10
--   rows were already unique on the 3-column triple (per the constraint we
--   are now dropping), and Phase 10 code always writes a non-null role_id,
--   so the looser NULL-handling has no practical effect on either historical
--   or new data.
--
-- This migration is paired with the removal of 0052 from the migration
-- journal (operator-gated, restoring its original design). In CI / fresh
-- envs the `role_id` column stays NULLABLE; the operator applies 0052 by
-- hand once `SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL` is 0
-- on prod.
--
-- Idempotent: both the DROP and the ADD use IF [NOT] EXISTS guards.

-- ── Step 1: Drop the legacy 3-column UNIQUE ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_scopes_user_id_dimension_type_dimension_id_unique'
      AND conrelid = 'user_scopes'::regclass
  ) THEN
    ALTER TABLE "user_scopes"
      DROP CONSTRAINT "user_scopes_user_id_dimension_type_dimension_id_unique";
  END IF;
END $$;
--> statement-breakpoint

-- ── Step 2: Add the 4-column UNIQUE (idempotent) ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_scopes_user_id_role_id_dimension_type_dimension_id_unique'
      AND conrelid = 'user_scopes'::regclass
  ) THEN
    ALTER TABLE "user_scopes"
      ADD CONSTRAINT "user_scopes_user_id_role_id_dimension_type_dimension_id_unique"
      UNIQUE ("user_id", "role_id", "dimension_type", "dimension_id");
  END IF;
END $$;
