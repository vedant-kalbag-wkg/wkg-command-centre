ALTER TABLE "locations" ADD COLUMN "outlet_code" text;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_outlet_code_unique" UNIQUE("outlet_code");--> statement-breakpoint
ALTER TABLE "sales_imports" ADD CONSTRAINT "sales_imports_source_hash_unique" UNIQUE("source_hash");