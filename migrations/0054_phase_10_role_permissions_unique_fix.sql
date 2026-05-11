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
--   (by created_at). On preview DB, this collapsed the two rules into the
--   non-inverted one, silently dropping the inverted (banking-fields) rule —
--   read-only users would have seen banking columns. (Discovered during 10-13
--   live UAT preflight.)
--
-- This migration:
--   1. DROPs the (role_id, action, subject) UNIQUE constraint.
--   2. Re-INSERTs the dropped read-only Location inverted rule (scoped to
--      the read-only role only — safer than wholesale re-running 0051's INSERTs).
--   3. ADDs the wider UNIQUE constraint on (role_id, action, subject, inverted).
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
-- Idempotent: each DDL step uses DO $$ guards; the data INSERT uses
-- ON CONFLICT DO NOTHING so a re-run after the wider UNIQUE is added is a no-op.

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

-- ── Step 2: Re-insert the dropped read-only Location inverted rule ───────────
-- Banking-fields-redact list mirrors 0051 Delta 3 exactly.
-- The WHERE r.name='read-only' scopes the SELECT to the single intended role.
-- ON CONFLICT DO NOTHING is defensive — the rule should not exist post-0053,
-- but a re-run of THIS migration after the wider UNIQUE is in place must be a no-op.
INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
  SELECT r.id,
         'read',
         'Location',
         '["bankingDetails","contractValue","contractTerms","contractDocuments"]'::jsonb,
         NULL::jsonb,
         true
    FROM "roles" r
    WHERE r.name = 'read-only'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── Step 3: Add the wider UNIQUE constraint (idempotent) ─────────────────────
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
