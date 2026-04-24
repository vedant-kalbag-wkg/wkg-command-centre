-- ============================================================================
-- Migration 0018 — NetSuite ETL restructure
--   Design doc:  docs/plans/2026-04-24-netsuite-etl-restructure-design.md
--   Plan (§Phase 1): docs/plans/2026-04-24-netsuite-etl-restructure-plan.md
--
-- This migration:
--   1. Seeds canonical regions + their Azure blob path codes.
--   2. GATES itself on every location being resolvable to a region (via
--      location_region_memberships or kiosk_assignments→kiosks.region_group);
--      refuses to apply with RAISE EXCEPTION if any location is unmapped so
--      we never silently leave primary_region_id blank.
--   3. Wipes sales_records + import staging + commission_ledger — the new
--      sales_records shape is incompatible with historical rows; per the
--      design doc the source of truth is the NetSuite feed which will be
--      re-imported (current file + historical backfill).
--   4. Applies the Drizzle-generated DDL.
--   5. Backfills locations.primary_region_id from the map built in step 2,
--      then drops the deprecated free-text region column.
--   6. Seeds the fee-code fallback table + the etl-system user + the
--      sales_blob_ingestions status CHECK constraint.
--
-- NOTE: _loc_region_map is a TEMP table — it lives for this transaction only,
-- so the post-schema UPDATE below runs in the same txn as the pre-schema
-- safety gate. Do not attempt to run this migration outside a single txn.
-- ============================================================================

-- ============================================================================
-- PRE-SCHEMA: safety gate + data wipe BEFORE any DDL runs
-- ============================================================================

-- 1. Seed canonical regions if missing (no-ops if already present).
--    code is the canonical WKG identifier (UK/IE/DE/ES/CZ); azure_code is
--    the blob path prefix (UK→GB because NetSuite uses "GB", not "UK").
INSERT INTO regions (name, code)
VALUES
  ('United Kingdom', 'UK'),
  ('Ireland',        'IE'),
  ('Germany',        'DE'),
  ('Spain',          'ES'),
  ('Czech Republic', 'CZ')
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint

-- 2. Safety gate: refuse to apply if any location can't be mapped to a region.
--    Resolution precedence:
--      (a) explicit location_region_memberships (most accurate)
--      (b) kiosk_assignments → kiosks.region_group (UK/Prague/Spain/Germany)
--    If neither yields a hit we STOP the migration; a human must fix the
--    Monday.com import or add the membership explicitly before retry.
--
--    Temp table is kept ON COMMIT DROP by default in this transaction, so
--    the post-schema UPDATE below can read it; it vanishes at COMMIT time.
CREATE TEMP TABLE _loc_region_map AS
SELECT
  l.id AS location_id,
  COALESCE(
    (SELECT r.id FROM location_region_memberships lrm
       JOIN regions r ON r.id = lrm.region_id
      WHERE lrm.location_id = l.id LIMIT 1),
    (SELECT r.id FROM kiosk_assignments ka
       JOIN kiosks k ON k.id = ka.kiosk_id
       JOIN regions r ON r.code = CASE k.region_group
           WHEN 'UK'      THEN 'UK'
           WHEN 'Prague'  THEN 'CZ'
           WHEN 'Spain'   THEN 'ES'
           WHEN 'Germany' THEN 'DE'
           ELSE NULL END
      WHERE ka.location_id = l.id LIMIT 1)
  ) AS region_id
FROM locations l;
--> statement-breakpoint

DO $$
DECLARE unresolved int;
BEGIN
  SELECT COUNT(*) INTO unresolved FROM _loc_region_map WHERE region_id IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION
      'Migration blocked: % locations cannot be mapped to a region. Resolve via location_region_memberships or kiosk.region_group before re-running.',
      unresolved;
  END IF;
END$$;
--> statement-breakpoint

-- 3. Wipe existing sales data — the new schema is incompatible with old rows
--    (gross_amount/quantity/discount_* dropped, net_amount+vat_amount required,
--    region_id/netsuite_code NOT NULL). Historical data is re-imported from
--    NetSuite via the backfill CSV; commission_ledger recomputes on first run.
TRUNCATE TABLE sales_records, import_stagings, sales_imports, commission_ledger RESTART IDENTITY CASCADE;
--> statement-breakpoint

-- ============================================================================
-- SCHEMA DDL (drizzle-generated)
-- ============================================================================

