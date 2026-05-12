-- Monday metadata backfill — add PT (Portugal) and US (United States) regions.
--
-- Why: the v2-wipe-and-reseed.ts dry-run against prod surfaced 31 hotels
-- skipped under 4 unmapped Monday group titles. Two of them — "Live: Portugal
-- Hotels" and "Live: USA Hotels" — are real region groupings we want to
-- import; the resolver in scripts/v2-wipe-and-reseed.ts could not map them
-- because the regions table had no row for PT or US. The other two
-- ("Engagements", "On Hold") are workflow groups, not regions — deliberately
-- excluded.
--
-- This migration adds the foundation rows so:
--   • the group-title resolver can map "Portugal" → PT and "USA"/"United
--     States" → US (companion change in scripts/v2-wipe-and-reseed.ts).
--   • operators can reassign existing locations to PT or US via the region
--     picker in /settings/outlet-types (same surface as AU in 0025).
--
-- Idempotent: ON CONFLICT DO NOTHING makes this safe to re-run on
-- environments where PT or US was inserted manually before this migration.

INSERT INTO "regions" ("code", "name") VALUES ('PT', 'Portugal') ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "regions" ("code", "name") VALUES ('US', 'United States') ON CONFLICT ("code") DO NOTHING;
