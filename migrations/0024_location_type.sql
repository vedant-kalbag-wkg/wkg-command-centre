-- Location type — powers the Location Type analytics filter + the
-- unmapped-outlets admin page.
--
-- Values:
--   'hotel'       — imported from one of the Monday hotel boards (Live
--                   Estate / Ready to Launch / Removed / Australia DCM).
--   'retail_desk' — WKG-operated retail touchpoint that isn't a hotel
--                   kiosk (e.g. Customer Service/BK). Manual mapping.
--   'online'      — online-only outlets (outlet_code 'IN' / "Internet").
--   'airport'     — airport terminal kiosks (Heathrow T2-T5, mobile desks,
--                   underground). Default suggestion for unmapped codes.
--   'hex_kiosk'   — Heathrow Express dedicated kiosks (Hex SSM H0-Hx).
--
-- NULL means "not yet categorised" — surfaced to admins for mapping.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "location_type" text;
--> statement-breakpoint

ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_location_type_check";
--> statement-breakpoint

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_location_type_check"
  CHECK (location_type IS NULL OR location_type IN ('hotel','retail_desk','online','airport','hex_kiosk'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "locations_location_type_idx"
  ON "locations" ("location_type");