CREATE TABLE "product_code_fallbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_name" text NOT NULL,
	"netsuite_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_code_fallbacks_product_name_unique" UNIQUE("product_name")
);
--> statement-breakpoint
CREATE TABLE "sales_blob_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"blob_path" text NOT NULL,
	"blob_date" date NOT NULL,
	"etag" text,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"import_id" uuid,
	"status" text NOT NULL,
	"error_message" text,
	CONSTRAINT "sales_blob_ingestions_region_blob_unique" UNIQUE("region_id","blob_path")
);
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_outlet_code_unique";--> statement-breakpoint
ALTER TABLE "sales_records" DROP CONSTRAINT "sales_records_sale_ref_transaction_date_unique";--> statement-breakpoint
DROP INDEX "sales_sale_ref_idx";--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "outlet_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ALTER COLUMN "ref_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ALTER COLUMN "net_amount" SET NOT NULL;--> statement-breakpoint
-- primary_region_id is added as NULLable first so the pre-existing rows can be
-- backfilled in the POST-SCHEMA section below; we then flip it to NOT NULL.
ALTER TABLE "locations" ADD COLUMN "primary_region_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "netsuite_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_name" text;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "azure_code" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "region_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "vat_amount" numeric(12, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "vat_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "is_booking_fee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "netsuite_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "business_division" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "category_name" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "api_product_name" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sales_records" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "sales_blob_ingestions" ADD CONSTRAINT "sales_blob_ingestions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_blob_ingestions" ADD CONSTRAINT "sales_blob_ingestions_import_id_sales_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."sales_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_blob_ingestions_region_date_idx" ON "sales_blob_ingestions" USING btree ("region_id","blob_date");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_primary_region_id_regions_id_fk" FOREIGN KEY ("primary_region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_region_date_idx" ON "sales_records" USING btree ("region_id","transaction_date");--> statement-breakpoint
CREATE INDEX "sales_region_refno_idx" ON "sales_records" USING btree ("region_id","ref_no");--> statement-breakpoint
CREATE INDEX "sales_region_saleref_idx" ON "sales_records" USING btree ("region_id","sale_ref");--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "gross_amount";--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "discount_code";--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "discount_amount";--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "booking_fee";--> statement-breakpoint
ALTER TABLE "sales_records" DROP COLUMN "sale_commission";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_netsuite_code_unique" UNIQUE("netsuite_code");--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_azure_code_unique" UNIQUE("azure_code");--> statement-breakpoint

-- ============================================================================
-- POST-SCHEMA: backfill primary_region_id, drop deprecated region column,
--              seed fallbacks + etl-system user + status CHECK constraint.
-- ============================================================================

-- Populate locations.primary_region_id from the temp table built pre-schema.
-- (Safe because the pre-schema gate proved every location has a region.)
UPDATE locations
SET primary_region_id = m.region_id
FROM _loc_region_map m
WHERE locations.id = m.location_id;
--> statement-breakpoint

-- Now that every row has a value, enforce NOT NULL + the composite unique.
ALTER TABLE "locations" ALTER COLUMN "primary_region_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_region_outlet_unique" UNIQUE("primary_region_id","outlet_code");--> statement-breakpoint

-- Seed the Azure code defaults (UK→GB per NetSuite convention; IE/DE/ES/CZ
-- match the canonical code today — edit these in-place later via admin UI).
UPDATE regions SET azure_code = 'GB' WHERE code = 'UK' AND azure_code IS NULL;--> statement-breakpoint
UPDATE regions SET azure_code = 'IE' WHERE code = 'IE' AND azure_code IS NULL;--> statement-breakpoint
UPDATE regions SET azure_code = 'DE' WHERE code = 'DE' AND azure_code IS NULL;--> statement-breakpoint
UPDATE regions SET azure_code = 'ES' WHERE code = 'ES' AND azure_code IS NULL;--> statement-breakpoint
UPDATE regions SET azure_code = 'CZ' WHERE code = 'CZ' AND azure_code IS NULL;--> statement-breakpoint

-- Drop the free-text region column (replaced by primary_region_id FK).
ALTER TABLE "locations" DROP COLUMN "region";--> statement-breakpoint

-- Seed product_code_fallbacks for the known fee types (NetSuite emits NULL
-- Code for these ~1300 rows today; parser falls back to these codes). Admin-
-- editable later via updateFeeCodeFallback() which propagates to history.
INSERT INTO product_code_fallbacks (product_name, netsuite_code) VALUES
  ('Booking Fee',       '9991'),
  ('Cash Handling Fee', '9992')
ON CONFLICT (product_name) DO NOTHING;
--> statement-breakpoint

-- Seed the ETL system actor (fixed text UUID so tests + runtime agree on the
-- author of automated imports — Better Auth stores user.id as text).
INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Azure ETL',
  'etl-system@internal.weknowgroup.com',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- CHECK constraint for the text-enum status column (matches 0008/0009 pattern).
ALTER TABLE sales_blob_ingestions
  ADD CONSTRAINT sales_blob_ingestions_status_check
  CHECK (status IN ('success', 'failed'));
