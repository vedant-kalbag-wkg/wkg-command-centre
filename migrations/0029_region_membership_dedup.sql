-- Region 1-per-location per audit Resolved Decision D5 (tasks/todo.md).
--
-- Background: the Monday import historically inserted a UK region membership
-- for every active location AND a second membership to the location's real
-- region (DE / ES). Audit found 18 active locations with this {UK, X} shape.
--
-- Resolution (per OQ3): keep the existing composite PK (location_id, region_id)
-- and layer a NEW UNIQUE(location_id) on top so future drift is impossible.
--
-- Step 1 — inline cleanup mirrors scripts/cleanup-bogus-region-memberships.ts
-- so a fresh DB replaying migrations is also clean. Conservative shape: only
-- delete the UK row when the location is active (archived_at IS NULL), has
-- exactly one OTHER region membership, and primary_region_id != UK. This
-- matches every multi-region case found in prod; anything else is left for
-- manual review (the UNIQUE in step 2 will fail loud if any survive).
--
-- Step 2 — add UNIQUE(location_id) so each location has at most one membership.

DELETE FROM "location_region_memberships" lrm
WHERE lrm.region_id = (SELECT id FROM "regions" WHERE code = 'UK')
  AND EXISTS (
    SELECT 1
    FROM "locations" l
    WHERE l.id = lrm.location_id
      AND l.archived_at IS NULL
      AND l.primary_region_id IS NOT NULL
      AND l.primary_region_id <> (SELECT id FROM "regions" WHERE code = 'UK')
  )
  AND (
    SELECT COUNT(*) FROM "location_region_memberships" lrm2
    WHERE lrm2.location_id = lrm.location_id
  ) = 2;
--> statement-breakpoint

ALTER TABLE "location_region_memberships"
  ADD CONSTRAINT "location_region_memberships_location_id_unique"
  UNIQUE ("location_id");
