# Handoff — WKG Kiosk Platform (M6 Analytics Port complete, ready for UAT)

**Date:** 2026-04-17
**Status:** M0–M5 merged to `main`. M6 implemented on `m6-analytics-port` branch. Ready for UAT + Playwright E2E + merge.
**Current branch:** `m6-analytics-port` (34 commits ahead of `main`)
**Uncommitted state:** Clean (only `docs/HANDOFF.md` is untracked — by convention).

## TL;DR

M6 Analytics Port is feature-complete: 7 analytics pages, 3 admin pages, export (CSV + branded Excel), weather overlays, impersonation, and a pivot table with drag-and-drop. All 34 implementation commits pass typecheck, 218 unit tests, 75 integration tests. **Next action: run dev server, UAT each page, write Playwright E2E tests, then merge.**

## What's on `m6-analytics-port`

```
ea5880b feat(m6): analytics performance index on transaction_date
d8c44dd feat(m6): branded Excel export API route
ed80297 feat(m6): CSV export API route
1242a10 feat(m6): admin impersonation (view-as) with audit trail
cb35d14 feat(m6): business events + categories admin page
310ce85 feat(m6): outlet exclusions admin page with pattern testing
94183f1 feat(m6): analytics presets admin page (CRUD)
a83b235 feat(m6): pivot table page with drag-and-drop + period comparison
f126ca6 feat(m6): pivot query executor with period comparison
4a5490b feat(m6): pivot engine with column allowlist + crosstab builder
41e8766 feat(m6): trend builder page with weather + event overlays
482339e feat(m6): OpenMeteo weather integration with cache
3a733c2 feat(m6): trend series query function
3081976 feat(m6): trend builder store (pending/applied series split)
5cadacb feat(m6): location groups analytics page with capacity metrics
e0ebe8b feat(m6): regions analytics page
9864a7b feat(m6): hotel groups analytics page
231be9b feat(m6): heat map page with composite score legend + performance table
db5e4e1 feat(m6): heat map query with composite scoring
ebfb224 feat(m6): portfolio analytics page with 6 sections
947bd98 feat(m6): portfolio query functions (Drizzle sql templates)
131b391 feat(m6): shared query helpers (exclusion builder, dimension filters)
ea5d0f8 feat(m6): sidebar analytics + admin sections
26955dd feat(m6): analytics sub-layout with persistent filter bar
d792022 feat(m6): analytics filter bar with URL sync
4d95a06 feat(m6): shared analytics components (KPI card, accordion, chart wrapper, export)
f808a2c feat(m6): date range picker with presets
275de62 feat(m6): multi-select filter component (select-all = visible subset)
9b7993b feat(m6): dimension options loader server action
0552d57 feat(m6): analytics filter store (Zustand) with URL sync
26747c0 feat(m6): analytics metrics (composite score, period change, capacity)
ced5ea1 feat(m6): analytics formatters (GBP, en-GB locale)
5fb2d7f feat(m6): analytics type definitions
ef58947 chore(m6): add recharts, exceljs, date-fns dependencies
```

## Test Results (post-M6)

- **Vitest (unit):** 218 passed / 14 todo / 1 skipped (+68 from baseline)
- **Vitest (integration):** 75 passed (baseline preserved)
- **Typecheck:** clean
- **ESLint:** 41 errors / 142 warnings (0 new errors, +4 warnings from baseline)
- **New test files:** formatters.test.ts (23), metrics.test.ts (18), pivot-engine.test.ts (27)

## What Was Built

### 7 Analytics Pages
- `/analytics/portfolio` — KPI cards, category charts, daily/hourly trends, outlet tiers
- `/analytics/pivot-table` — drag-and-drop crosstab with YoY/MoM comparison
- `/analytics/heat-map` — composite-scored hotel performance matrix
- `/analytics/trend-builder` — multi-series chart + weather/event overlays
- `/analytics/hotel-groups` — group selector → KPIs + hotel breakdown + trends
- `/analytics/regions` — region selector → metrics + group breakdowns
- `/analytics/location-groups` — capacity-normalized metrics + peer analysis

### 3 Admin Pages
- `/settings/analytics-presets` — saved filter presets CRUD
- `/settings/outlet-exclusions` — pattern-based exclusion rules with test
- `/settings/business-events` — event annotations + category management

### Infrastructure
- `src/lib/analytics/` — types, formatters, metrics, queries/, export/, pivot-engine
- `src/lib/stores/analytics-filter-store.ts` — Zustand filter state with URL sync
- `src/lib/stores/trend-store.ts` — series config state (pending/applied split)
- `src/lib/stores/pivot-store.ts` — independent pivot filter + config state
- `src/lib/weather/` — OpenMeteo client + region coordinates
- `src/components/analytics/` — filter bar, multi-select, KPI card, section accordion, export button, impersonation banner
- `src/app/api/export/csv/` + `src/app/api/export/excel/` — streaming export endpoints

### New Dependencies
- `recharts` — charting library
- `exceljs` — branded Excel workbook generation
- `date-fns` — date utilities

### New Migration
- `0012_orange_angel.sql` — standalone index on `sales_records.transaction_date` for date-range scans

## What's NOT Done (needs follow-up)

1. **Playwright E2E tests** — deferred. Need dev server + manual UAT first, then write specs.
2. **Analytics query integration tests** — deferred. Portfolio/heat-map/pivot queries need real DB tests.
3. **Dev server smoke test** — not verified in this session (headless build only).
4. **Merge to main** — pending UAT and E2E test pass.

## How to Resume

```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool
git checkout m6-analytics-port

# 1. State check
git log --oneline -5        # should show ea5880b at HEAD
git status                  # clean except this file

# 2. Dev Postgres
docker ps | grep wkg-pg || docker start wkg-pg

# 3. Apply new migration
npx drizzle-kit migrate

# 4. Start dev server
npm run dev                 # port 3003

# 5. UAT each page in browser
# Visit each analytics page, verify data loads with real sales records
# Test filter bar, date range changes, export downloads
# Test admin pages (presets, exclusions, events)
# Test impersonation (start as admin, verify scope)

# 6. Write Playwright E2E tests (Plan 11, Tasks 11.4-11.7)
# Then merge:
# git checkout main
# git merge --no-ff m6-analytics-port -m "Merge M6: Port Analytics Pages"
```

## Notable Gotchas (M6-specific)

- **Products have no `category` column** — the `products` table only has id/name. Categories were product names in data-dashboard. Filter bar shows product names as "categories".
- **Kiosk count per location not available** — txnPerKiosk is null in heat map. Would need kiosk_assignments aggregation.
- **Pivot SQL uses raw SQL strings** — `buildPivotSQL()` returns a raw SQL string for `db.execute(sql.raw(...))`. Column allowlist prevents injection.
- **Weather uses no DB cache** — fetches from OpenMeteo API directly. The weatherCache table exists but caching logic is future work.
- **Dev server port 3003** — configured in project settings.
