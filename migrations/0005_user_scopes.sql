-- Phase 1 / M1 Task 1.3 — add `user_scopes` table for dimension-based access
-- scoping. Each row = (userId, dimensionType, dimensionId); multiple rows per
-- user = union semantics.
--
-- INVARIANT (documented in src/db/schema.ts and enforced at application layer):
-- users with userType='external' MUST have >=1 row in user_scopes.
--
-- NOTE: drizzle-kit's `text(..., { enum: [...] })` helper enforces the enum
-- at the TypeScript type level only. The CHECK constraint below (hand-appended
-- to the generated migration) enforces it at the DB layer, matching the
-- pattern established by 0003_user_type.sql for `user_user_type_check`.

CREATE TABLE "user_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dimension_type" text NOT NULL,
	"dimension_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "user_scopes_user_id_dimension_type_dimension_id_unique" UNIQUE("user_id","dimension_type","dimension_id")
);
--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_scopes_user_idx" ON "user_scopes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_dimension_type_check" CHECK ("dimension_type" IN ('hotel_group', 'location', 'region', 'product', 'provider', 'location_group'));
