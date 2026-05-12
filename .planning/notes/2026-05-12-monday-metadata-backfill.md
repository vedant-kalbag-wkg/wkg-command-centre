# Monday metadata backfill — restore the hotel-import enrichment that Phase 07-06 dropped

**Date**: 2026-05-12
**Owner**: vedant
**Status**: SHIPPED 2026-05-12. PR #43. Branch `fix/monday-metadata-import-backfill`.
**Branch**: `fix/monday-metadata-import-backfill` (off `main`, merged shortly after prod cutover)

## Problem

`runHotelLocationImport` (`src/lib/monday/import-hotel-locations.ts`) and `runHeathrowImport` (`src/lib/monday/import-heathrow.ts`) only write 6 identity columns (`name`, `normalised_name`, `customer_code`, `monday_item_id`, `primary_region_id`, `notes`) when inserting into `locations`. They pull `mirror3__1` (customer code) and `location` (used only for region fallback) from Monday — every other Monday column is discarded.

The Monday Live Estate / Ready to Launch / Removed / Australia DCM hotel boards expose 15+ metadata columns the importer ignores (address, lat/lng, hotel_group, launch_phase, key contacts, maintenance fee, free-trial end date, room count, star rating, sourced_by, location_group, live_date, status, SSM group link).

### Prod evidence (2026-05-12, read-only probe)

```
active locations:       510
with monday_item_id:    509 (99.8%)
customer_code           372  72.9%
iana_timezone           510 100.0%   (schema default 'UTC')
monday_item_id          509  99.8%
notes                     4   0.8%   (operator-edited / conflict-recorded)
address                   1   0.2%   (= LOCATION_NEEDED sentinel)
EVERY OTHER FIELD         0    0.0%
```

### Root cause

Phase 07-06 deprecated `scripts/enrich-locations-from-monday.ts` (it was keyed on the now-dropped `locations.outlet_code`) and replaced it with `scripts/v2-wipe-and-reseed.ts`. The replacement carried forward only identity re-derivation. **The metadata-enrichment logic was never re-added to the new importer.** All 15 metadata fields have been NULL on every Monday-derived row since the v2 cutover.

## Monday → locations column map (canonical)

Hotel boards: Live Estate (1356570756), Ready to Launch (1743012104), Removed (5026387784), Australia DCM (5092887865). All four share the column schema below.

| Monday column id | Type | → locations column | Resolution |
|---|---|---|---|
| `location` | LocationValue | `address` + `latitude` + `longitude` | `text` → `address`; parse `value` JSON → lat/lng |
| `group0` | dropdown | `hotel_group` (raw text) + `operating_group_id` (FK) + `location_hotel_group_memberships` (junction) | Parse dropdown into N labels. For each label, upsert into `hotel_groups` by name; insert membership row `(location_id, hotel_group_id)` into `location_hotel_group_memberships` (composite PK, idempotent via `ON CONFLICT DO NOTHING`). Set `locations.hotel_group` to the raw comma-joined text for display. Set `locations.operating_group_id` only when exactly one label; NULL when multi-label (operator can pick a primary via the UI). **Outcome**: analytics scopes via the junction will surface a multi-group hotel under every group it belongs to. |
| `status_17` | status | `launch_phase` | label text |
| `status` | status | `status` | label text |
| `live_date` | date | `live_date` | parse `YYYY-MM-DD [HH:MM]` |
| `key_contact_name` | text | `key_contact_name` | text |
| `key_contact_email` | email | `key_contact_email` | text |
| `finance_contact1` | text | `finance_contact` | text |
| `numbers__1` | numbers | `maintenance_fee` | numeric |
| `date9` | date | `free_trial_end_date` | parse date |
| `number_of_rooms` | numbers | `num_rooms` AND `room_count` (both, schema has both fields) | numeric |
| `rating__1` | rating | `star_rating` | integer 1-5 |
| `label8__1` | status | `sourced_by` | label text |
| `status_11` | status | `location_group` | label text |
| `link_to_ssm_groups__1` | board_relation (→ board 1466686598) | `kiosk_config_group_id` | linked item id → fetch item name from board 1466686598 → lookup `kiosk_config_groups.id` by name (no auto-create) |
| `long_text__1` | long_text | `notes` | text (preserve existing notes if non-NULL) |

