CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_a_id" uuid NOT NULL,
	"location_b_id" uuid NOT NULL,
	"dismissed_by" text NOT NULL,
	"dismissed_by_name" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_config_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kiosk_config_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "location_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_id" uuid,
	"availability" text DEFAULT 'unavailable' NOT NULL,
	"commission_tiers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
-- NOTE: drizzle-kit emitted `ALTER TABLE "user" DROP CONSTRAINT "user_user_type_check"`
-- because the schema.ts `userType: text(..., { enum: [...] })` helper does not
-- serialize into a CHECK constraint in the snapshot, so the 0003 hand-authored
-- CHECK looks like orphaned DB state to the diff engine. We intentionally keep
-- the CHECK in place (it enforces the enum at the DB level) and omit the DROP.
--
-- drizzle-kit also emitted `DROP COLUMN customer_code_1` / `customer_code_2`
-- on kiosks — these legacy columns were created by 0000 but are no longer
-- declared in src/db/schema.ts. Per Task 1.2.5 we do not drop them; the
-- 0004 snapshot reflects schema.ts (no customer_code_1/2) so future diffs
-- won't try to re-drop them. Reconciling these columns is future work.
ALTER TABLE "kiosks" ADD COLUMN "kiosk_config_group_id" uuid;--> statement-breakpoint
ALTER TABLE "kiosks" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "customer_code" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "maintenance_fee" numeric;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "free_trial_end_date" timestamp;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "hardware_assets" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "location_group" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "internal_poc_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_location_a_id_locations_id_fk" FOREIGN KEY ("location_a_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_location_b_id_locations_id_fk" FOREIGN KEY ("location_b_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_dismissals_pair_idx" ON "duplicate_dismissals" USING btree ("location_a_id","location_b_id");--> statement-breakpoint
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_kiosk_config_group_id_kiosk_config_groups_id_fk" FOREIGN KEY ("kiosk_config_group_id") REFERENCES "public"."kiosk_config_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_internal_poc_id_user_id_fk" FOREIGN KEY ("internal_poc_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;