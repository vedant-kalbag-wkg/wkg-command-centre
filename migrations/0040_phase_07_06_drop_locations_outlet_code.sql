-- Phase 7 / Plan 07-06 — drop locations.outlet_code, introduce monday_item_id,
-- enforce partial uniqueness on (primary_region_id, customer_code).
--
-- Why this migration exists
-- -------------------------
-- The v2 data model says "outlet_code is per-kiosk" — every kiosk on the
-- Monday Assets board carries its own outlet_code1, and the same hotel
-- (location) can have multiple kiosks each with a distinct code. The
-- pre-Phase-7 schema mistakenly mounted `outlet_code` on `locations` (NOT
-- NULL, with a (primary_region_id, outlet_code) unique constraint) which
-- conflated kiosk-level identity with hotel-level identity.
--
-- This migration corrects the model:
--   - locations.outlet_code is dropped entirely. The legacy value (when not
--     a TODO-/MONDAY-/__LOCATION_NEEDED__ placeholder) is preserved as a
--     line in locations.notes for operator audit.
--   - locations.monday_item_id is added — the universal idempotency key the
--     Monday hotel-import path will ON CONFLICT against. Every Monday item
--     has a stable id, so this replaces the (region, outlet_code) compound.
--   - locations.customer_code already exists (added pre-0040 as nullable
--     text, never populated). A partial unique index over
--     (primary_region_id, customer_code) WHERE customer_code IS NOT NULL
--     enforces "one location per RPS account per region" while leaving
--     placeholders (RTL / Heathrow / pre-deployment) free to share NULL.
--
-- Idempotency
-- -----------
-- IF (NOT) EXISTS guards on every DDL — re-running on a database that is
-- already at this revision is a no-op. The legacy outlet_code preservation
-- step in the notes column uses a NULL-safe COALESCE/NULLIF pattern to
-- avoid clobbering existing notes; the WHERE clause ensures we only
-- preserve real codes (not the TODO-/__LOCATION_NEEDED__ placeholders).
--
-- Hand-authored, mirroring the 0039 pattern (drizzle-kit's snapshot history
-- is incomplete pre-0023 so `drizzle-kit generate` against the live schema
-- emits a wholesale rebuild).

-- ── STEP 1 — add monday_item_id (nullable text) ──────────────────────────
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "monday_item_id" text;

-- ── STEP 2 — preserve legacy outlet_code in notes ─────────────────────────
-- Only run when the column still exists (idempotent re-runs against an
-- already-migrated DB skip this). NULLIF on `notes` so a row with empty
-- string notes gets the prefix without a leading newline. WHERE excludes
-- placeholders (TODO-<itemId>, MONDAY-<itemId>, __LOCATION_NEEDED__) — those
-- carry no operator-meaningful information.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'locations' AND column_name = 'outlet_code'
  ) THEN
    UPDATE locations
       SET notes = COALESCE(NULLIF(notes, ''), '')
                   || CASE WHEN COALESCE(NULLIF(notes, ''), '') = '' THEN '' ELSE E'\n\n' END
                   || 'Legacy outlet code (Phase 07-06 migration): ' || outlet_code
     WHERE outlet_code IS NOT NULL
       AND outlet_code <> '__LOCATION_NEEDED__'
       AND outlet_code NOT LIKE 'TODO-%'
       AND outlet_code NOT LIKE 'MONDAY-%';
  END IF;
END $$;

-- ── STEP 3 — drop the (primary_region_id, outlet_code) unique constraint ──
-- The Drizzle table builder named the constraint `locations_region_outlet_unique`
-- (see schema.ts pre-0040). Older databases may carry the long form name
-- `locations_primary_region_id_outlet_code_unique` from a prior generation;
-- guard both.
ALTER TABLE "locations"
  DROP CONSTRAINT IF EXISTS "locations_region_outlet_unique";
ALTER TABLE "locations"
  DROP CONSTRAINT IF EXISTS "locations_primary_region_id_outlet_code_unique";

-- ── STEP 4 — drop the outlet_code column itself ──────────────────────────
ALTER TABLE "locations"
  DROP COLUMN IF EXISTS "outlet_code";

-- ── STEP 5 — partial unique index on (primary_region_id, customer_code) ──
-- Active rows in the same region cannot share a populated customer_code.
-- Placeholders (RTL / Heathrow / pre-deployment) keep customer_code NULL
-- and are exempt from the index.
CREATE UNIQUE INDEX IF NOT EXISTS "locations_region_customer_code_partial_uniq"
  ON "locations" ("primary_region_id", "customer_code")
  WHERE "customer_code" IS NOT NULL;

-- ── STEP 6 — partial unique index on monday_item_id ──────────────────────
-- The hotel-import + heathrow-import + assets-import paths now ON CONFLICT
-- against this column. Partial (NOT NULL) so legacy rows imported before
-- the column existed don't fail the index creation.
CREATE UNIQUE INDEX IF NOT EXISTS "locations_monday_item_id_partial_uniq"
  ON "locations" ("monday_item_id")
  WHERE "monday_item_id" IS NOT NULL;
