-- Add Australia region. Foundation for the 9 prod kiosks already tagged
-- region_group='Australia' and the 51 Australia DCM hotels on Monday.
--
-- Existing rows on prod: CZ, DE, ES, IE, UK→GB. Adding AU completes the set
-- so:
--   • placeholder imports from Australia DCM (board 5092887865) can default
--     to AU instead of UK (see src/lib/monday/import-location-products.ts).
--   • operators can reassign existing locations to AU via the region picker
--     in /settings/outlet-types.
--
-- ON CONFLICT DO NOTHING makes this safe to re-run on environments where AU
-- was inserted manually before this migration ran.

INSERT INTO regions (code, name, azure_code)
VALUES ('AU', 'Australia', 'AU')
ON CONFLICT (code) DO NOTHING;
