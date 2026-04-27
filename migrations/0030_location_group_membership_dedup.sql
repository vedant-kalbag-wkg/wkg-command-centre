-- Location-group 1-per-location per audit Resolved Decision D5 (tasks/todo.md),
-- PR-6 Part B. Mirror of region-side fix in 0029.
--
-- Background: the Monday import historically inserted a UK city-group
-- membership for every active location AND a second membership to the
-- location's real city group. Audit found 19 active locations with this shape
-- (18 non-UK regions paired with a spurious UK city group; 1 UK location with
-- two UK city groups).
--
-- Resolution (per OQ3): keep the existing composite PK
-- (location_id, location_group_id) and layer a NEW UNIQUE(location_id) on top
-- so future drift is impossible. Same shape as 0029.
--
-- Step 1 — inline cleanup mirrors
--   scripts/cleanup-multi-location-group-memberships.ts so a fresh DB
-- replaying migrations is also clean. Selection rule (per Part B handoff):
--
--   For each multi-LG active location, compute the MODAL primary_region_id
--   among each candidate group's OTHER active members. Keep the membership
--   whose group's modal region matches the location's own primary_region_id;
--   delete the others.
--
--   Tie-breakers (rare):
--     (a) prefer the group whose name appears in the location's name
--         (case-insensitive substring),
--     (b) then the membership with MIN(created_at).
--
-- Step 2 — add UNIQUE(location_id) so each location has at most one location
-- group; the fix is enforced going forward.

WITH multi_loc AS (
  SELECT l.id AS location_id, l.name AS location_name, l.primary_region_id
  FROM "locations" l
  WHERE l.archived_at IS NULL
    AND l.primary_region_id IS NOT NULL
    AND (
      SELECT COUNT(*) FROM "location_group_memberships" lgm
      WHERE lgm.location_id = l.id
    ) > 1
),
candidate AS (
  SELECT
    m.location_id,
    m.location_name,
    m.primary_region_id,
    lgm.location_group_id,
    lg.name AS group_name,
    lgm.created_at,
    -- modal primary_region_id among the group's OTHER active members
    (
      SELECT l2.primary_region_id
      FROM "location_group_memberships" lgm2
      JOIN "locations" l2 ON l2.id = lgm2.location_id
      WHERE lgm2.location_group_id = lgm.location_group_id
        AND lgm2.location_id <> m.location_id
        AND l2.archived_at IS NULL
        AND l2.primary_region_id IS NOT NULL
      GROUP BY l2.primary_region_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS modal_region_id
  FROM multi_loc m
  JOIN "location_group_memberships" lgm ON lgm.location_id = m.location_id
  JOIN "location_groups" lg ON lg.id = lgm.location_group_id
),
ranked AS (
  -- Pick winner per location. Stage 1: candidates whose modal matches the
  -- location's primary region (modal_match=1). Stage 2 ties: substring match
  -- (name_match=1). Stage 3: earliest created_at.
  SELECT
    c.*,
    (CASE WHEN c.modal_region_id = c.primary_region_id THEN 1 ELSE 0 END) AS modal_match,
    (CASE WHEN POSITION(LOWER(c.group_name) IN LOWER(c.location_name)) > 0 THEN 1 ELSE 0 END) AS name_match,
    ROW_NUMBER() OVER (
      PARTITION BY c.location_id
      ORDER BY
        (CASE WHEN c.modal_region_id = c.primary_region_id THEN 1 ELSE 0 END) DESC,
        (CASE WHEN POSITION(LOWER(c.group_name) IN LOWER(c.location_name)) > 0 THEN 1 ELSE 0 END) DESC,
        c.created_at ASC,
        c.location_group_id ASC  -- final stable tiebreak so SQL is deterministic
    ) AS rn
  FROM candidate c
)
DELETE FROM "location_group_memberships" lgm
USING ranked r
WHERE r.location_id = lgm.location_id
  AND r.location_group_id = lgm.location_group_id
  AND r.rn > 1;
--> statement-breakpoint

ALTER TABLE "location_group_memberships"
  ADD CONSTRAINT "location_group_memberships_location_id_unique"
  UNIQUE ("location_id");