### Heathrow board (1356657751) — IN SCOPE

Heathrow has a narrower column set than the hotel boards (no hotel_group, no rating, no room count, no SSM group link, no notes column). Confirmed columns to add to `HEATHROW_ITEM_FRAGMENT`:

| Monday column id | Type | → locations column |
|---|---|---|
| `status` | status | `status` |
| `live_date` | date | `live_date` |
| `numeric` | numbers | `maintenance_fee` (Heathrow uses `numeric`; hotel boards use `numbers__1`) |
| `key_contact_name` | text | `key_contact_name` |
| `key_contact_email` | email | `key_contact_email` |
| `finance_contact1` | text | `finance_contact` |
| `location` | location | `address` + `latitude` + `longitude` |
| `category1` | dropdown | `location_group` (Heathrow uses Category as the equivalent of hotel-board `status_11`) |

Heathrow has no equivalent for `hotel_group`, `launch_phase`, `star_rating`, `num_rooms`, `sourced_by`, `kiosk_config_group_id`, `free_trial_end_date`, `notes` — those stay NULL on Heathrow rows (matches operator reality: airport SSMs aren't hotel-bookings, no rating/rooms; commission/maintenance handled at the Heathrow contract level, not per-kiosk).

Skipped Heathrow columns: `outlet_code1` / `text2` / `checkbox` (kiosk-level, already handled by the kiosk-creation path inside `runHeathrowImport`); `text` (ADN) and `text1` (Credentials) — operational/sensitive, not surfaced on locations; `numbers` (WKL Commission) / `commission_rate` (Hotel Commission) — no schema column, deliberately not exposing in v1; `status_1` (Network) — operational diagnostic, no schema column; `timerange` (Launch timeline) — `live_date` is already the date-precision answer.

## Importer changes

### `src/lib/monday/import-hotel-locations.ts`

1. Extend `HOTEL_ITEM_FRAGMENT` to pull all 15 column ids (plus existing `mirror3__1`). Add typed inline fragments: `... on LocationValue { text lat lng }`, `... on DropdownValue { text }`, `... on StatusValue { label text }`, `... on RatingValue { rating }`, `... on NumbersValue { number }`, `... on DateValue { date }`, `... on BoardRelationValue { linked_item_ids }`.
2. Add pure extractor functions per column type (`extractAddress`, `extractDropdownLabels`, `extractStatusLabel`, `extractDate`, `extractNumber`, `extractRating`, `extractLinkedItemId`).
3. Build two side caches in `runHotelLocationImport`:
   - `hotelGroupNameToId`: `Map<string, string>` — populated lazily, upsert-on-miss into `hotel_groups`.
   - `kioskConfigGroupNameToId`: pre-loaded from existing `kiosk_config_groups` rows; no auto-create.
4. Add a fetch step before the hotel loop: pull SSM-groups-board (1466686598) items (id → name), so each `link_to_ssm_groups__1` linked-item-id can be resolved to a name → kioskConfigGroups.id.
5. `tryInsert` writes all 15 fields on INSERT.
6. Change `onConflictDoNothing` → `onConflictDoUpdate` with `SET field = COALESCE(locations.field, EXCLUDED.field)` for each metadata field. **Fill-NULLs-only semantics**: re-runs and partial syncs won't clobber operator UI edits. Identity columns (name, normalised_name, customer_code, region) are NOT touched on conflict — they stay frozen per the existing contract.
7. Add result counters: `addressesWritten`, `hotelGroupsResolved`, `hotelGroupsUnresolved`, `kioskConfigGroupsResolved`, `kioskConfigGroupsUnresolved`, etc., so the reseed log shows coverage.

### `src/lib/monday/import-heathrow.ts`

1. Extend `HEATHROW_ITEM_FRAGMENT` to add: `status`, `live_date`, `numeric`, `key_contact_name`, `key_contact_email`, `finance_contact1`, `category1` (existing fragment already includes `location`, `outlet_code1`, `text4`).
2. Reuse the extractor functions from `import-hotel-locations.ts` (move them into a new `src/lib/monday/extractors.ts` shared module — both importers import from there).
3. Apply the same fill-NULLs-only `onConflictDoUpdate` shape: identity columns frozen, metadata columns COALESCE-protected.
4. Heathrow has no hotel-group concept and no SSM-group link — skip those resolutions for Heathrow rows.
5. Add metadata coverage to `HeathrowImportResult` (e.g. `addressesWritten`, `liveDatesWritten`).

### `scripts/v2-wipe-and-reseed.ts`

1. Pre-Phase-1 read of `kiosk_config_groups` (preserved across the reseed since it's not in WIPE_TABLES) — pass the name-to-id map into `runHotelLocationImport` via `HotelLocationImportDeps`.
2. The `hotelGroups` upsert happens inside the importer; no orchestrator change beyond passing the deps.
3. Add a pre-Phase-1 SNAPSHOT step: dump every locations row's full metadata to `/tmp/locations-pre-reseed-<timestamp>.json` so a post-reseed diff can identify any operator-only edits that need re-applying. (510 rows × ~25 fields ≈ trivial size.)

## Tests

1. Extend `tests/lib/monday/` — currently has `import-location-products.integration.test.ts`. Add `import-hotel-locations.integration.test.ts` (if missing) covering:
   - INSERT writes all 15 metadata fields when Monday returns full data
   - ON CONFLICT path preserves existing non-NULL values (fill-NULLs-only)
   - Multi-label dropdown → `hotel_group` set, `operating_group_id` NULL
   - Single-label dropdown → both set, hotel_groups upserted once
   - Unresolved SSM Group link → counter incremented, `kiosk_config_group_id` NULL
   - LocationValue without lat/lng → `address` set, lat/lng NULL
2. The existing reseed test (if any) doesn't need changes — it's about transactional correctness, not field coverage.
3. Snapshot fixture: real Monday item shape captured from `inspect-monday-board 1356570756` (already in hand).

## Production cutover (operator-supervised)

1. **Pre-flight on UAT (Neon UAT branch)**:
   a. Snapshot prod locations: `pg_dump --data-only --table=locations <prod-url> > /tmp/locations-prod-snapshot-$(date +%Y%m%d).sql`
   b. Restore the snapshot to UAT.
   c. `DATABASE_URL=<uat> MONDAY_API_TOKEN=<live> npx tsx scripts/v2-wipe-and-reseed.ts --apply --max-csv 1`
   d. Re-run probe-locations-metadata-coverage.ts against UAT; expect ≥90% coverage on `address`, `live_date`, `key_contact_name`, `num_rooms`, `star_rating`, `launch_phase`, `status`, `sourced_by` for active hotel rows.
2. **Prod cutover**: `DATABASE_URL=<prod> MONDAY_API_TOKEN=<live> npx tsx scripts/v2-wipe-and-reseed.ts --apply` during low-traffic window. Snapshot dumps to `/tmp/locations-pre-reseed-*.json` automatically (per the new orchestrator step).
3. **Post-reseed verification**:
   a. Run probe again against prod; confirm coverage matches UAT.
   b. Diff `/tmp/locations-pre-reseed-*.json` against current prod: any row where a field was non-NULL pre-reseed and is now NULL post-reseed represents an operator-only edit (notes on 4 rows, address on the sentinel). Re-apply manually.
   c. Manual UAT in browser: pick 3-5 random locations from different regions, confirm metadata renders on the detail page.

## Decisions locked (2026-05-12 with operator)

1. **Heathrow board metadata** — INCLUDED in V1; column map above.
2. **`people__1`** — SKIPPED. This is the location's POC (often a WKG account-manager), but `locations.internal_poc_id` references our app's `user.id` table (Better Auth users) and Monday's `people__1` references Monday's own user accounts — there's no shared identity to resolve across. Monday has no equivalent for "internal POC" in our DB sense. Leave both `internal_poc_id` and the JSONB `key_contacts` field operator-managed.
3. **Multi-label `hotel_group`** — write all labels into `location_hotel_group_memberships` (junction) so analytics splits across every group. Keep `locations.hotel_group` as raw comma-joined text for display. `locations.operating_group_id` set only when exactly one label (else NULL; operator can pick a primary via the UI).
4. **Snapshot + restore** — pre-reseed JSON dump of full `locations` rows to `/tmp/locations-pre-reseed-<ts>.json`; post-reseed diff identifies operator-edited fields that were wiped (currently 4× `notes` + 1× sentinel `address`) and re-applies them by `monday_item_id` lookup. All highlighted data restored.

## Remaining open questions (low-stakes — proceeding with default unless flagged)

- **Email format for `key_contact_email`** — Monday EmailValue has `email` + `text` fields. Use `text` (matches the importer's existing `cv.text` access pattern). Should be identical content.
- **`status` column collision** — `locations.status` is plain `text` in the schema (no enum constraint, no CHECK). Monday's `status` label ("Live" / "Ready for Launch" / "Removed") writes through cleanly. No other code-path treats it as an enum (verified via grep of `locations.status` references — used only for display).

## Out of scope

- Reverse sync (DB → Monday)
- New columns on locations (we're populating existing schema)
- Importer for the Assets board (kiosks already covered by `runAssetsImport`)
- Migrating any other importer (location-products, sales-csv, etc.)

## Estimated effort

- Importer + tests: 4-6h
- UAT cutover dry-run: 1h
- Prod cutover (operator-supervised): 30-45m
- Total: ~1 working day

## Outcomes (2026-05-12, post-deploy)

Prod state after the reseed against `https://wkg-command-centre.vercel.app`:

- 524 active locations, 523 Monday-sourced (1× `LOCATION_NEEDED` sentinel).
- 16 hotels skipped (workflow groupings `Engagements` + `On Hold` — not real hotels).
- 76 SSM-Group links unresolved (Monday names don't match `kiosk_config_groups` rows — operator triage).

| Field | Coverage |
|---|---|
| `address` | 96.4% |
| `latitude` / `longitude` | 96.2% |
| `hotel_group` | 96.4% |
| `status` | 99.2% |
| `launch_phase` | 97.3% |
| `num_rooms` | 90.5% |
| `key_contact_name` / `key_contact_email` | ~90% |
| `star_rating` | 84.2% |
| `sourced_by` | 81.1% |
| `live_date` | 77.7% |
| `operating_group_id` | 76.0% |
| `location_group` | 75.4% |
| `maintenance_fee` | 55% |
| `kiosk_config_group_id` | 48.7% |
| `free_trial_end_date` | 18.7% |
| `finance_contact` | 18.5% |
| `notes` | 20.2% |

Pre-fix coverage was 0% on every column in the list above.

### Commits (in order)

1. `944d67f` feat(monday-import): shared field extractors for hotel + Heathrow importers
2. `a2d3f3d` feat(monday-import): write 15 metadata fields + multi-group membership
3. `68c08db` feat(monday-import): write 8 metadata fields on Heathrow import
4. `16095c0` feat(v2-wipe-and-reseed): pre-Phase-1 locations snapshot + SSM-Group map
5. `0664c2c` feat(v2-wipe-and-reseed): restore-locations-operator-edits script + tests
6. `bc88b1b` chore: strip stray NUL bytes from restore-locations-operator-edits.ts
7. `1adc999` feat(monday-import): add PT + US regions + extend group-title resolver
8. `01add90` feat(v2-wipe-and-reseed): auto-seed kiosk_config_groups + canonicalise
9. `946cc2e` fix(monday-import): address PR #43 review feedback (6 items)
10. `f5fe249` fix(v2-wipe-and-reseed): guard `main()` behind entry-point check

### Migration state

Prod `__drizzle_migrations` was at id 43 pre-cutover with 0043-0049 pending in the repo (0046-0049 had been hand-applied out-of-band). `drizzle migrate()` brought prod to id 51 including the new `migrations/0050_monday_metadata_pt_us_regions.sql` (adds PT + US to `regions`; top-of-file comment explains intentional NULL `azure_code`).
