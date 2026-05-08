-- Phase 7 schema deltas — consolidated migration (Plans 07-02, 07-03, 07-04).
--
-- This migration captures every schema change introduced by Phase 7 that
-- was applied to the UAT branch via raw SQL during plan execution. Plan E
-- (07-05) replays this migration against the prod target to bring the prod
-- schema in line with UAT. Each statement is `IF NOT EXISTS` / idempotent
-- so re-running on the UAT branch (where the changes already exist) is a
-- no-op.
--
-- Hand-authored rather than generated: drizzle-kit's snapshot history is
-- incomplete (snapshots for 0018-0021 and 0024-0038 were never committed),
-- so `drizzle-kit generate` against the live schema.ts surfaces every
-- since-0023 diff as a fresh proposal and prompts for column-rename
-- conflict resolution. Wholesale snapshot rebuild is out of scope for Plan
-- 07-04; this migration contains exactly the three Phase 7 deltas listed
-- below and nothing else.
--
-- Deltas:
--   1. Plan 07-02 (Plan B) — `locations.normalised_name` (text, nullable).
--      Backfilled per-row from `normaliseName(name)` before this migration
--      runs (see scripts/backfill-normalised-names.ts).
--   2. Plan 07-03 (Plan C) — `location_merge_snapshots` table. Stores the
--      pre-merge FK state for N→1 location merges so the undo flow can
--      replay it.
--   3. Plan 07-04 (Plan D) — partial unique index over
--      `locations.normalised_name WHERE archived_at IS NULL`. Active rows
--      may not share a normalised name; archived rows are exempt.

-- ── Delta 1 — locations.normalised_name ────────────────────────────────
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "normalised_name" text;

-- ── Delta 2 — location_merge_snapshots table ──────────────────────────
CREATE TABLE IF NOT EXISTS "location_merge_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_log_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "location_merge_snapshots"
		ADD CONSTRAINT "location_merge_snapshots_audit_log_id_audit_logs_id_fk"
		FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id")
		ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

-- ── Delta 3 — locations.normalised_name partial unique index ──────────
CREATE UNIQUE INDEX IF NOT EXISTS "locations_normalised_name_unique_active"
	ON "locations" ("normalised_name")
	WHERE archived_at IS NULL;
