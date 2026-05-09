---
phase: 6
phase_name: post-audit-operational-follow-ups-consolidated-v1-0-backlog
researched: 2026-04-28
status: ready_for_planning
sources:
  - 06-CONTEXT.md (19 locked decisions)
  - tasks/todo.md (audit-fix backlog)
  - tasks/handoff-2026-04-27-pr-28-open.md
  - src/db/schema.ts
  - existing thresholds + audit + admin-UI patterns
---

# Phase 6 Research

> Three parallel scout passes against the codebase. Findings are file-cited and grouped per plan (06-01 through 06-07). Each plan section ends with concrete patterns to copy and pitfalls to avoid.

## Critical findings (before planning starts)

Three discoveries change the shape of the planned work versus what CONTEXT.md assumed:

1. **`/settings/thresholds` admin UI already exists** at `src/app/(app)/settings/thresholds/{page.tsx,actions.ts}` — saves `threshold_red_max` / `threshold_green_min` with audit-log. Plan 06-05 is **extension**, not greenfield. New work is adding the outlet-tier 80/50/20 keys + URL-param override + reading defaults from server (heat-map and portfolio pages currently hardcode `{ redMax: 500, greenMin: 1500 }` rather than calling `getThresholdsCached()`).
2. **`src/lib/monday-client.ts` does NOT exist.** Only the placeholder test file at `src/lib/__tests__/monday-client.test.ts` exists. Today's Monday GraphQL traffic is embedded inline in `src/lib/monday/import-location-products.ts`. Plan 06-02 must decide: extract a `monday-client.ts` from the inline calls **AND** fill the 14 tests, OR retarget the 14 tests at `import-location-products.ts`, OR delete the placeholder file. CONTEXT.md treats "fill the 14 placeholders" as a pure test job — it is not.
3. **Two `location_*_memberships` tables have a `UNIQUE(location_id)` standalone constraint** (`location_region_memberships`, `location_group_memberships`). Merging two locations whose `defunct_id` and `canonical_id` both have a row in either table will violate the unique constraint at UPDATE time. The D8 transaction needs a pre-step that DELETEs (or ON CONFLICT DO NOTHING merges) the defunct row before rewriting FKs. This is the most likely D8 failure mode and must be designed for explicitly.

---

## Plan 06-01 — D8 multi-POS site merge + 5.7 address fixes

**ROADMAP success criteria covered:** SC1, SC2.

### Affected tables (every FK to `locations.id`)

| Table | Column | Unique constraint involving location_id | Merge collision risk |
|-------|--------|-------------------------------------------|----------------------|
| `kiosk_assignments` | `location_id` | None on column alone (index only) | Low |
| `location_products` | `location_id` | Composite PK incl. `(location_id, product_id, provider_id)` | Medium — same product on both rows collides |
| `location_hotel_group_memberships` | `location_id` | Composite PK `(location_id, hotel_group_id)` | Medium |
| `location_region_memberships` | `location_id` | **`UNIQUE(location_id)` standalone** (line 578) | **High — must dedup defunct row first** |
| `location_group_memberships` | `location_id` | **`UNIQUE(location_id)` standalone** (line 601) | **High — must dedup defunct row first** |
| `salesRecords` | `location_id` | None | Low (volume — 7,531 rows) |
| `salesRecords` | `processedAtLocationId` | None | Low |
| `locationFlags` | `location_id` | None | Low |
| `actionItems` | `location_id` | None | Low |
| `duplicateDismissals` | `locationAId`, `locationBId` | UNIQUE on the pair (`duplicate_dismissals_pair_idx`) | Low (orphaned rows are fine) |

**Schema citations:** `src/db/schema.ts:578` (region memberships unique), `:601` (group memberships unique), `:556` (hotel group composite), `:228` (locations.archivedAt).

### Archive mechanism

`locations.archivedAt: timestamp("archived_at", { withTimezone: true })` (nullable, line 228). Existing pattern; **no separate `archived_locations` table**. Setting `archivedAt = NOW()` is the archive op.

### Audit-log plumbing

- Helper: `writeAuditLog(entry, db?)` at `src/lib/audit.ts:9`.
- Signature accepts: `actorId`, `actorName`, `entityType` (incl. `"location"`), `entityId`, `entityName`, `action` (incl. `"merge"`), `field?`, `oldValue?`, `newValue?`, `metadata?: Record<string, unknown>`.
- `audit_logs` schema (line 262–278): `id uuid PK`, `actor_id text`, `actor_name text`, `entity_type text`, `entity_id text`, `entity_name text`, `action text`, `field text`, `old_value text`, `new_value text`, `metadata jsonb`, `created_at timestamptz`.
- **Convention from Phase 5.2 backfill:** `metadata.script` is the JSONB key carrying the script identifier; rollback queries match on `metadata->>'script' = '<script_path>'`. New script must use `metadata.script = "scripts/multi-pos-merge.ts"` (or whatever the final filename is — pick one and stick with it).

