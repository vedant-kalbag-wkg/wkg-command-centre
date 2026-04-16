CREATE TABLE "hotel_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_group_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "hotel_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "location_group_memberships" (
	"location_id" uuid NOT NULL,
	"location_group_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "location_group_memberships_location_id_location_group_id_pk" PRIMARY KEY("location_id","location_group_id")
);
--> statement-breakpoint
CREATE TABLE "location_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "location_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "location_hotel_group_memberships" (
	"location_id" uuid NOT NULL,
	"hotel_group_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "location_hotel_group_memberships_location_id_hotel_group_id_pk" PRIMARY KEY("location_id","hotel_group_id")
);
--> statement-breakpoint
CREATE TABLE "location_region_memberships" (
	"location_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "location_region_memberships_location_id_region_id_pk" PRIMARY KEY("location_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "regions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "hotel_groups" ADD CONSTRAINT "hotel_groups_parent_group_id_hotel_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."hotel_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_groups" ADD CONSTRAINT "hotel_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_group_memberships" ADD CONSTRAINT "location_group_memberships_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_group_memberships" ADD CONSTRAINT "location_group_memberships_location_group_id_location_groups_id_fk" FOREIGN KEY ("location_group_id") REFERENCES "public"."location_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_groups" ADD CONSTRAINT "location_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hotel_group_memberships" ADD CONSTRAINT "location_hotel_group_memberships_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hotel_group_memberships" ADD CONSTRAINT "location_hotel_group_memberships_hotel_group_id_hotel_groups_id_fk" FOREIGN KEY ("hotel_group_id") REFERENCES "public"."hotel_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_region_memberships" ADD CONSTRAINT "location_region_memberships_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_region_memberships" ADD CONSTRAINT "location_region_memberships_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lgm_location_group_idx" ON "location_group_memberships" USING btree ("location_group_id");--> statement-breakpoint
CREATE INDEX "lhg_hotel_group_idx" ON "location_hotel_group_memberships" USING btree ("hotel_group_id");--> statement-breakpoint
CREATE INDEX "lrm_region_idx" ON "location_region_memberships" USING btree ("region_id");