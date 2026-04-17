# M6 Design — Port Analytics Pages

**Date:** 2026-04-17
**Status:** Approved
**Milestone:** M6 (Phase 1, step 6 of design doc)
**Source:** `/Users/vedant/Work/WeKnowGroup/data-dashboard`
**Target:** `/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool`

## Goal

Port all 7 analytics pages and 3 admin pages from data-dashboard into kiosk-tool, rewriting every Supabase RPC call to Drizzle queries via `scopedSalesCondition()`. Full feature parity including export (CSV + branded Excel), weather overlays, business event annotations, and admin impersonation.

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Scope | Full port — all 7 analytics + 3 admin pages | Users expect feature parity; DB layer and scoping are ready |
| Data fetching | Hybrid — server actions for page queries, API routes for export streaming | Matches kiosk-tool convention; export needs HTTP streaming |
| Navigation | `(app)/analytics/*` with sub-layout | Shares auth/sidebar, sub-layout provides persistent filter bar |
| Query approach | Drizzle `sql` templates for analytics, ORM for CRUD | Complex aggregations stay readable; simple ops stay type-safe |
| Charting | Recharts v3 | Matches data-dashboard; React-native composable charts |
| Export | CSV + branded Excel (ExcelJS) | Users rely on existing exports |
| Weather | Port (OpenMeteo API, cached to weatherCache table) | Full feature parity |
| Impersonation | Port (admin "view as" user) | Critical for scope verification and admin support |
| Multi-select UX | "Select All" applies to visible/filtered subset only | User requirement — prevents accidental bulk selection |

## Section 1 — Architecture & Routing

### Analytics pages under `(app)/analytics/`

```
src/app/(app)/analytics/
├── layout.tsx                ← Sub-layout: persistent filter bar + analytics nav context
├── portfolio/page.tsx        ← KPI cards, category charts, daily/hourly trends, outlet tiers
├── pivot-table/page.tsx      ← Drag-and-drop crosstab builder
├── heat-map/page.tsx         ← Composite-scored hotel performance matrix
├── trend-builder/page.tsx    ← Multi-series line chart + weather/events overlays
├── hotel-groups/page.tsx     ← Group selector → KPIs + hotel breakdown + trends
├── regions/page.tsx          ← Region selector → metrics + group breakdowns
└── location-groups/page.tsx  ← Capacity-normalized metrics + peer analysis
```

### Admin pages under `(app)/settings/`

```
src/app/(app)/settings/
├── analytics-presets/        ← CRUD for saved filter presets
├── outlet-exclusions/        ← Pattern-based exclusion rules (exact/regex)
└── business-events/          ← Event annotations for trend charts + category management
```

Existing `/settings/users/[id]` extended with scope/preset assignment.

### Analytics sub-layout

The sub-layout at `analytics/layout.tsx` provides:
- Persistent filter bar: date range picker + dimension multi-selects
- Filter state synced to URL search params (bookmarkable, shareable)
- "Apply" button pattern — filters write to URL, server components re-fetch
- Impersonation banner (shown when admin is viewing as another user)

### Data flow

```
Page (server component) → server action → Drizzle query + scopedSalesCondition() → Postgres
                                          ↑ outlet exclusions applied here too
```

### Export flow

```
Client click → /api/export/csv or /api/export/excel → same query functions → stream response
```

## Section 2 — Data Layer & Query Architecture

### Query modules

```
src/lib/analytics/
├── queries/
│   ├── portfolio.ts          ← Summary KPIs, category breakdown, top products, daily/hourly, outlet tiers
│   ├── heat-map.ts           ← Composite scoring (revenue 30%, txn 20%, rev/room 25%, txn/kiosk 15%, basket 10%)
│   ├── trend-series.ts       ← Time-bucketed metrics with auto-granularity (daily/weekly/monthly)
│   ├── pivot.ts              ← Dynamic crosstab with column allowlist validation
│   ├── hotel-groups.ts       ← Group KPIs, hotel breakdown, temporal trends
│   ├── regions.ts            ← Region metrics, hotel-group/location-group breakdowns
│   ├── location-groups.ts    ← Capacity metrics (rev/room, txn/kiosk), peer analysis
│   └── shared.ts             ← Period-over-period, date bucketing, outlet exclusion WHERE clause
├── formatters.ts             ← Currency (GBP), compact numbers, % change, date formatting
├── metrics.ts                ← Composite score, percentile, tier classification, capacity metrics
├── filters.ts                ← URL ↔ filter state serialization, dimension option loaders
└── export/
    ├── csv-builder.ts        ← Section-based CSV streaming
    └── excel-builder.ts      ← Branded ExcelJS workbook (Azure headers, per-section sheets)
```

### Query pattern

Every analytics query follows this pattern:

1. Receive `AnalyticsFilters` (date range + dimension IDs) and `UserCtx`
2. Call `scopedSalesCondition(userCtx)` → returns scope WHERE clause or undefined (unrestricted)
3. Call `buildExclusionCondition()` → returns outlet exclusion WHERE clause from `outletExclusions` table
4. Execute parameterized `sql` template with scope + exclusion + filter conditions
5. All aggregation happens in Postgres — never pull raw rows to app layer

