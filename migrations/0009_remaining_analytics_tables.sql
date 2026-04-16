-- Phase 1 / M1 Task 1.8 — remaining analytics tables ported from data-dashboard:
--   outlet_exclusions        — from 20260223_add_outlet_exclusions.sql
--   event_categories,
--   business_events,
--   analytics_saved_views    (renamed from `saved_views`, + viewType enum),
--   weather_cache            — from 20260317_phase4_trend_builder.sql
--   analytics_presets        — inferred shape (no Supabase source; see design doc)
--   event_log                — inferred shape (no Supabase source; lightweight usage tracking)
--
-- Adaptations: auth.users(uuid) → user.id (text); RLS / is_admin() / auth.uid()
-- policies dropped (our scoping layer handles that). CHECK constraints for
-- text({enum}) columns appended at the bottom — same pattern as 0003/0005/0008.

CREATE TABLE "analytics_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"view_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_saved_views_owner_id_name_unique" UNIQUE("owner_id","name")
);
--> statement-breakpoint
CREATE TABLE "business_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"scope_type" text,
	"scope_value" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#666666' NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action_type" text NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_code" text NOT NULL,
	"pattern_type" text DEFAULT 'exact' NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlet_exclusions_outlet_code_pattern_type_unique" UNIQUE("outlet_code","pattern_type")
);
--> statement-breakpoint
CREATE TABLE "weather_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"data" jsonb NOT NULL,
	"is_forecast" boolean DEFAULT false NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_presets" ADD CONSTRAINT "analytics_presets_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_views" ADD CONSTRAINT "analytics_saved_views_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_exclusions" ADD CONSTRAINT "outlet_exclusions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_saved_views_owner_idx" ON "analytics_saved_views" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "business_events_dates_idx" ON "business_events" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "event_log_user_idx" ON "event_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_log_action_idx" ON "event_log" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "event_log_occurred_idx" ON "event_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "outlet_exclusions_pattern_type_idx" ON "outlet_exclusions" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "outlet_exclusions_outlet_code_idx" ON "outlet_exclusions" USING btree ("outlet_code");--> statement-breakpoint
CREATE INDEX "weather_cache_cached_idx" ON "weather_cache" USING btree ("cached_at");--> statement-breakpoint
ALTER TABLE "outlet_exclusions" ADD CONSTRAINT "outlet_exclusions_pattern_type_check" CHECK ("pattern_type" IN ('exact', 'regex'));--> statement-breakpoint
ALTER TABLE "analytics_saved_views" ADD CONSTRAINT "analytics_saved_views_view_type_check" CHECK ("view_type" IN ('trend', 'pivot', 'heatmap'));--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_scope_type_check" CHECK ("scope_type" IS NULL OR "scope_type" IN ('global', 'hotel', 'region', 'hotel_group'));