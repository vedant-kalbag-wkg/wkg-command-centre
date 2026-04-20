# Vercel Bug Sweep 2026-04-20 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to dispatch parallel subagents per wave.

**Goal:** Fix 15 reported issues on the deployed Vercel app and ship them as one reviewable PR.

**Architecture:** Each item is its own commit on `fix/vercel-bug-sweep-20260420`. Independent items run in parallel subagents grouped by wave; file-overlapping items serialize. Playwright smoke per user-visible change.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM (Postgres), better-auth, Zustand, shadcn/ui, react-big-calendar, recharts, Playwright.

**Branch:** `fix/vercel-bug-sweep-20260420` (cut).

---

## Wave layout (parallelism map)

| Wave | Items | Rationale |
|---|---|---|
| 1 | #3, #4, #5, #9, #14, #15 | Independent files, no shared state; fastest path |
| 2 | #8, #10, #11, #13 | Analytics features on separate subtrees |
| 3 | #7 | Depends on #8 landing first (mirrors high → low) |
| 4 | #12 | Cross-cutting abort wiring; safer after analytics changes settle |
| 5 | #1, #6 | Monday import changes — shared file `scripts/import-from-monday.ts` |
| 6 | #2 | Large scope — inline editing across app; touches many tables |

Waves 1 + 2 can overlap in time (different subtrees). Wave 3 waits for #8 merge. Waves 5 and 6 may land sequentially with their own subagents.

---

## Wave 1 — Independent bugfixes

### Task 1 — #3 Redirect to /installations after save

**Files:** `src/app/(app)/installations/new/` — page/client component where `createInstallation` action is awaited. Also `src/app/(app)/installations/actions.ts` if redirect lives server-side.

**Steps:**
1. Locate the form submit handler. If it uses a server action, call `redirect('/installations')` after insert. If client-side, call `router.push('/installations')` after successful response + `router.refresh()`.
2. Playwright: fill form → submit → assert URL is `/installations`.
3. Commit: `fix(installations): redirect to /installations after creating new installation`

### Task 2 — #4 Theme react-big-calendar toolbar

**Files:** `src/components/calendar/calendar-view.tsx` (+ any global CSS for rbc-*).

**Steps:**
1. Provide a custom `components.toolbar` prop to `<Calendar>`. Render shadcn `Button` (variant="ghost"/size="sm") for `<`, today, `>`. Render a `ToggleGroup` for Month/Week/Day with `size="sm"`, active item uses `bg-primary text-primary-foreground`.
2. Remove default `.rbc-toolbar button` overrides if any conflict.
3. Playwright: visit `/installations` → calendar tab → screenshot button row.
4. Commit: `fix(calendar): theme toolbar buttons to match shadcn style tokens`

### Task 3 — #5 Products row click + remove stale toast

**Files:** `src/app/(app)/products/page.tsx`, any products table client, and the place showing the "Edit product coming soon" toast.

**Steps:**
1. Find `toast("... coming soon")` call — delete it; keep the navigation.
2. Make the row `onClick` navigate to `/products/[id]` (clicking anywhere on row except explicit action controls).
3. Playwright: click product row → assert path `/products/<id>`; click Edit → no toast, page renders.
4. Commit: `fix(products): make row click navigate to product detail and drop stale edit-coming-soon toast`

### Task 4 — #9 Remove Apply Filters button; auto-apply on change

**Files:** `src/components/analytics/filter-bar.tsx`, `src/lib/stores/analytics-filter-store.ts`.

**Steps:**
1. Delete the `Apply Filters` `<Button>`.
2. In each `MultiSelectFilter` / `DateRangePicker` `onChange`, after setting store, immediately `router.replace(\`?${filtersToSearchParams(store).toString()}\`)`. Wrap in `useTransition` + a small `useDebouncedCallback` (100–150 ms) to avoid URL thrash on rapid toggles.
3. Retain Reset button.
4. Playwright: change any filter → URL reflects change within 300 ms; no Apply button present.
5. Commit: `fix(analytics/filter-bar): auto-apply filters on change and remove Apply button`