### Canonical pattern: `scripts/backfill-kiosk-install-dates.ts`

Use this script as the template for the D8 apply path:

```ts
// arg parsing
const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// DB connection (raw pg, NOT Drizzle, because Drizzle wraps in transaction confusingly)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

// 1. Bulk UPDATE via CTE (single statement for the data move)
await client.query(updateSql, [candidateIds]);

// 2. Per-row audit-log writes (NOT batched — one INSERT per affected row)
for (const r of candidates.rows) {
  await client.query(`INSERT INTO audit_logs (...) VALUES (..., $10::jsonb, NOW())`,
    [..., JSON.stringify({ reason: "...", source: ..., script: "scripts/..." })]);
}
```

Key conventions:
- `--apply` flag (no flag = dry-run that prints stats but writes nothing).
- Idempotency guard at top of script (re-runs are no-ops once applied).
- Per-row audit log with `metadata.script = "..."` so rollback SQL can target it.
- ETL system user UUID `00000000-0000-0000-0000-000000000001` for `actor_id`.

### Phase 5.2 rollback pattern (informs D8 rollback)

From `tasks/handoff-2026-04-27-pr-28-open.md` §3:

```sql
BEGIN;
  SET LOCAL app.allow_assigned_at_mutation = 'on';
  UPDATE kiosk_assignments ka
     SET assigned_at = (al.old_value)::timestamptz
    FROM audit_logs al
   WHERE al.entity_id = ka.id::text
     AND al.entity_type = 'kiosk_assignment'
     AND al.field = 'assigned_at'
     AND al.metadata->>'script' = 'scripts/backfill-kiosk-install-dates.ts';
COMMIT;
```

D8 rollback uses the same shape, keyed on `metadata->>'script' = 'scripts/multi-pos-merge.ts'`. Each row of `sales_records.location_id` rewrite stores `old_value=<defunct_id>`, `new_value=<canonical_id>` so the rollback can reverse the rewrite.

### multi-pos-merge-proposal.csv shape

Columns: `cluster_id, cluster_basis, address, region, canonical_outlet_code, canonical_id, canonical_name, canonical_sales_count, canonical_amount_total, defunct_outlet_code, defunct_id, defunct_name, defunct_sales_count, defunct_kiosks_count, notes`.

Key fact: 22 cluster_ids; 29 rows have non-null `defunct_id` (i.e. 7 clusters merge >2 rows). 7,531 sales rows total to rewrite.

### Existing `/settings/duplicates` page (D8 review UI host candidate)

- `page.tsx` — admin guard, mounts `<DuplicatesClient />`.
- `actions.ts` — `scanDuplicateLocations()` (O(n²) pair scoring) + `dismissDuplicatePair()` (writes `duplicate_dismissals` row + audit-log).
- `duplicates-client.tsx` — threshold slider, scan button, pair list with merge/dismiss; integrates `mergeLocationsAction` from `src/app/(app)/locations/merge-action`.

**Implication:** A `/settings/duplicates/merge-review` sister route is the natural home — it reuses the chrome and the existing `mergeLocationsAction` server action (which the planner should investigate to see if it already does the FK rewrite or only handles a 1-pair dismiss case).

### Address-data-quality fix (5.7) bundled in

The same review UI surfaces "this isn't a duplicate, the address is wrong" cases (per CONTEXT D-04). For each such row, the admin chooses: re-pull from Monday OR hand-edit. No separate plan needed — folded into the same destructive PR.

### Open questions for the planner

