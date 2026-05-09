-- Phase 9 — shift POC underperformance alerts from kiosk-level to hotel-level.
--
-- Surface change requested in PR #38 follow-up: the email + dashboard reframe
-- the underperformance signal as "these hotels are underperforming" with a
-- composite score sourced from the heat-map default weights. A hotel may host
-- multiple kiosks; the alert is keyed on the location (hotel) rather than the
-- individual kiosk.
--
-- Deltas:
--   1.   location_performance_alert_state table — replaces kiosk_performance_alert_state
--   1.1  CHECK constraint on tier
--   1.2  tier index for per-run bottom-tier query
--   2.   locations.alert_silenced_at + alert_silenced_reason columns
--   3.   Drop kiosk_performance_alert_state (state lives on location now)
--   4.   Drop kiosks.alert_silenced_at + alert_silenced_reason
--   5.   app_settings: composite_score_alert_weights (auditable record of the
--        default heat-map weights as of this migration; runtime still reads
--        the live values from the heat-map module so weight tuning stays in one
--        place — this row is documentation + a snapshot for audit_log readers).
--
-- IF NOT EXISTS / IF EXISTS guards make this safe to re-run on UAT / preview.

-- ── Delta 1 — location_performance_alert_state table ─────────────────────────
CREATE TABLE IF NOT EXISTS "location_performance_alert_state" (
  "location_id" uuid PRIMARY KEY NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "tier" text NOT NULL,
  -- Composite score is the weighted percentile sum (0-100) — recorded on
  -- every run so the operator can see drift in audit history without re-running
  -- the classifier.
  "composite_score" numeric(6, 2) NOT NULL,
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
    WHERE conname = 'location_performance_alert_state_tier_check'
  ) THEN
    ALTER TABLE "location_performance_alert_state"
      ADD CONSTRAINT "location_performance_alert_state_tier_check"
      CHECK (tier IN ('Premium', 'Standard', 'Developing', 'Emerging'));
  END IF;
END $$;
--> statement-breakpoint

-- ── Delta 1.2 — tier index for per-run query ─────────────────────────────────
CREATE INDEX IF NOT EXISTS "location_performance_alert_state_tier_idx"
  ON "location_performance_alert_state" ("tier");
--> statement-breakpoint

-- ── Delta 2 — locations.alert_silenced_at + alert_silenced_reason ────────────
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "alert_silenced_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "alert_silenced_reason" text;
--> statement-breakpoint

-- ── Delta 3 — drop the old kiosk-level state table ───────────────────────────
DROP TABLE IF EXISTS "kiosk_performance_alert_state";
--> statement-breakpoint

-- ── Delta 4 — drop the old kiosk-level silencing columns ─────────────────────
ALTER TABLE "kiosks" DROP COLUMN IF EXISTS "alert_silenced_at";
--> statement-breakpoint
ALTER TABLE "kiosks" DROP COLUMN IF EXISTS "alert_silenced_reason";
--> statement-breakpoint

-- ── Delta 5 — record the composite-score weights snapshot ────────────────────
-- Documentation row only. The cron resolves live weights from
-- src/lib/analytics/queries/heat-map.ts DEFAULT_SCORE_WEIGHTS — admins tune
-- there. Stored as JSON so the audit-log reader can render a verbatim copy of
-- whatever was active at migration time.
INSERT INTO "app_settings" ("key", "value")
  VALUES (
    'composite_score_alert_weights_snapshot',
    '{"revenue":0.30,"transactions":0.20,"revenuePerRoom":0.25,"txnPerKiosk":0.15,"basketValue":0.10,"recordedAt":"2026-05-09"}'
  )
  ON CONFLICT ("key") DO NOTHING;
