-- D6 / Task 2.12 — Per-location IANA timezone for hour-of-day analytics.
--
-- Background: the Hourly Distribution widget (and the Pivot Table's
-- `sale_hour` derived dimension) buckets sales by EXTRACT(HOUR FROM
-- transaction_time) — i.e. naïve UTC. For non-UK locations the displayed
-- peak hour is shifted by their UTC offset, which makes the widget
-- meaningless for DE/ES/CZ/IE/AU. D6 mandates per-location IANA timezone
-- support so the SELECT can do `((transaction_date + transaction_time) AT
-- TIME ZONE 'UTC') AT TIME ZONE l.iana_timezone` and bucket by local hour.
--
-- This migration:
--   1. Adds locations.iana_timezone TEXT NOT NULL DEFAULT 'UTC'.
--   2. Backfills it from the location's primary region (region.code).
--      Mapping is the canonical one location admins agreed on for D6:
--        UK → Europe/London    ES → Europe/Madrid   DE → Europe/Berlin
--        CZ → Europe/Prague    IE → Europe/Dublin   AU → Australia/Sydney
--      US (Miami) is omitted: no US region currently exists. If/when it
--      lands, set it to America/New_York at that point. Anything that fails
--      to match keeps the 'UTC' default (safe — same behaviour as today).
--   3. Seeds an admin setting `analytics_display_timezone` in the existing
--      app_settings key/value table (see schema.ts:98). Default 'local'
--      means "use each location's iana_timezone"; 'utc' restores the old
--      naïve behaviour for debugging.
--
-- No app_settings table is created here — it already exists from migration
-- 0014 (D-13 board ID persistence). Reusing it keeps the settings surface
-- small (one row per global flag) and avoids fragmenting admin-config state.

ALTER TABLE "locations" ADD COLUMN "iana_timezone" text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint

-- Region-default backfill. Each UPDATE is a no-op if the region row doesn't
-- exist on the target DB (subselect returns NULL → predicate is unknown →
-- zero rows updated). This makes the migration safe to replay against any
-- subset of regions.
UPDATE "locations" SET "iana_timezone" = 'Europe/London'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'UK');
--> statement-breakpoint
UPDATE "locations" SET "iana_timezone" = 'Europe/Madrid'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'ES');
--> statement-breakpoint
UPDATE "locations" SET "iana_timezone" = 'Europe/Berlin'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'DE');
--> statement-breakpoint
UPDATE "locations" SET "iana_timezone" = 'Europe/Prague'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'CZ');
--> statement-breakpoint
UPDATE "locations" SET "iana_timezone" = 'Europe/Dublin'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'IE');
--> statement-breakpoint
UPDATE "locations" SET "iana_timezone" = 'Australia/Sydney'
  WHERE "primary_region_id" = (SELECT "id" FROM "regions" WHERE "code" = 'AU');
--> statement-breakpoint

-- Admin display flag. ON CONFLICT keeps the existing value if an operator
-- has already toggled it (replay-safe).
INSERT INTO "app_settings" ("key", "value")
  VALUES ('analytics_display_timezone', 'local')
  ON CONFLICT ("key") DO NOTHING;
