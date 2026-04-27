-- Phase 7.6c / D13 — drop the redundant `kiosks.kiosk_config_group_id`.
--
-- Background: kiosk config groups belong to a location (Monday col
-- `1466686598` → `locations.kiosk_config_group_id`). The column on `kiosks`
-- predates that decision and has been a parallel-truth source ever since.
-- All call sites in `src/app/(app)/kiosk-config-groups/actions.ts` were
-- migrated to derive counts from `locations.kiosk_config_group_id` in the
-- same PR; the schema field on `kiosks` is gone in `src/db/schema.ts`. This
-- migration finalises the removal at the DB level.
--
-- Idempotent: `DROP COLUMN IF EXISTS` skips on a fresh DB that already
-- went through the schema rebuild without the column. The FK constraint
-- and index riding on the column drop with it via `CASCADE`.

ALTER TABLE "kiosks"
  DROP CONSTRAINT IF EXISTS "kiosks_kiosk_config_group_id_kiosk_config_groups_id_fk";
--> statement-breakpoint

ALTER TABLE "kiosks"
  DROP COLUMN IF EXISTS "kiosk_config_group_id" CASCADE;
