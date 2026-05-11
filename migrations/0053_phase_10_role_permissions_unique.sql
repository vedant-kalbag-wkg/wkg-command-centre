-- Phase 10 (Plan 10-02 fix) — Add UNIQUE constraint on role_permissions(role_id, action, subject)
--
-- Why: 0051 seed inserts use ON CONFLICT DO NOTHING but there was no unique constraint —
-- only a UUID PK which is always fresh. Every re-run of 0051 duplicated rows, causing
-- ability.ts to emit duplicate CASL rules.
--
-- This migration:
--   1. Deduplicates existing role_permissions rows (keeps one row per (role_id, action, subject),
--      preferring the oldest by created_at).
--   2. Adds a UNIQUE constraint on (role_id, action, subject) so future ON CONFLICT DO NOTHING
--      in re-runs actually works.
--
-- Idempotent: uses IF NOT EXISTS guard on the constraint.

-- ── Step 1: Remove duplicate rows, keeping the oldest ────────────────────────
DELETE FROM "role_permissions"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "role_id", "action", "subject"
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
    FROM "role_permissions"
  ) sub
  WHERE sub.rn > 1
);
--> statement-breakpoint

-- ── Step 2: Add UNIQUE constraint (idempotent via DO $$) ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_permissions_role_id_action_subject_unique'
      AND conrelid = 'role_permissions'::regclass
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_role_id_action_subject_unique"
      UNIQUE ("role_id", "action", "subject");
  END IF;
END $$;