### Task 5 — #14 Maturity buckets from selected end date

**Files:** `src/app/(app)/analytics/maturity/actions.ts` (and any shared helper in `src/lib/analytics/maturity.ts`).

**Steps:**
1. Find the `EXTRACT(EPOCH FROM (NOW() - min_live_date)) / 86400 <= 30` family. Replace `NOW()` with the query's end-date param.
2. Ensure the SQL param ordering is correct; add param if missing.
3. Unit-test the bucket helper if one exists (`maturity-bucket.test.ts`).
4. Playwright: pick date range ending 2025-06-01 on /analytics/maturity → buckets are not all 0-30d; seed 1 kiosk live on 2025-01-01 → asserts 120-180d bucket.
5. Commit: `fix(analytics/maturity): compute buckets relative to selected end date instead of NOW()`

### Task 6 — #15 Pivot table 500

**Files:** `src/app/(app)/analytics/pivot-table/actions.ts` + `page.tsx`.

**Steps:**
1. Reproduce locally (`npm run dev`, navigate, run a simple query).
2. Capture server stack from terminal / `.next` logs.
3. Likely culprits: (a) `outlet_exclusions` param shape; (b) server-action returning non-serializable (Date/BigInt); (c) the `LIMIT 10001` overlay on a GROUP BY with nulls. Fix root cause.
4. Add a regression unit test / server-action smoke test.
5. Playwright: run a trivial pivot query, no red banner.
6. Commit: `fix(analytics/pivot-table): fix 500 server components render on simple query`

---

## Wave 2 — Analytics features

### Task 7 — #8 Revenue/Room KPI

**Files:** `src/app/(app)/analytics/portfolio/high-performer-patterns.tsx`, `src/app/(app)/analytics/portfolio/actions.ts`, `src/lib/analytics/types.ts`.

**Steps:**
1. Add `greenRevenueTotal` + `greenRoomTotal` (or a pre-computed `avgRevenuePerRoom`) to `HighPerformerPatterns` data shape. Compute in the action.
2. Swap the KPI tile from "Avg Kiosks / Location" to "Avg Revenue / Room", formatted with `formatCurrency`.
3. Playwright: load portfolio → KPI label reads "Avg Revenue / Room" and renders a currency value.
4. Commit: `feat(analytics/portfolio): replace Kiosks/Location KPI with Revenue/Room`

### Task 8 — #10 Configurable heat-map weights

**Files:** `src/app/(app)/analytics/heat-map/page.tsx`, `src/app/(app)/analytics/heat-map/score-legend.tsx` (replace with `weight-editor.tsx`), `src/app/(app)/analytics/heat-map/actions.ts`, `src/lib/analytics/types.ts`, new `src/lib/stores/heatmap-weights-store.ts`.

**Steps:**
1. Create Zustand store `heatmap-weights-store.ts` with integer percentages keyed by the 5 metrics + reset to default (30/20/25/15/10).
2. Build `WeightEditor` component: 5 number inputs, live sum indicator, red banner when sum ≠ 100, "Apply" button disabled until sum = 100, Reset link restores defaults. Render a full-width horizontal stacked bar (flex row; each segment flex-basis = weight%) with distinct color per metric + label overlay.
3. Wire `fetchHeatMap` action to accept weights param; default = current fixed values.
4. Replace usage of `ScoreLegend` with `WeightEditor`.
5. Playwright: load /analytics/heat-map → edit a weight → bar redraws; force sum ≠ 100 → Apply disabled + red banner; Reset returns 30/20/25/15/10.
6. Commit: `feat(analytics/heat-map): configurable composite score weights with horizontal stacked bar`

### Task 9 — #11 Trend builder weather gating

