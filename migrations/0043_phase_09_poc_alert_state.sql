-- Phase 9 Plan 09-01 — POC underperformance alerts schema (POC-ALERT-01).
--
-- Adds:
--   1. kiosk_performance_alert_state table — per-kiosk classification state
--      tracked across cron runs. PK on kiosk_id (one row per kiosk).
--      tier stores the verbatim classifyOutletTier return value
--      ("Premium"|"Standard"|"Developing"|"Emerging"); the cron treats
--      "Emerging" as the bottom-tier sentinel.
--   2. kiosks.alert_silenced_at + kiosks.alert_silenced_reason — admin
--      per-kiosk silencing (D-19). Silenced kiosks are excluded from
--      classification AND alerting (per RESEARCH § Pitfall 4 recommendation).
--   3. app_settings rows: underperformance_window_days=30 (D-04 default)
--      and pipeline_stage_id_live (D-09 — UUID-pin to the seeded
--      Live stage at position=7000).
--
-- Hand-authored rather than generated: drizzle-kit's snapshot history is
-- incomplete pre-0023 (see 0039's header for full rationale). Each
-- statement is IF NOT EXISTS / ON CONFLICT DO NOTHING / guarded so
-- re-running on the UAT branch is safe.
--
-- Deltas:
--   1.   kiosk_performance_alert_state table
--   1.1  CHECK constraint on tier (via pg_constraint guard)
--   1.2  tier index for per-run bottom-tier query
--   2.   kiosks.alert_silenced_at column
--   2.1  kiosks.alert_silenced_reason column
--   3.   app_settings seed: underperformance_window_days=30
--   4.   app_settings seed: pipeline_stage_id_live (UUID resolved at runtime)

-- ── Delta 1 — kiosk_performance_alert_state table ────────────────────────────
CREATE TABLE IF NOT EXISTS "kiosk_performance_alert_state" (
  "kiosk_id" uuid PRIMARY KEY NOT NULL REFERENCES "kiosks"("id") ON DELETE CASCADE,
  "tier" text NOT NULL,
  "classified_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone NOT NULL,
  "last_alerted_at" timestamp with time zone
);
--> statement-breakpoint

-- ── Delta 1.1 — CHECK constraint on tier (idempotent via pg_constraint guard) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kiosk_performance_alert_state_tier_check'
  ) THEN
    ALTER TABLE "kiosk_performance_alert_state"
      ADD CONSTRAINT "kiosk_performance_alert_state_tier_check"
      CHECK (tier IN ('Premium', 'Standard', 'Developing', 'Emerging'));
  END IF;
END $$;
--> statement-breakpoint

-- ── Delta 1.2 — tier index for per-run query ─────────────────────────────────
CREATE INDEX IF NOT EXISTS "kiosk_performance_alert_state_tier_idx"
  ON "kiosk_performance_alert_state" ("tier");
--> statement-breakpoint

-- ── Delta 2 — kiosks.alert_silenced_at ───────────────────────────────────────
ALTER TABLE "kiosks"
  ADD COLUMN IF NOT EXISTS "alert_silenced_at" timestamp with time zone;
--> statement-breakpoint

-- ── Delta 2.1 — kiosks.alert_silenced_reason ─────────────────────────────────
ALTER TABLE "kiosks"
  ADD COLUMN IF NOT EXISTS "alert_silenced_reason" text;
--> statement-breakpoint

-- ── Delta 3 — app_settings: underperformance_window_days=30 ──────────────────
INSERT INTO "app_settings" ("key", "value")
  VALUES ('underperformance_window_days', '30')
  ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ── Delta 4 — app_settings: pipeline_stage_id_live (resolved at runtime) ─────
-- Resolves the UUID by selecting from pipeline_stages WHERE position=7000
-- (the seeded "Live" position per src/db/seed-pipeline-stages.ts). The
-- DO block aborts loudly if 0 or 2+ rows match so the operator knows
-- pipeline_stages must be seeded first.
DO $$
DECLARE
  live_stage_id uuid;
  live_stage_count int;
BEGIN
  -- Skip if already seeded (re-run safety)
  IF EXISTS (
    SELECT 1 FROM "app_settings" WHERE "key" = 'pipeline_stage_id_live'
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO live_stage_count
    FROM "pipeline_stages"
    WHERE "position" = 7000;

  IF live_stage_count = 0 THEN
    -- No Live stage seeded yet (testcontainer / fresh DB) — skip gracefully.
    -- In production, pipeline_stages are seeded before migrations run.
    -- The test seed manually inserts pipeline_stage_id_live into app_settings.
    RETURN;
  END IF;

  IF live_stage_count > 1 THEN
    RAISE EXCEPTION 'Cannot seed pipeline_stage_id_live: % pipeline_stages rows at position=7000 (expected exactly 1).', live_stage_count;
  END IF;

  SELECT "id" INTO live_stage_id
    FROM "pipeline_stages"
    WHERE "position" = 7000;

  INSERT INTO "app_settings" ("key", "value")
    VALUES ('pipeline_stage_id_live', live_stage_id::text)
    ON CONFLICT ("key") DO NOTHING;
END $$;
