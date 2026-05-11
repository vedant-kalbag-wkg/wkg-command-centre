-- Phase 10 (Plan 10-02) — Access Control Extended: roles + role_permissions + user_roles schema
--
-- DDL-only migration. Companion files:
--   0051: data — seed default roles + role_permissions + backfill user_roles + user_scopes.role_id
--   0052: operator-gated — user_scopes.role_id SET NOT NULL (see Pitfall 6 — split per
--         RESEARCH.md §Migration ordering; mirrors 0048 house style)
--
-- user.role text column is NOT dropped (RESEARCH.md Q1 reverses CONTEXT decision —
-- Better Auth admin plugin reads session.user.role text in 12 endpoint handlers).
--
-- Idempotent: every CREATE TABLE / ADD COLUMN / CREATE INDEX is IF [NOT] EXISTS.
-- Safe to re-run on UAT / preview.
--
-- Deltas:
--   1.   roles table
--   1.1  role_permissions table + role_permissions_role_idx
--   2.   user_roles table + uniq(user_id, role_id) + user_roles_user_idx
--   3.   user_scopes — ADD COLUMN role_id uuid (nullable; backfilled in 0051)

-- ── Delta 1 — roles table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "kind" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'roles_kind_check'
  ) THEN
    ALTER TABLE "roles"
      ADD CONSTRAINT "roles_kind_check"
      CHECK (kind IN ('system', 'tier', 'custom'));
  END IF;
END $$;
--> statement-breakpoint

-- ── Delta 1.1 — role_permissions table + role_idx ────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "subject" text NOT NULL,
  "fields" jsonb,
  "conditions" jsonb,
  "inverted" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "role_permissions_role_idx"
  ON "role_permissions" ("role_id");
--> statement-breakpoint

-- ── Delta 2 — user_roles table + uniq + idx ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "assigned_at" timestamptz DEFAULT now() NOT NULL,
  "assigned_by" text REFERENCES "user"("id")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_role_id_unique'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_user_id_role_id_unique"
      UNIQUE ("user_id", "role_id");
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_roles_user_idx"
  ON "user_roles" ("user_id");
--> statement-breakpoint

-- ── Delta 3 — user_scopes.role_id ADD COLUMN (nullable) ──────────────────────
ALTER TABLE "user_scopes"
  ADD COLUMN IF NOT EXISTS "role_id" uuid REFERENCES "roles"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Old uniq(user_id, dimension_type, dimension_id) is implicitly superseded by
-- the new (user_id, role_id, dimension_type, dimension_id). We keep the old
-- one in place during 0051 backfill (rows pre-cutover have role_id IS NULL,
-- so they don't collide). 0052 (if shipped) replaces the constraint.
-- Adding the new uniq here would conflict with NULL role_id rows pre-backfill;
-- defer to 0052.
