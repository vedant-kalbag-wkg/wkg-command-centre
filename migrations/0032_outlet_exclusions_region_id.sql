-- Region-scoped outlet exclusions per audit Task 1.9 (tasks/phase-1-pr-plan.md),
-- PR-6 Part F.
--
-- Background: outlet_exclusions previously matched by outlet_code alone. Now
-- that AU exists (PR #26), outlet codes are no longer globally unique — the
-- same code (e.g. 'Q5') can legitimately appear in UK and DE/ES at the same
-- time. An exclusion that targets one region's 'Q5' must not silently exclude
-- the other region's 'Q5'.
--
-- Resolution: scope each exclusion to exactly one region (FK to regions.id,
-- NOT NULL). The active-locations / buildExclusionCondition predicates match
-- on (outlet_code, region_id) jointly going forward.
--
-- Step 1 — add region_id column nullable so we can backfill in place. Prod
-- has a single existing exclusion (outlet_code='TEST') which matches no
-- active locations across any region; backfilling to UK is safe and is the
-- conservative default for any pre-AU exclusion.
--
-- Step 2 — backfill any NULL region_id to UK.
--
-- Step 3 — flip the column to NOT NULL + add the FK with ON DELETE RESTRICT
-- (deleting a region with live exclusions should fail loud; the admin should
-- reassign or delete the exclusions explicitly).
--
-- Step 4 — replace the old UNIQUE(outlet_code, pattern_type) with
-- UNIQUE(outlet_code, pattern_type, region_id) so the same code can be
-- excluded independently in different regions.

ALTER TABLE "outlet_exclusions" ADD COLUMN "region_id" uuid;
--> statement-breakpoint

UPDATE "outlet_exclusions"
SET "region_id" = (SELECT id FROM "regions" WHERE code = 'UK')
WHERE "region_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "outlet_exclusions" ALTER COLUMN "region_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "outlet_exclusions"
  ADD CONSTRAINT "outlet_exclusions_region_id_regions_id_fk"
  FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "outlet_exclusions"
  DROP CONSTRAINT "outlet_exclusions_outlet_code_pattern_type_unique";
--> statement-breakpoint

ALTER TABLE "outlet_exclusions"
  ADD CONSTRAINT "outlet_exclusions_outlet_code_pattern_type_region_id_unique"
  UNIQUE ("outlet_code", "pattern_type", "region_id");