1. **Pre-merge dedup on UNIQUE(location_id) tables** — for `location_region_memberships` and `location_group_memberships`, when both canonical and defunct rows exist, the merge needs to either DELETE the defunct row or use `ON CONFLICT (location_id) DO NOTHING` semantics. Which one preserves the right state (e.g., does the defunct's region membership ever differ from canonical's)? **Plan task should include a probe query that lists all defunct-canonical pairs where both have rows in these two tables, so the admin can decide per-cluster.**
2. **`mergeLocationsAction` reuse** — open `src/app/(app)/locations/merge-action.ts` (or wherever it lives) and check if it already does what plan 06-01 needs at the per-pair level. If yes, the new work is the bulk review UI + audit-log shape, not the merge primitive.
3. **CONTEXT D-03 "single transaction" vs. backfill pattern's two-step (CTE update + per-row audit-log loop)** — the backfill does the data write outside the audit-log loop. For 7,531 rows + ~9 tables, a single transaction is feasible but slow. Per-cluster transactions (22 clusters) trade atomicity for progress visibility. **Planner should choose and lock**: per-cluster or all-or-nothing.
4. **`merge_proposals` table** (CONTEXT D-01) — does this need a Drizzle schema migration? Or can it be a JSONB column on an existing settings table? If it's a new table, the plan's first task is the migration.

---

## Plan 06-02 — Test infrastructure (Monday + kiosk-config-groups regression)

**ROADMAP success criteria covered:** SC7, SC8.

### Monday client tests (the 14 `it.todo` placeholders)

**File:** `src/lib/__tests__/monday-client.test.ts`. **Implementation under test:** does NOT exist.

The 14 `it.todo` titles, verbatim with line numbers:
1. `:5` — `"sends GraphQL POST to api.monday.com/v2 with auth header"`
2. `:6` — `"throws if MONDAY_API_TOKEN is not set"`
3. `:7` — `"throws on GraphQL errors in response"`
4. `:11` — `"yields first page of items from items_page"`
5. `:12` — `"follows cursor through next_items_page until cursor is null"`
6. `:13` — `"handles empty board with zero items"`
7. `:17` — `"retries on rate limit error with exponential backoff"`
8. `:18` — `"throws after max retries exceeded"`
9. `:19` — `"does not retry on non-rate-limit errors"`
10. `:23` — `"fetches subitems nested inside items query"`
11. `:24` — `"maps subitem column values to product/provider/commission data"`
12. `:28` — `"maps known Monday.com column titles to Drizzle field names"`
13. `:29` — `"returns unmapped columns for unknown column titles"`
14. `:30` — `"handles StatusValue label extraction via typed fragment"`

**Today's Monday GraphQL code lives inline in `src/lib/monday/import-location-products.ts`** (~50 line preamble of constants, then GraphQL queries inline in `fetchAllItems()` etc.). The 14 test titles describe a thin GraphQL wrapper that does not exist as a standalone module.

**Recommended planner decision:** Extract `src/lib/monday/client.ts` (rename — note that `monday-client.test.ts` references a flat-namespace path; the test file may need to move too) from `import-location-products.ts`. Public surface implied by the 14 tests:
- `mondayQuery<T>(query: string, variables: Record<string, unknown>): Promise<T>` — auth + error-handling + retry wrapper
- `iterateBoardItems(boardId: number): AsyncGenerator<MondayItem>` — pagination via `items_page` + `next_items_page`
- `mapColumnValues<T>(item: MondayItem, columnMap: Record<string, keyof T>): Partial<T>` — column-title to schema-field mapping

This is real impl work, ~300 lines, plus the test fills. The planner should decide whether to ship as a refactor (no behaviour change for `import-location-products`) or as a parallel "first-class client" with the legacy inline path kept until a follow-up.

**Vitest fetch-stub pattern in this repo** (from `src/lib/analytics/queries/hotel-groups.test.ts`):

```ts
const mockExecute = vi.fn();

vi.mock("@/db", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));
```

For Monday tests: stub `global.fetch` (or extract a `fetcher` dep that defaults to `fetch` and accept it as a parameter for test injection — cleaner). The `vi.mock` form above is for module mocks; `vi.spyOn(globalThis, "fetch")` or `vi.stubGlobal("fetch", vi.fn())` is the standard Vitest pattern for fetch.

**Vitest config:** `vitest.config.ts:13–65`. Two projects — `unit` and `integration` (Testcontainers Postgres). Monday client tests belong in `unit`. Globals enabled, Node environment, no setup files.

### Kiosk-config-groups Playwright regression fixture

**Existing spec:** `tests/kiosk-config-groups/list.spec.ts` — 3 tests (page-renders, table-or-empty-state, dark-mode toggle).

**The bug PR #29 fixed** (commit `fbcce77`):
- File: `src/app/(app)/kiosk-config-groups/actions.ts` (`listConfigGroups`)
- Bug: `sql\`${locationProducts.locationId} = ANY(${ids})\`` produced `ANY(($1, $2, $3))` (positional tuple) instead of `ANY($1::uuid[])` (single bound array). Postgres errored with SQLSTATE 42809 on >1 location.
- Fix: replaced with `inArray(locationProducts.locationId, ids)` to generate the single bound array param.

