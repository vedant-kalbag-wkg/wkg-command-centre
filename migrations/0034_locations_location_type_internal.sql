-- D9 / Task 4.6 — Tag the BK 'Customer Service' refund-handling outlet as
-- 'internal' so analytics queries exclude it from leaderboards by default.
--
-- Background: locations.location_type is text (constrained by a CHECK in
-- migration 0024, not a PG enum). To accept the new 'internal' value we
-- rebuild the CHECK constraint, then update the single row that matches.
-- Pure data migration otherwise — no DDL on the column itself.
--
-- The UPDATE is idempotent: re-runs are no-ops because the predicate
-- requires location_type = 'retail_desk', which the first run flips to
-- 'internal'. Safe to replay against any environment.

ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_location_type_check";
--> statement-breakpoint

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_location_type_check"
  CHECK (location_type IS NULL OR location_type IN ('hotel','retail_desk','online','airport','hex_kiosk','internal'));
--> statement-breakpoint

UPDATE "locations"
   SET "location_type" = 'internal'
 WHERE "outlet_code" = 'BK'
   AND "name" = 'Customer Service'
   AND "location_type" = 'retail_desk';
