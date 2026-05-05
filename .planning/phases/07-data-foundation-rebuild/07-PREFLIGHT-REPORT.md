# Phase 7 Pre-Flight Report

**Generated:** 2026-05-05T13:05:35.018Z
**DATABASE_URL host:** ep-blue-bonus-abey47wj.eu-west-2.aws.neon.tech
**BETTER_AUTH_URL:** https://wkg-command-centre.vercel.app\n [PROD]
**ETL_SYSTEM_USER_ID:** `00000000-0000-0000-0000-000000000001`

## Environment Audit

- **PASS** — DATABASE_URL host = ep-blue-bonus-abey47wj.eu-west-2.aws.neon.tech (postgresql://neondb_owner:***@ep-blue-bonus-abey47wj.eu-west-2.aws.neon.tech/neondb?sslmode=verify-full)
- **PASS** — BETTER_AUTH_URL = https://wkg-command-centre.vercel.app\n [PROD]
- **PASS** — MONDAY_API_TOKEN present: true

## Golden Snapshot (DB row counts)

### Wipe-Set Tables

| Table | Total | Active (archived_at IS NULL) |
|-------|-------|------------------------------|
| locations | 403 | 373 |
| kiosks | 442 | 442 |
| products | 119 | n/a |
| providers | 33 | n/a |
| location_products | 2024 | n/a |
| location_groups | 35 | n/a |
| location_group_memberships | 299 | n/a |
| regions | 6 | n/a |
| location_region_memberships | 305 | n/a |
| hotel_groups | 111 | 77 |
| location_hotel_group_memberships | 434 | n/a |
| markets | 0 | n/a |
| location_flags | 0 | n/a |
| sales_records | 95103 | n/a |
| sales_imports | 1 | n/a |
| sales_blob_ingestions | 0 | n/a |
| product_code_fallbacks | 2 | n/a |
| commission_ledger | 0 | n/a |
| audit_logs | 927 | n/a |
| kiosk_assignments | 380 | n/a |
| installations | 1 | n/a |
| installation_kiosks | 0 | n/a |
| installation_members | 0 | n/a |
| milestones | 0 | n/a |
| business_events | 7 | n/a |
| event_log | 0 | n/a |
| merge_proposals | 46 | n/a |
| import_stagings | 0 | n/a |
| weather_cache | 1 | n/a |

### Preserve-Set Tables

| Table | Total |
|-------|-------|
| "user" | 11 |
| account | 10 |
| session | 28 |
| verification | 1 |
| user_scopes | 0 |
| app_settings | 4 |
| pipeline_stages | 9 |
| event_categories | 4 |
| user_views | 0 |
| analytics_saved_views | 0 |
| analytics_presets | 0 |
| duplicate_dismissals | 0 |
| kiosk_config_groups | 33 |
| outlet_exclusions | 1 |
| experiment_cohorts | 0 |
| action_items | 0 |

### Regions Inventory

| id | code | name |
|----|------|------|
| 90c67575-4913-43f6-bc15-fcba2df5e762 | AU | Australia |
| 27e5eddd-dc0c-4d5e-8a15-604e33427d08 | CZ | Czech Republic |
| eaf69684-eacd-497c-a5fe-ab8b88dd5497 | DE | Germany |
| f712f956-5466-4065-8cef-3bb3a8a016ac | ES | Spain |
| 396a86f3-4a5e-4f69-940e-1a135a79d1ed | IE | Ireland |
| 5a7f80de-958e-4e7d-b57e-f90106743eab | UK | United Kingdom |

## Monday Source-of-Truth Inventory

- Total hotel items across boards: 529
- Distinct normalised hotel names: 525
- Same-name groups on Monday boards: 4

| Normalised | Count | Boards | Raw names |
|------------|-------|--------|-----------|
| holiday inn express sydney airport | 2 | 5092887865 | Holiday Inn Express Sydney Airport |
| holiday inn express sydney macquarie park | 2 | 5092887865 | Holiday Inn Express Sydney Macquarie Park |
| melbourne marriott hotel docklands | 2 | 5092887865 | Melbourne Marriott Hotel Docklands |
| novotel london bridge | 2 | 1743012104 | Novotel London Bridge |

## Open Question Resolutions

- **Q1 — Monday hotel item cardinality:** **ANSWERED — 4 same-name group(s) on Monday.** Plan B emits a follow-up flag and Plan C merge UI is required immediately after Plan B.
- **Q2 — Sentinel region:** **ANSWERED — no GLOBAL region row.** Recommend NULL for sentinel primary_region_id (existing region rows: AU, CZ, DE, ES, IE, UK).

## Plan B / Plan E Inputs

```typescript
// Paste these constants into scripts/verify-data-reset.ts (Plan E).
// Revenue = SUM(net_amount + vat_amount) on sales_records — schema columns
// are numeric(12,2) decimal pounds (schema:678). Stored as a string to
// preserve the exact decimal Plan E will compare against.
export const GOLDEN_LOCATIONS_ACTIVE = 373;
export const GOLDEN_KIOSKS_ACTIVE = 442;
export const GOLDEN_SALES_RECORDS = 95103;
export const GOLDEN_TOTAL_REVENUE_GROSS_GBP = "1783083.58";
```