**Regression fixture must:**
1. Seed a config group with **≥2 active linked locations** + **≥1 active product**.
2. Hit the list page (`/kiosk-config-groups`) — assert it renders without 500.
3. Hit the detail page (`/kiosk-config-groups/[id]`) — assert it renders the ≥2 locations.

**Today's seeding mechanism:** No fixtures dir; specs assume `npm run db:seed` was run beforehand (per `playwright.config.ts:1–21`, no global setup file). Existing specs use admin auth via `tests/helpers/auth.ts` (`signInAsAdmin`, `TEST_ADMIN`).

The regression fixture either:
- (a) extends `npm run db:seed` to include a multi-location config group (cleaner — every Playwright run gets it), OR
- (b) seeds inline via a `test.beforeEach` that POSTs through admin actions or directly via the DB.

**Planner should pick (a)** — match the repo's existing convention. Find `db:seed` script, add the new fixture there.

**Playwright deps:** `@playwright/test ^1.58.2`, `vitest ^4.1.2`, `testcontainers ^11.14.0`.

---

## Plan 06-03 — KPI tooltip sweep

**ROADMAP success criteria covered:** SC5.

### KpiCard prop type

`src/components/analytics/kpi-card.tsx:13–24`:

```ts
interface KpiCardProps {
  title: string;
  value: string;
  change?: { text: string; color: string; direction: "up" | "down" | "neutral" };
  loading?: boolean;
  primary?: boolean;
  icon?: React.ReactNode;
  tooltip?: string;  // optional
}
```

`tooltip` is `string | undefined`, optional. Existing canonical wiring: `src/app/(app)/analytics/location-groups/capacity-metrics.tsx:44` (Avg Basket).

### Call-site inventory (22 missing tooltips, 1 wired)

| File | Line(s) | Cards | Wired |
|------|---------|-------|-------|
| `src/app/(app)/settings/data-quality/page.tsx` | 52, 58, 64, 70 | 4 | 0 |
| `src/app/(app)/analytics/hotel-groups/group-metrics.tsx` | 31, 38, 44, 49 | 4 | 0 |
| `src/app/(app)/analytics/regions/region-metrics.tsx` | 31, 38, 44, 49 | 4 | 0 |
| `src/app/(app)/analytics/commission/page.tsx` | 151, 162, 172, 186 | 4 | 0 |
| `src/app/(app)/analytics/location-groups/capacity-metrics.tsx` | 19, 25, 30, 35, 44, 49 | 6 | 1 (line 44) |
| `src/app/(app)/analytics/location-groups/location-metrics.tsx` | 32, 39, 45, 50 | 4 | 0 |
| `src/app/(app)/analytics/maturity/page.tsx` | 97 | 1 | 0 |
| **Total** | | **27** | **1** |

(Note: scout reported 23 total; counting from the table above gives 27. Planner should re-grep on plan kickoff to confirm exact count — avoid drift if code changed since 2026-04-28.)

### Tooltip text sourcing