### Complex queries use `sql` templates

Analytics aggregations (composite scores, pivot crosstabs, period comparisons) use Drizzle's `sql` tagged template literals — parameterized and safe, close to the proven Supabase RPCs.

Simple CRUD (presets, events, exclusions, saved views) uses normal Drizzle ORM.

### Pivot column validation

User-provided column names validated against a strict allowlist before SQL interpolation. Same approach as data-dashboard's `ALLOWED_COLUMNS` + `DERIVED_GROUP_COLUMNS` pattern.

### Performance guards

- Existing indexes: `(locationId, transactionDate)`, `(productId, transactionDate)`, `(providerId, transactionDate)`
- New index: `(transactionDate)` standalone for date-range-only scans
- Heat-map: single query with window functions, not N+1
- Trend: `date_trunc()` in SQL for bucketing, not app-side rebucketing
- Pivot: DB-side conditional aggregation
- Target p95 latencies: portfolio summary < 200ms, heat-map < 500ms, trend series < 300ms

## Section 3 — State Management & Filter Architecture

### Zustand stores

```
src/lib/stores/
├── analytics-filter-store.ts   ← Shared filter state for all analytics pages
├── pivot-store.ts              ← Pivot-specific: row/col/value field configs, independent filters
├── trend-store.ts              ← Series configs, granularity, weather/events toggles
└── impersonation-store.ts      ← Active impersonation state (admin only)
```

### Analytics filter store

- `dateRange: { from: Date, to: Date }` with presets: this-month, last-month, last-3-months, this-quarter, last-quarter, YTD, last-year
- Per-dimension filters: `hotelIds`, `regionIds`, `productIds`, `hotelGroupIds`, `locationGroupIds`, `categoryIds` — all `string[]`
- URL sync: `filtersToSearchParams()` / `searchParamsToFilters()` — bidirectional
- Dimension options filtered by user's `userScopes` (scoped users see only their permitted values)

### Filter bar

Persistent in analytics sub-layout:
- Date range picker (react-day-picker) with preset buttons
- Dimension multi-selects with search — "Select All" selects only the visible/filtered subset
- "Apply" writes to URL → triggers server component re-render

### Trend store (independent)

- Each series captures metric + filters at creation time
- `pendingSeries` / `appliedSeries` split — edits don't re-render until "Apply"
- Granularity: auto (≤31d → daily, ≤90d → weekly, >90d → monthly) / manual override
- Weather + event toggles with category selection
- Preset loading from `analyticsPresets` table

### Impersonation

- Admin "View as" button on user management pages
- Sets httpOnly cookie (`impersonated_user_id`) via server action
- `scopedSalesCondition()` already supports `honorImpersonation` flag
- Banner at top of analytics layout when active, with "Stop" button
- Start/stop logged to `auditLogs`

## Section 4 — UI Components & Dependencies

### New dependency

`recharts@^3` — React charting library (line, bar, area, scatter). Matches data-dashboard.

### Shared analytics components

```
src/components/analytics/
├── filter-bar.tsx              ← Persistent: date range + dimension multi-selects
├── multi-select-filter.tsx     ← Searchable, "Select All" = visible subset only
├── date-range-picker.tsx       ← Calendar + preset buttons
├── kpi-card.tsx                ← Metric + period-over-period % change indicator
├── section-accordion.tsx       ← Collapsible page section wrapper
├── chart-wrapper.tsx           ← Responsive container + loading skeleton
├── export-button.tsx           ← Dropdown: CSV / Excel download triggers
├── impersonation-banner.tsx    ← Top banner when impersonating
└── empty-state.tsx             ← "No data for selected filters" placeholder
```

### Per-page components (colocated in route directories)

- **Portfolio:** AnalyticsSummary, CategoryPerformance, TopProducts, DailyTrends, HourlyDistribution, OutletTiers
- **Pivot Table:** FieldList, DropZones, PivotToolbar, PivotResultTable (uses @dnd-kit)
- **Heat Map:** ScoreLegend, PerformanceTable (Top 20 / Bottom 20 / All Hotels)
- **Trend Builder:** SeriesBuilder, TrendChart, WeatherOverlay, EventAnnotations, GranularitySelector
- **Hotel Groups:** GroupSelector, GroupMetrics, HotelList, TemporalCharts
- **Regions:** RegionSelector, RegionMetrics, HotelGroupBreakdown, LocationGroupBreakdown
- **Location Groups:** LocationSelector, LocationMetrics, CapacityMetrics, PeerAnalysis, HotelBreakdown

### Admin page components

- **Analytics Presets:** PresetsTable, PresetForm (name + filter config)
- **Outlet Exclusions:** ExclusionsList, ExclusionForm (exact/regex pattern + label)
- **Business Events:** EventsList, EventForm, EventCalendar, CategoryManager

### UI conventions

