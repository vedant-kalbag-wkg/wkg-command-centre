-- Phase 10 (Plan 10-13 follow-on fix) — Widen role_permissions UNIQUE to include
-- `inverted`, and restore the read-only Location inverted (banking-fields exclusion)
-- rule that 0053's dedup pass collapsed away.
--
-- Why:
--   0051 seed inserts TWO rules with the same (role_id, action, subject) for the
--   read-only tier:
--     (read-only, read, Location, fields=NULL,                       inverted=false) — base read
--     (read-only, read, Location, fields=banking-redact-list,        inverted=true ) — invert exclusion
--   These are CASL-semantically distinct: the first grants read on Location, the
--   second forbids specific fields. Both must coexist for the redacted-read
--   behaviour v1.0 had.
--
--   0053 added UNIQUE(role_id, action, subject) and BEFORE adding the constraint
--   ran a PARTITION-BY-(role_id, action, subject) dedup that kept the OLDEST row
--   (by created_at). The OLDEST of the two same-created_at rows is decided by
--   id (UUID) ordering — i.e. non-deterministic per environment. On preview
--   the inverted=true row got dropped (discovered during 10-13 live UAT
--   preflight); in CI's fresh Testcontainers DB the inverted=false row gets
--   dropped instead. Either outcome leaves read-only users in a broken state.
--
-- This migration leaves the DB in the canonical 2-row state regardless of
-- which row 0053's dedup happened to keep:
--   1. DROP the narrow (role_id, action, subject) UNIQUE.
--   2. Dedup on the wider partition (role_id, action, subject, inverted) so
--      the wider UNIQUE add at the end never trips. No-op once the wider
--      UNIQUE is already in place (re-run case).
--   3. Ensure the canonical read-only Location `read inverted=false` (base
--      read) row exists, via WHERE NOT EXISTS. Idempotent on a re-run; covers
--      the CI case where 0053 dropped the base-read row.
--   4. Ensure the canonical read-only Location `read inverted=true` (banking
--      redact) row exists, via WHERE NOT EXISTS. Idempotent on a re-run;
--      covers the preview case where 0053 dropped the invert row.
--   5. ADD the wider UNIQUE constraint on (role_id, action, subject, inverted).
--      IF NOT EXISTS guard makes it idempotent on a re-run.
--
-- The wider UNIQUE is sufficient for the seed: in 0051 there is no role whose
-- two rules differ ONLY in `fields` (and not also in `inverted`). `fields`
-- is therefore intentionally excluded — adding it would (a) break the
-- ON CONFLICT semantics in 0051 (jsonb equality requires the equality
-- operator to be in the unique index, which isn't supported on jsonb without
-- a btree expression index over a canonical form), and (b) not add real
-- protection given the seed shape. If a future tier introduces two same-
-- inverted rules that differ only by fields, revisit then.
--
-- Idempotent end-to-end: every step is guarded so a re-run on a DB where
-- this migration already succeeded is a no-op. (Re-runs happen via the
-- patched dialect.js hash-membership check when the migration file changes.)

-- ── Step 1: Drop the narrow UNIQUE (idempotent) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_permissions_role_id_action_subject_unique'
      AND conrelid = 'role_permissions'::regclass
  ) THEN
    ALTER TABLE "role_permissions"
      DROP CONSTRAINT "role_permissions_role_id_action_subject_unique";
  END IF;
END $$;
--> statement-breakpoint

-- ── Step 2: Dedup on the wider partition (idempotent) ────────────────────────
-- Removes any rows where (role_id, action, subject, inverted) is duplicated,
-- keeping the OLDEST by created_at (tiebreak: id). No-op once the wider
-- UNIQUE is in place (re-run case) — ROW_NUMBER never exceeds 1.
DELETE FROM "role_permissions"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "role_id", "action", "subject", "inverted"
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
    FROM "role_permissions"
  ) sub
  WHERE sub.rn > 1
);
--> statement-breakpoint

-- ── Step 3: Ensure the read-only Location base-read (inverted=false) rule ───
-- Covers the CI case where 0053 happened to drop the base-read row.
-- WHERE NOT EXISTS is idempotent on a re-run after the wider UNIQUE is added.
INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
  SELECT r.id,
         'read',
         'Location',
         NULL::jsonb,
         NULL::jsonb,
         false
    FROM "roles" r
    WHERE r.name = 'read-only'
      AND NOT EXISTS (
        SELECT 1 FROM "role_permissions" rp
        WHERE rp.role_id = r.id
          AND rp.action = 'read'
          AND rp.subject = 'Location'
          AND rp.inverted = false
      );
--> statement-breakpoint

-- ── Step 4: Ensure the read-only Location banking-redact (inverted=true) rule ─
-- Covers the preview case where 0053 happened to drop the inverted row.
-- Banking-fields-redact list mirrors 0051 Delta 3 exactly.
-- WHERE NOT EXISTS is idempotent on a re-run after the wider UNIQUE is added.
INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
  SELECT r.id,
         'read',
         'Location',
         '["bankingDetails","contractValue","contractTerms","contractDocuments"]'::jsonb,
         NULL::jsonb,
         true
    FROM "roles" r
    WHERE r.name = 'read-only'
      AND NOT EXISTS (
        SELECT 1 FROM "role_permissions" rp
        WHERE rp.role_id = r.id
          AND rp.action = 'read'
          AND rp.subject = 'Location'
          AND rp.inverted = true
      );
--> statement-breakpoint

-- ── Step 5: Add the wider UNIQUE constraint (idempotent) ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_permissions_role_id_action_subject_inverted_unique'
      AND conrelid = 'role_permissions'::regclass
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_role_id_action_subject_inverted_unique"
      UNIQUE ("role_id", "action", "subject", "inverted");
  END IF;
END $$;