Per CONTEXT D (Claude's discretion) — derive each tooltip text from the matching D-decision in `tasks/todo.md` (top of file). The audit's resolved decisions are the canonical math definitions; tooltips that match them stay accurate when the math is later re-explained.

### Implementation shape

This is a pure text-wiring plan. No new components, no new types. One PR, one commit per surface (commission, hotel-groups, regions, etc.) so the diff stays reviewable.

---

## Plan 06-04 — Phase 7.11 deferral note

**ROADMAP success criteria covered:** SC9.

### Today's state of Phase 7.11

`tasks/todo.md:128`:
```
- [ ] **7.11** Analytics treatment of `freeTrialEndDate` deferred — pick up alongside the maintenance-fee recurring-revenue work when that lands (P3, blocked on a future maintenance-fee design decision).
```

Already marked deferred in todo.md. SC9 in ROADMAP wants this **explicitly noted in REQUIREMENTS.md** so it's not silently dropped at v1.0 close.

### REQUIREMENTS.md format

`.planning/REQUIREMENTS.md` is a v1 requirements checklist (AUTH, KIOSK, LOC, TABLE...) in checkbox form. The doc does not currently have a "Deferred" or "v2" section visible in the first 100 lines.

**Planner decision:** Add a new section near the bottom of REQUIREMENTS.md titled `## Deferred to v2` with one entry: `REPORT-V2-01: freeTrialEndDate analytics treatment — deferred from v1.0; pickup tied to maintenance-fee recurring-revenue work (see tasks/todo.md §7.11 for context).`

This is a docs-only plan, ~3 file edits (REQUIREMENTS.md + reword the todo.md line + maybe a backlinking in ROADMAP). One commit.

---

## Plan 06-05 — Thresholds-as-settings (heat-map green/red + outlet-tier 80/50/20)

**ROADMAP success criteria covered:** SC3.

### What already exists

- `src/app/(app)/settings/thresholds/page.tsx` — admin form for `redMax` / `greenMin` numeric inputs, save button, audit-log via action.
- `src/app/(app)/settings/thresholds/actions.ts` — `saveThresholds({ redMax, greenMin })` upserts both keys + writes one `audit_logs` row with `action: "update", field: "redMax,greenMin"`, before/after values.
- `src/lib/analytics/thresholds-server.ts` — cached reader `getThresholdsCached()` with tag `"analytics:thresholds"` and `THRESHOLDS_TAG = "analytics:thresholds"`, defaults `{ redMax: 500, greenMin: 1500 }`.
- `src/lib/analytics/display-timezone-server.ts` — companion cached-reader pattern (timezone). Mirror this for any new keys.

### What's missing for SC3

1. **Outlet-tier threshold keys** — `threshold_outlet_tier_top` (default 80), `threshold_outlet_tier_mid` (default 50), `threshold_outlet_tier_bottom` (default 20). Either add to the existing `getThresholdsCached()` return type or add a sibling `getOutletTierThresholdsCached()`. Picking sibling keeps the cache-tag invalidation surface tight (changing tier cutoffs shouldn't bust heat-map).
2. **Refactor `classifyOutletTier(percentile)`** at `src/lib/analytics/metrics.ts:105–110` — currently hard-coded `>= 80 / >= 50 / >= 20`. Either: (a) take a `tiers: { top, mid, bottom }` second parameter (pure-function preserving), or (b) introduce `classifyOutletTierWithConfig(percentile, config)` and migrate the one caller (`src/lib/analytics/queries/portfolio.ts:500`). Option (a) is simpler. **Tests for this function must come along** — the file currently has no unit tests.
3. **Wire portfolio.ts:500 to read from settings** — replace bare `classifyOutletTier(percentile)` with `classifyOutletTier(percentile, await getOutletTierThresholdsCached())`.
4. **Extend `/settings/thresholds` page** with three new numeric inputs + validation (`top > mid > bottom`, all 0–100). Add to the same `saveThresholds()` action signature OR add a new `saveOutletTierThresholds()` action.
5. **Make heat-map and portfolio pages READ from `getThresholdsCached()`** — currently both hardcode defaults at `src/app/(app)/analytics/heat-map/page.tsx:22` and `src/app/(app)/analytics/portfolio/page.tsx:81–82`. They should call the cached helper on mount.
6. **URL-param override semantics** — per CONTEXT D-09. FilterBar at `src/components/analytics/filter-bar.tsx:28–29` reads URL params via `useSearchParams` + `searchParamsToFilters`. Add params: `?redMax=`, `?greenMin=`, `?tierTop=`, `?tierMid=`, `?tierBottom=`. URL value overrides cached default in the consumer; "Save as default" button on `/settings/thresholds` writes back via existing action.

### Pitfalls

- The `classifyOutletTier` change ripples into `portfolio.ts:500` which is inside `getOutletTiers` (cached query). Make sure the cache key incorporates the threshold config OR invalidate the cache on threshold-save (current `THRESHOLDS_TAG` invalidates only the threshold reader, not the consumer queries).
- `HEAT_MAP_SCORE_THRESHOLDS = { redMax: 33, greenMin: 66 }` at `src/app/(app)/analytics/heat-map/performance-table.tsx:47` is **a different threshold** (the composite-score 0–100 traffic-light cutoffs). Out of scope for plan 06-05 — do not touch.
- `PLATEAU_THRESHOLD_PCT = 10` at `src/lib/analytics/plateau-insight.ts:26` is **explicitly excluded** per CONTEXT specifics. Leave hard-coded.

### Settings UI directory inventory

For context on the page conventions (existing settings pages under `src/app/(app)/settings/`):
- `analytics-display`, `thresholds`, `outlet-exclusions`, `outlet-types`, `analytics-presets`, `data-import/{sales,monday,azure}`, `business-events`, `pipeline-stages`, `data-quality`, `audit-log`, `duplicates`. Use any of these as a chrome reference; `/settings/thresholds` is closest in shape.

---

## Plan 06-06 — Geocoding (Google Maps, admin UI, ~392 outlets)

**ROADMAP success criteria covered:** SC4.

### Schema state

`src/db/schema.ts:152–153`:
```ts
latitude: doublePrecision("latitude"),
longitude: doublePrecision("longitude"),
```

Both nullable, `doublePrecision` (Postgres `float8`). NULL on ~392 rows per CONTEXT.

### Greenfield confirmation

Grep for `Google`, `geocod`, `@googlemaps/`, `googlemaps.com` returns zero matches in `src/`. Greenfield. **No `@googlemaps/google-maps-services-js` (or similar) in `package.json`.**

**Adding a dep triggers the npm/lockfile Docker regen procedure** (per `CLAUDE.md` lines 3–65). Plan must include this step explicitly: regenerate lockfile in `node:22-bookworm linux/amd64` container before pushing — failing this is the most-repeated CI failure on this repo.

### Admin UI scaffold (`src/app/(app)/settings/data-import/sales/pipeline.ts`)

The sales import flow is the canonical "preview → review → apply" admin pattern:
- Three pure functions: `_stageImportForActor()` (parse + validate), `_commitImportForActor()` (move staging to live), `_cancelImportForActor()` (delete staging).
- Server actions in `./actions.ts` gate via `requireRole("admin")`.
- Stage writes `salesImports` + `importStagings` rows; commit moves to `salesRecords` in transaction.

For geocoding, mirror this as:
- `_stageGeocodeForActor()` — fetches lat/lng for all NULL-coord locations (or all, if force-rerun), writes a staging table.
- `_commitGeocodeForActor()` — applies staged values to `locations` + per-row audit-log.
- `_cancelGeocodeForActor()` — deletes staging.

The "preview" UI shows the full 392-row staging table (per CONTEXT D-13).

### Env-var convention

**There is NO centralised `src/lib/env.ts` or `src/env.mjs`.** Pipeline functions take deps as parameters (see `pipeline.ts:18–26` — `db` is injected, never read from `process.env` directly). Tests inject `process.env.GOOGLE_MAPS_API_KEY` directly when needed.

For the geocoding plan: pass the API key as a parameter to the pipeline functions; read `process.env.GOOGLE_MAPS_API_KEY` only in the action layer (`actions.ts`). Vercel env-var step is a deploy-side prerequisite — note in plan but don't try to automate.

### Rate-limit helper

No `pLimit` / `p-queue` / `bottleneck` helper in the repo today. `setTimeout`-based delays exist in some places (`src/lib/monday/import-location-products.ts`). Google's Geocoding API allows ~50 req/sec; for 392 rows there's no real rate-limit concern, but add a 100ms delay between calls anyway for politeness. Don't add a new dep just for this — `await new Promise(r => setTimeout(r, 100))` in a `for` loop is enough.

### Audit-log shape per row

```ts
await writeAuditLog({
  actorId: <admin user id>,
  actorName: <admin name>,
  entityType: "location",
  entityId: <location.id>,
  entityName: <location.name>,
  action: "update",
  field: "latitude,longitude",
  oldValue: <"" or NULL>,
  newValue: `${lat},${lng}`,
  metadata: { script: "scripts/geocode-locations.ts", provider: "google", confidence: <google_confidence> },
});
```

### Idempotency

Per CONTEXT D-14: skip rows that already have `latitude IS NOT NULL`. Force-overwrite via explicit "Re-geocode all" checkbox on the admin UI.

---

## Plan 06-07 — D2 reversal-matcher hardening

**ROADMAP success criteria covered:** SC6.

### Reality check

The matcher does NOT live in `src/lib/sales-csv.ts` (CONTEXT was wrong on this). It lives in:
- `src/lib/sales/reversal-matcher.ts` — implementation
- `src/lib/sales/reversal-matcher.test.ts` — existing 11 vitest tests (6 in-batch + 5 cross-batch)

### Function signatures

- `matchInBatchReversals(rows: ReversalCandidate[]): InBatchMatchResult` (line 66)
- `applyCrossBatchMatches(unmatchedRefunds: ReversalCandidate[], candidates: ReversalCandidate[]): { matches: ReversalMatch[]; orphans: ReversalCandidate[] }` (line 126)

### The ORDER BY non-determinism (lines 148–153)

```ts
for (let i = 0; i < list.length; i++) {
  if (Math.abs(Number(list[i].netAmount)) >= refundMag) {
    if (bestIdx === -1 || list[i].transactionDate > list[bestIdx].transactionDate) {
      bestIdx = i;
    }
  }
}
```

When two candidates share the **same `transactionDate`**, `bestIdx` is determined by **insertion order** of `list`, which is the order rows arrive at this function. There's no deterministic tiebreaker. The fix: add a tiebreaker like `list[i].id > list[bestIdx].id` (or `<`), and ensure the input is sorted by a stable key (e.g., `(transactionDate ASC, id ASC)` at the call site that builds `candidates`).

### Cents-math classification

`abs(n: string) => Math.abs(Number(n))` (line 60), then string-key via `.toFixed(2)` for canonicalisation. Schema column type for amounts is `NUMERIC(12,2)` (Drizzle `numeric(12, 2)` — see `src/db/schema.ts` for `revenueAmount` / `maintenance_fee` / `contract_value`). At amounts the system actually carries (≤ a few thousand currency units), `Number()` round-trips losslessly because both sides parse the same canonical 2-decimal string.

**Per `tasks/handoff-2026-04-27-pr-28-open.md` §4:** "Cents-math is prophylactic at the magnitudes we see (NUMERIC(12,2) round-trips exact through `Number()` because both sides parse the same canonical string). The 2% orphan gap and cross-batch ORDER BY non-determinism are real but warrant their own PR with a regression-test scaffold over synthetic in-batch / cross-batch fixtures."

So the plan's scope is: ORDER BY tiebreaker + 2% orphan analysis + regression-test scaffold. **Cents-math hardening is out of scope** — explicitly deferred.

### The 2% orphan gap

No counter or logging in `reversal-matcher.ts` exposes the 2% number directly. The handoff documents it as a known backlog item; the actual measurement source is presumably an ad-hoc query that was run during the audit (look in `tasks/analytics-audit/` for the source query, or add a script that reruns the count: refunds where `applyCrossBatchMatches` returned them in the `orphans` array).

**Plan task:** Add a script `scripts/measure-reversal-orphan-rate.ts` that runs the matcher over the full sales history and reports the orphan count + percentage. Persist the historical baseline in a comment in `reversal-matcher.test.ts` so future drift is detectable.

### Regression-test scaffold structure

Existing test file uses `row(id, refNo, netAmount, transactionDate, locationId)` helper (lines 8–14). The scaffold should add:
- A property-based test (or table-driven test) that asserts: given any input ordering of cross-batch candidates with the same `transactionDate`, the output match is deterministic.
- A fixture set that reproduces the 2% orphan pattern (sales with refunds whose original transaction is older than the cross-batch window).

---

## Cross-cutting

### Project skill directories

`.claude/skills/` and `.agents/skills/` — **neither exists**. No project-specific skill rules to honour.

### Phase branching (per `~/.claude/CLAUDE.md` & GSD config)

Per the user's preferences captured in their global CLAUDE.md and the GSD config (`branching_strategy: "phase"`):
- Phase integration branch: `gsd/phase-06-post-audit-followups`
- Per-plan sub-branches: `gsd/phase-06-d8-multi-pos-merge`, `gsd/phase-06-test-infra`, etc.
- Each plan ships its own short-lived branch + PR into the phase branch.
- Phase branch merges to `main` when all plans verified.
- **Per-plan summary commit at the end of each plan**, **per-phase summary commit at the end of the phase** (per CLAUDE.md preference).

### Project-level CLAUDE.md

`/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/CLAUDE.md`:
- Lines 3–65: npm lockfile Docker regen procedure. **Critical for plan 06-06** (geocoding adds Google Maps dep).
- Lines 67–97: prod admin password rotation script. Not relevant to phase 6.
- No phase-branching rules in project CLAUDE.md (those live in `~/.claude/CLAUDE.md`).

### Test deps

- `@playwright/test ^1.58.2` (06-02 fixture)
- `vitest ^4.1.2` (06-02 Monday tests, 06-05 unit tests for `classifyOutletTier`, 06-07 regression scaffold)
- `testcontainers ^11.14.0` + `@testcontainers/postgresql ^11.14.0` (integration project; not strictly needed for any 06-* plan but available)

---

## Validation Architecture

> Phase 6 mixes destructive ops, admin UIs, integration tests, and pure-function refactors. Validation requirements differ per plan; the Nyquist gate enforces these on the executor.

| Plan | Surface | Validation kind | Concrete requirement |
|------|---------|-----------------|----------------------|
| 06-01 | D8 destructive merge | Manual UAT + audit-log replay test + dry-run idempotency | (a) Dry-run printed expected stats. (b) Apply on staging branch produces the expected row counts in `audit_logs`. (c) Rollback SQL (Phase 5.2 pattern) reverses cleanly on staging. (d) Re-running apply after apply is a no-op. (e) Audit-log row count == `2 × 7531` (rewrite + archive) ± memberships. |
| 06-02 | Monday client tests | Vitest unit | All 14 `it.todo` lines become passing `it(...)` tests. `vitest run src/lib/__tests__/monday-client.test.ts` exits 0. Coverage of `monday-client.ts` (or `import-location-products.ts` extracted client) ≥ 80%. |
| 06-02 | kiosk-config-groups regression fixture | Playwright e2e | New seed in `npm run db:seed` creates a config group with ≥2 locations + ≥1 product. New spec at `tests/kiosk-config-groups/multi-location.spec.ts` asserts list and detail pages render without 500. `npx playwright test tests/kiosk-config-groups` exits 0. **Verifying this fixture would have caught the PR #29 bug:** revert commit `fbcce77` locally and confirm the new spec fails. |
| 06-03 | KPI tooltip sweep | Grep verification | `grep -rn "<KpiCard" src/app/\(app\)/analytics src/app/\(app\)/settings` shows every call site has `tooltip=` prop. No specific test required (text-only change). |
| 06-04 | Phase 7.11 deferral | Grep verification | `grep "REPORT-V2-01\|freeTrialEndDate" .planning/REQUIREMENTS.md tasks/todo.md` returns ≥3 hits. |
| 06-05 | Thresholds-as-settings | Vitest unit + Playwright e2e + manual UAT | (a) New `classifyOutletTier(percentile, config)` has unit tests at every cutoff boundary. (b) `/settings/thresholds` admin UI saves new keys (Playwright). (c) Heat-map page reads new `tierTop/Mid/Bottom` from URL param and falls back to settings (Playwright). (d) Audit-log row created on save. |
| 06-06 | Geocoding | Vitest unit + manual UAT against Google API on staging | (a) Pipeline functions tested with stubbed geocoder (idempotency, skip-existing, force-rerun). (b) Manual run against staging DB with real Google Maps API key populates ≥390 of 392 NULL rows. (c) Audit-log entry per populated row. (d) `npm ci --dry-run` in linux/amd64 Docker container passes after dep add. |
| 06-07 | D2 hardening | Vitest unit + measurement script | (a) Cross-batch ORDER BY tiebreaker test asserts determinism across 100 random input permutations. (b) `scripts/measure-reversal-orphan-rate.ts` runs against staging and reports the current orphan rate. (c) Comment in `reversal-matcher.test.ts` records baseline rate for drift detection. |

### What "passing" looks like at phase close (per ROADMAP SC10)

`tasks/todo.md` shows zero unchecked items in the audit-fix backlog, OR each remaining item is explicitly tagged `[ ] [DEFERRED to vNext: <reason>]` rather than silently left unchecked.

---

## Recommended plan execution order

Per CONTEXT D-17 (D8 first, low-risk cleanup second, then thresholds → geocoding → D2), but with adjustments based on the critical findings above:

1. **06-01 — D8 multi-POS merge + 5.7 address fixes** (PR 1, destructive). First while attention is fresh; downstream plans land on a cleaned dataset. **Pre-merge dedup probe must be the first task in the plan.**
2. **06-02 — Test infrastructure** (PR 2, bundled with 06-03 and 06-04). Includes both Monday client extraction (real impl work, ~300 lines) and Playwright fixture. **The "fill 14 it.todo" framing in CONTEXT understates the work — flag this.**
3. **06-03 — KPI tooltip sweep** (PR 2). Pure text wiring; bundles cleanly with 06-02 and 06-04 in a "low-risk cleanup" PR.
4. **06-04 — Phase 7.11 deferral note** (PR 2). Docs-only.
5. **06-05 — Thresholds-as-settings** (PR 3). Builds on existing `/settings/thresholds` (not greenfield as CONTEXT implied). Includes function refactor + cache invalidation work.
6. **06-06 — Geocoding** (PR 4). Greenfield; needs Vercel env var + Docker lockfile regen.
7. **06-07 — D2 reversal-matcher hardening** (PR 5). Standalone; safest to ship last.

The 22-cluster destructive merge is the riskiest plan — getting it out the door first is correct, but the planner should expect 06-01 to be the longest plan (probe + UI + apply path + rollback test + UAT).
