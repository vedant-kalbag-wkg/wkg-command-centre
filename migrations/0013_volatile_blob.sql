CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_record_id" uuid NOT NULL,
	"location_product_id" uuid,
	"gross_amount" numeric(12, 2) NOT NULL,
	"commissionable_amount" numeric(12, 2) NOT NULL,
	"commission_amount" numeric(12, 2) NOT NULL,
	"tier_breakdown" jsonb NOT NULL,
	"tier_version_effective_from" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_sales_record_id_sales_records_id_fk" FOREIGN KEY ("sales_record_id") REFERENCES "public"."sales_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_location_product_id_location_products_id_fk" FOREIGN KEY ("location_product_id") REFERENCES "public"."location_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Wrap existing flat tier arrays into versioned format
UPDATE location_products
SET commission_tiers = jsonb_build_array(
  jsonb_build_object('effectiveFrom', '2020-01-01', 'tiers', commission_tiers)
)
WHERE commission_tiers IS NOT NULL
  AND jsonb_typeof(commission_tiers) = 'array'
  AND jsonb_array_length(commission_tiers) > 0
  AND (commission_tiers->0) ? 'minRevenue';