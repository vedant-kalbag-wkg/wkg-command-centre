-- Add internal_poc_id (assignee / internal point-of-contact) to kiosks and
-- installations so both tables have parity with locations.internal_poc_id
-- for inline-edit "Internal POC" columns.
--
-- internal_poc_id is a nullable text FK to user.id (text, not uuid — Better
-- Auth user IDs are 32-char random strings). ON DELETE SET NULL so deleting
-- a user doesn't cascade-delete kiosks/installations.
ALTER TABLE "kiosks" ADD COLUMN "internal_poc_id" text;--> statement-breakpoint
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_internal_poc_id_user_id_fk" FOREIGN KEY ("internal_poc_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "internal_poc_id" text;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_internal_poc_id_user_id_fk" FOREIGN KEY ("internal_poc_id") REFERENCES "user"("id") ON DELETE SET NULL;
