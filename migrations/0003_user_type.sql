-- Phase 1 / M1 Task 1.2 — add `user_type` enum column to `user` table.
--
-- Drizzle-kit's non-interactive diff engine could not cleanly auto-generate
-- this migration because the schema file already contained pre-existing
-- drift from imported kiosk-management tables (products, providers,
-- location_products, duplicate_dismissals, kiosk_config_groups, app_settings,
-- plus new columns on kiosks / locations) that are out of scope for this
-- task. A `drizzle-kit generate` run prompted interactive column-conflict
-- resolution that would have produced a migration touching many unrelated
-- tables. This custom migration was produced via `drizzle-kit generate
-- --custom --name user_type` and hand-authored to restrict the change to
-- exactly the `user_type` column addition.
--
-- `text` column with CHECK constraint restricting values to the enum set,
-- matching the semantics of Drizzle's `text(..., { enum: [...] })` helper.

ALTER TABLE "user" ADD COLUMN "user_type" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_user_type_check" CHECK ("user_type" IN ('internal', 'external'));