- Tables: TanStack Table with server-side sorting/pagination for large datasets
- Charts: WeKnow brand palette — Azure (#00A6D3), Sea Blue (#008BB2), Night Blue (#0C2752), Night Grey (#575A5C), Mid Grey (#ADADAD) — already defined as `--chart-1` through `--chart-5`
- Loading: Skeleton components matching final layout shape
- Responsive: filter bar collapses to sheet/drawer on mobile
- Empty states: clear message + suggestion to adjust filters

## Section 5 — Navigation & Sidebar

### Updated sidebar structure

```
── Operations ──
  Kiosks
  Locations
  Installations
  Products
  Kiosk Config Groups

── Analytics ──
  Portfolio
  Pivot Table
  Heat Map
  Trend Builder
  Hotel Groups
  Regions
  Location Groups

── Settings ──
  (existing items)
  Analytics Presets         ← new, admin only
  Outlet Exclusions         ← new, admin only
  Business Events           ← new, admin only
```

### Visibility rules

- Analytics section: visible to all internal users (admin, member, viewer)
- Analytics pages respect `userScopes` — scoped users see filtered data, not hidden pages
- Settings admin pages (presets, exclusions, events): admin role only
- External users: portal layout, no sidebar

## Section 6 — Testing Strategy

### Unit tests (Vitest)

- Every query module — mock DB, verify SQL construction and parameter binding
- `formatters.ts` + `metrics.ts` — pure functions, edge cases (zero division, null, empty arrays)
- `filters.ts` — URL serialization roundtrip, partial states, malformed params
- Pivot column allowlist — injection attempts rejected
- Multi-select filter logic — "Select All" on filtered subset vs full list
- Export builders — CSV section formatting, Excel worksheet structure

### Integration tests (Vitest + real Postgres)

- Each query module against seeded data — correct aggregations, scoping, exclusions
- Period-over-period — date arithmetic and comparison values
- Heat-map composite scoring — weighted normalization across 5 metrics
- Pivot crosstab — dynamic columns with various dimension combinations
- Preset/saved-view/event CRUD — full lifecycle
- Impersonation — scope switches correctly, audit trail written
- Performance: `EXPLAIN ANALYZE` assertions on hot query paths

### Playwright E2E

**Core page tests (all 7 analytics pages):**
- Page loads with default filters, renders charts/tables
- Filter bar: change date range → data updates; apply dimension filter → scoped results
- Multi-select: search → "Select All" selects only visible items
- Export: CSV + Excel download, files non-empty

**Pivot Table (thorough):**
- Drag dimension to rows → run → renders correctly
- Drag dimension to columns → column headers match values
- Multiple row + column dimensions → nested grouping
- Add/remove value metrics → columns update
- YoY comparison: enable period toggle → previous period columns appear with correct values
- Month-to-month comparison: monthly buckets, correct values
- Column sorting: click header → ascending → click again → descending
- Column resize: drag border → width persists during session
- Empty result set → appropriate empty state, not broken table
- Large result set → pagination/scroll works, no layout break
- Clear all → resets to empty state
- Run with no fields → validation message, not crash
- Export pivot result → CSV/Excel matches on-screen table

**Trend Builder:**
- Add series → apply → chart renders with correct line
- Toggle weather overlay → temperature data appears
- Toggle business events → annotations render on chart
- Change granularity → chart rebuckets correctly
- Multiple series with different filters → all render correctly

**Dimension pages (hotel-groups, regions, location-groups):**
- Select group → KPIs + breakdown load
- Period comparison shows change indicators
- No selection → overview table visible

**Admin pages:**
- CRUD analytics preset — create, edit, delete, apply to filter bar
- CRUD outlet exclusion — exact + regex patterns, verify analytics pages exclude
- CRUD business event — create with category, verify shows on trend builder

**Impersonation:**
- Admin starts "View as" → banner appears → data scoped to target user
- Navigate analytics pages while impersonating → all scoped correctly
- Stop impersonation → back to admin's full view
- Audit log records start/stop

**Scoping enforcement:**
- Scoped user sees only permitted data across all 7 analytics pages
- Admin with no scopes sees all data
- External user cannot access analytics routes (portal gating)

### Performance targets

- Portfolio summary (124K rows): p95 < 200ms
- Heat-map full hotel list: p95 < 500ms
- Trend series (daily, 12 months): p95 < 300ms
- Pivot crosstab (2 dimensions, 12 months): p95 < 500ms

## What's NOT in M6

- Commission calculations (Phase 3)
- External portal analytics views (Phase 2)
- 1M-row performance seeding (M9)
- CI/CD pipeline (M10)
- Kiosk-hotel temporal attribution enrichment (M7)

## Dependencies on prior milestones

- M1 schema: all analytics tables exist ✓
- M2 scoping: `scopedSalesCondition()` functional ✓
- M3 auth: userType gating, userScopes CRUD ✓
- M4 CSV ingestion: sales data pipeline ✓
- M5 Supabase ETL: 124K sales records + 243 locations + dimensions populated ✓