**Files:** `src/app/(app)/analytics/trend-builder/series-row.tsx`, `series-builder-panel.tsx`, `actions.ts`, weather fetch helper.

**Steps:**
1. In `series-row.tsx` derive `weatherAllowed = selectedLocationGroupIds.length === 1`. Base this on per-series filter OR the global filter bar's Location Groups — whichever resolves to exactly one group.
2. Disable the weather toggle when `!weatherAllowed`; show shadcn `Tooltip` on the disabled control: "Weather requires exactly one location group selected".
3. When weather is on, resolve the group → representative location (e.g. group centroid, or the first location's lat/lng from the group) → fetch weather using those coords.
4. Playwright: add two groups to series → weather disabled; pick one group → weather enables; toggle on → chart renders weather line.
5. Commit: `feat(analytics/trend-builder): gate weather series on exactly one location group selection`

### Task 10 — #13 Hotel/Location group selector names + empty-state overlay

**Files:**
- `src/app/(app)/analytics/hotel-groups/page.tsx`, `group-selector.tsx`
- `src/app/(app)/analytics/location-groups/page.tsx`, `location-selector.tsx`
- `src/components/analytics/empty-state.tsx` (reuse; no edits)

**Steps:**
1. Inspect the selectors — they should be binding on `group.id` but displaying `group.name`. Fix the `<SelectItem>` label / command-menu item text to use `name`.
2. On initial load, no group is pre-selected. Render the Regions-style `<EmptyState>` overlay with copy: "Select a hotel group to view reports" / "Select a location group to view reports".
3. Move the selector to the same spot as the regions page (likely top-right under the page header).
4. Playwright: visit each page → overlay visible + selector top-right with group names; pick a group → overlay dismisses, metrics render.
5. Commit: `fix(analytics/groups): show names instead of UUIDs and add empty-state overlay until a group is picked`

---

## Wave 3 — Depends on Wave 2

### Task 11 — #7 Low Performer Patterns + configurable R/Y/G threshold

**Files:**
- Create `src/app/(app)/analytics/portfolio/low-performer-patterns.tsx`
- Modify `src/app/(app)/analytics/portfolio/actions.ts`, `page.tsx`, `src/lib/analytics/types.ts`
- Create `src/lib/stores/performer-threshold-store.ts`

**Steps:**
1. Zustand store with `greenCutoff` (default 30) + `redCutoff` (default 30). Validate `greenCutoff + redCutoff <= 100`.
2. Build `<ThresholdEditor>` component on the portfolio page: two number inputs + sum indicator; inline warning if invalid.
3. Server action: `fetchLowPerformerPatterns({ dateRange, filters, redCutoff })` returns same shape as high-performer but bottom-tier. Update `fetchHighPerformerPatterns` to accept `greenCutoff`.
4. Copy `high-performer-patterns.tsx` → `low-performer-patterns.tsx`; swap color token to `destructive`; relabel insights; also show Revenue/Room per #8.
5. Render low-performer ChartCard below high-performer on portfolio page.
6. Playwright: load → both sections render; change cutoff → counts update.
7. Commit: `feat(analytics/portfolio): add Low Performer Patterns and configurable R/Y/G threshold`

---

## Wave 4 — Cross-cutting

### Task 12 — #12 Cancel inflight analytics query on navigation

**Files:**
- New `src/lib/analytics/use-abortable-action.ts` (hook)
- Apply to actions-caller sites in analytics pages

**Steps:**
1. Hook wraps a server-action call in an `AbortController`. On unmount (or deps change), `controller.abort()`. Server actions accept no abort signal natively — workaround: wrap the action in a client-side fetch via a route handler that accepts the signal, OR use `router` events to set a cancelled flag and have the component drop late results (state-level cancellation). Use the second approach — simpler, no route-handler rewrite: capture a request id on each dispatch; when component unmounts, flip a ref; discard results if the ref no longer matches the current id.
2. Apply to heavy analytics pages: heat-map, pivot, trend-builder, portfolio, maturity, hotel-groups, location-groups, commission.
3. Playwright: start pivot query → immediately navigate to /analytics/heat-map → heat-map renders without waiting on the pivot promise.
4. Commit: `fix(analytics): discard stale server-action results on tab navigation`

---

## Wave 5 — Monday import

### Task 13 — #1 Asset IDs + unassigned venues for 2W (and others)

**Files:** `scripts/import-from-monday.ts`, `scripts/enrich-locations-from-monday.ts`, possibly `src/db/schema.ts` if a field missing.

**Steps:**
1. Run `db:import:monday` in dev; collect per-outlet stats on `hardwareSerialNumber` nulls and unassigned venues. Check whether Monday row actually has the column populated for 2W.
2. If Monday has values but our extractor misses them: fix `getColumnText` call for the asset-ID column (likely already fixed in F.1 per bug-report — verify) AND for venue column (find Monday col id for "venue assignment"). If Monday is empty, surface a data-quality log and exit gracefully (out of our scope to populate upstream).
3. Backfill script (or re-run import): one-off.
4. Commit: `fix(import): pull asset IDs and venue assignments for outlets missing them (2W et al.)`

### Task 14 — #6 Kiosk config groups from Monday col 1466686598

**Files:**
- Migration: `migrations/00XX_location_kiosk_config_group.sql` (or via drizzle) adding `locations.kiosk_config_group_id` (nullable UUID FK to `kiosk_config_groups.id`).
- `src/db/schema.ts`: add column.
- `scripts/import-from-monday.ts`: extract Monday column `1466686598`, upsert into `kiosk_config_groups` by name, set `locations.kiosk_config_group_id`.
- `src/app/(app)/kiosk-config-groups/page.tsx`: surface locations linked to the group.
- `src/app/(app)/kiosk-config-groups/actions.ts`: query locations by `kiosk_config_group_id`.

**Steps:**
1. Migration + schema type.
2. Import script update: resolve/insert group by name, attach to location.
3. UI: show linked locations in the groups list + a link into each group detail.
4. Dry-run import in dev; verify non-empty rows.
5. Playwright: /kiosk-config-groups shows at least one populated group with locations after import.
6. Commit: `feat(kiosk-config-groups): import groups from Monday (col 1466686598) and link via location`

---

## Wave 6 — /locations inline editing (large)

### Task 15 — #2 Inline editing for /locations (and assignee/internal POC app-wide)

**Files:**
- `src/app/(app)/locations/page.tsx` (+ client components for the table rows/cells)
- `src/app/(app)/locations/actions.ts` (add `updateLocationField`)
- Any shared editable-cell pattern: if one exists (check `src/components/kiosks/` for the kiosk inline edit cell), reuse; otherwise extract a small `<EditableCell>` to `src/components/ui/editable-cell.tsx`.
- Also audit: `/kiosks`, `/installations` tables — ensure assignee / internal POC fields are editable via the same pattern.

**Steps:**
1. Check Monday import for address — fix nulls where Monday has the value (similar to #1 pattern).
2. Build/reuse `<EditableCell>`: click-to-edit, escape to cancel, enter/blur to save. Calls `updateLocationField(id, field, value)`.
3. Wire every locations column (name, address, outlet code, num rooms, hotel group, assignee, internal POC, etc.) through it.
4. App-wide pass for assignee / internal POC fields: kiosks table and installations table get the same editable cell.
5. Playwright: edit each column type on /locations; edit assignee on /kiosks and /installations.
6. Commit: `feat(locations): inline-edit all location fields and expose assignee/internal POC edits across kiosks and installations`

---

## Execution mode

Dispatching via subagent-driven-development. Wave 1 + 2 in parallel. Each subagent produces a commit; main orchestrator reviews, then moves to next wave.

## PR

After all waves land on branch:
- `gh pr create --base main` with body linking each task # to its commit SHA.
- Request review.
