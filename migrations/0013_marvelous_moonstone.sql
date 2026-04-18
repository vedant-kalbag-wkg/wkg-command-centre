CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "markets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "operating_group_id" uuid;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_operating_group_id_hotel_groups_id_fk" FOREIGN KEY ("operating_group_id") REFERENCES "public"."hotel_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;