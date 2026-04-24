ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "kiosk_config_group_id" uuid REFERENCES "kiosk_config_groups"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_kiosk_config_group_idx" ON "locations" ("kiosk_config_group_id");
