-- Phase 1 / M1 Task 1.7 — sales-data pipeline tables: `sales_imports`
-- (one row per CSV upload, metadata + status), `import_stagings` (per-row
-- staging area pre-commit for validation/rollback), and `sales_records`
-- (committed fact table, per transaction). Derived from the CSV shape in
-- data-dashboard/test_data.csv.
--
-- NOTE: drizzle-kit's `text(..., { enum: [...] })` helper enforces the enum
-- at the TypeScript type level only. The CHECK constraints appended at the
-- bottom of this migration enforce the same whitelist at the DB layer,
-- matching the pattern established by 0003_user_type.sql and
-- 0005_user_scopes.sql.
--
-- Table ordering: `sales_imports` is created first (no forward FKs);
-- `import_stagings` references it; `sales_records` references it last. Only
-- `sales_records.import_id` points AT `sales_imports` — not the reverse — so
-- there is no circular dependency.

CREATE TABLE "import_stagings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_row" jsonb NOT NULL,
	"parsed_row" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"validation_errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "sales_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"source_hash" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"date_range_start" date,
	"date_range_end" date,
	"status" text DEFAULT 'staging' NOT NULL,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "sales_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid,
	"sale_ref" text NOT NULL,
	"ref_no" text,
	"transaction_date" date NOT NULL,
	"transaction_time" time,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"net_amount" numeric(12, 2),
	"discount_code" text,
	"discount_amount" numeric(12, 2),
	"booking_fee" numeric(12, 2),
	"sale_commission" numeric(12, 2),
	"currency" text DEFAULT 'GBP' NOT NULL,
	"customer_code" text,
	"customer_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_records_sale_ref_transaction_date_unique" UNIQUE("sale_ref","transaction_date")
);
--> statement-breakpoint
ALTER TABLE "import_stagings" ADD CONSTRAINT "import_stagings_import_id_sales_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."sales_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_import_id_sales_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."sales_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staging_import_idx" ON "import_stagings" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "sales_sale_ref_idx" ON "sales_records" USING btree ("sale_ref");--> statement-breakpoint
CREATE INDEX "sales_loc_date_idx" ON "sales_records" USING btree ("location_id","transaction_date");--> statement-breakpoint
CREATE INDEX "sales_prod_date_idx" ON "sales_records" USING btree ("product_id","transaction_date");--> statement-breakpoint
CREATE INDEX "sales_prov_date_idx" ON "sales_records" USING btree ("provider_id","transaction_date");--> statement-breakpoint
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_status_check" CHECK ("status" IN ('staging', 'committed', 'failed', 'rolled_back'));--> statement-breakpoint
ALTER TABLE "import_stagings" ADD CONSTRAINT "import_stagings_status_check" CHECK ("status" IN ('pending', 'valid', 'invalid', 'committed'));