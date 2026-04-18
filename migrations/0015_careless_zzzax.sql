CREATE TABLE "experiment_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"location_ids" jsonb NOT NULL,
	"control_type" text DEFAULT 'rest_of_portfolio' NOT NULL,
	"control_location_ids" jsonb,
	"intervention_date" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_cohorts" ADD CONSTRAINT "experiment_cohorts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;