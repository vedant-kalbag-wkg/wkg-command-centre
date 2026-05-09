# Phase 6: Post-audit Operational Follow-ups - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the eight outstanding non-trivial workstreams from the analytics-audit arc (PRs #23–#29) so v1.0 reaches a fully-stable operational baseline before any v2 feature work. No new product capabilities — every item is an audit follow-on, a destructive cleanup, or test/process hardening. Estimated 7 plans → 5 PRs.

In scope (each maps to one or more plans):
1. **D8 multi-POS site merge** (Phase 5.5/5.6/5.7 from `tasks/todo.md`) — destructive merge of 22 clusters / 29 defunct rows / 7,531 sales rows + address-data-quality fix bundled in
2. **Thresholds-as-settings** (Phase 6.2 + 6.6) — heat-map green/red + outlet-tier 80/50/20 lifted from constants into `appSettings`, with admin UI
3. **Lat/lng geocoding** (Phase 6.7) — ~392 outlets via Google Maps API, admin UI button with full preview
4. **D2 reversal-matcher hardening** — regression-test scaffold + 2% orphan gap + cross-batch ORDER BY determinism + integer-cents math
5. **KPI tooltip sweep** (Phase 8.5) — wire `KpiCard.tooltip` text on every remaining call site
6. **Monday GraphQL client tests** — fill 14 `it.todo` placeholders in `src/lib/__tests__/monday-client.test.ts`
7. **Kiosk-config-groups multi-location regression fixture** — Playwright seed catching `ANY(${ids})` array-binding regressions
8. **Phase 7.11 deferral note** — explicit deferral (don't silently drop)

Out of scope: anything in `.planning/PROJECT.md` "Out of Scope"; v2 requirements; the Drizzle upstream PR for `patches/drizzle-orm+0.45.2.patch`; plateau ±10% threshold (stays hard-coded in `plateau-insight.ts` for now).

</domain>

<decisions>
## Implementation Decisions

### D8 Multi-POS Merge (workstream G)

- **D-01:** Review/approval mechanism: **Per-cluster admin UI signoff**. Build a review page (likely `/settings/duplicates/merge-review`) listing the 22 clusters from `tasks/analytics-audit/multi-pos-merge-proposal.csv`. Per cluster, admin can: ✅ approve as-is, 🔁 swap which row is canonical, ❌ reject (these aren't actually duplicates). Decisions persist to a `merge_proposals` table.
- **D-02:** Rollback safety: **Audit log only**. Per-row `audit_logs` entries with old/new `location_id` for each rewritten `sales_records`/`kiosk_assignments`/`location_*_memberships` row. Reversible via SQL using `metadata.script='multi-pos-merge'` predicate (mirrors Phase 5.2 backfill rollback pattern in handoff §3). Neon's 7-day PITR is the secondary backstop. No pre-merge `pg_dump` to S3.
- **D-03:** Apply trigger: **Apply button on the same review page** (server action). After all 22 clusters are marked approved/rejected/swapped, an Apply button (with confirm-dialog showing diff summary) commits inside a single transaction. Audit log captures who applied. No CLI script.
- **D-04:** Address-data-quality fix (5.7) bundled into the same PR as 5.5/5.6. The review UI naturally surfaces "this isn't a duplicate, the address is wrong" cases — corrections (Monday re-pull or hand-edit) ride along in the same destructive PR. One coherent cleanup.
- **D-05:** Idempotency: re-running the apply after merge is a no-op (defunct rows already archived, sales already rewritten). Guard via `archivedAt IS NULL` on candidates.

### Thresholds-as-settings (workstream D, plans 6.2 + 6.6 land together)

- **D-06:** Editable thresholds in this phase: **heat-map green/red** (`threshold_green_min` / `threshold_red_max` — already in `appSettings` but no admin UI yet) AND **outlet-tier 80/50/20** (top/mid/bottom percentile cutoffs in `getOutletTiers`). Plateau ±10% (`PLATEAU_THRESHOLD_PCT`) stays hard-coded — explicitly excluded.
- **D-07:** Storage: **extend existing `appSettings` table**. New keys: `threshold_outlet_tier_top`, `threshold_outlet_tier_mid`, `threshold_outlet_tier_bottom`. Server-side reads via cached helper mirroring `display-timezone-server.ts` / `thresholds-server.ts` pattern.
- **D-08:** Scope: **Global**. One set of thresholds platform-wide, admin-only edit. URL params override per-session for what-if exploration; explicit "Save as default" writes back to `appSettings` with audit-log entry.
- **D-09:** URL semantics: **temp override only**. URL params (e.g. `?greenMin=70`) override the saved setting for the current view; do NOT auto-save. Save-as-default is a deliberate button click. Mirrors how saved views work for filters.
- **D-10:** Admin UI route: `/settings/thresholds` (Claude's Discretion if a different route works better with existing settings-page nav).

### Geocoding (workstream E, plan 6.7)

- **D-11:** Provider: **Google Maps Geocoding API**. Best accuracy for hotel addresses. Cost ~$2 for 392 outlets one-off, ~$0.50 per future re-import. Requires `GOOGLE_MAPS_API_KEY` env var. Used downstream when D6 timezone refinement layers in (geo-tz lookup from lat/lng).
- **D-12:** Invocation: **Admin UI button**. Add to Settings (likely a new `/settings/geocoding` page or extend `/settings/data-import`). Server action runs in background; progress polled; audit log per row. Shape mirrors the Monday import flow.
- **D-13:** Dry-run: **full preview table** showing all 392 rows with id, name, address, current lat/lng (mostly NULL), proposed lat/lng, geocoder confidence, and any failures. User reviews and clicks Apply. Same UX as Monday import dry-run.
- **D-14:** Idempotency: **skip rows that already have lat/lng**. Re-runs only populate NULL. Force-overwrite via explicit "Re-geocode all" checkbox. Aligns with D6's manual-override convention for `iana_timezone`.
- **D-15:** Audit log: per-row entry on populate (entity_type=`location`, field=`latitude`/`longitude`, metadata `{script:'geocode-locations', provider:'google'}`).

### PR Sequencing & Bundling

- **D-16:** Plan count: **7 plans, 5 PRs**. Plans 06-02/03/04 (test infra, KPI tooltip sweep, Phase 7.11 deferral note) bundle into one "low-risk cleanup" PR; the other four ship 1:1 as their own PRs.
- **D-17:** Execution order: **D8 destructive merge first**. Get the destructive op out of the way while attention is fresh; the rest land on a cleaned-up dataset. Order: G → (A+B+C cleanup) → D thresholds → E geocoding → F D2 scaffold.
- **D-18:** Branching: **phase branch + per-PR sub-branches**. Integration branch `gsd/phase-06-post-audit-followups`; each plan ships its own short-lived branch (e.g. `gsd/phase-06-d8-multi-pos-merge`) and PRs into the phase branch. Phase branch merges to main when all plans verified. Per CLAUDE.md preference.
- **D-19:** Plan numbering follows execution order:
  - **06-01** — D8 multi-POS merge + 5.7 address fixes → **PR 1** (destructive)
  - **06-02** — Monday-client tests (14 `it.todo`) + kiosk-config-groups multi-location Playwright fixture → **PR 2** (with 06-03, 06-04)
  - **06-03** — KPI tooltip sweep across remaining `KpiCard` call sites → **PR 2**
  - **06-04** — Phase 7.11 deferral note (REQUIREMENTS.md / `tasks/todo.md` tag) → **PR 2**
  - **06-05** — Thresholds-as-settings (heat-map green/red + outlet-tier 80/50/20) → **PR 3**
  - **06-06** — Geocoding (Google Maps, admin UI, full preview, skip-existing) → **PR 4**
  - **06-07** — D2 reversal-matcher scaffold + 2% orphan gap + cross-batch ORDER BY → **PR 5**

### Claude's Discretion

- D8 audit-log granularity: per-row vs per-cluster — **per-row** matches Phase 5.2 backfill pattern; planner may consolidate where it makes sense.
- D8 5.7 address-fix mechanism: Monday re-pull vs hand-edit — both supported; per-row choice depends on whether the bad row maps to a Monday source or is a manual entry.
- Thresholds admin route name (`/settings/thresholds` vs nested under analytics settings) — pick what fits existing nav.
- Threshold validation rules (min < max, percentile cutoffs sum-to-100, etc.) — sensible defaults at the form layer.
- Geocoding rate-limit strategy (Google's default ~50 req/sec is fine for 392 rows; no explicit throttle needed).
- Monday-client test fetch-stub style: `vi.fn()` per-test mocks (consistent with rest of repo); no MSW or Nock.
- Kiosk-config-groups regression fixture: extend existing Playwright fixtures; seed config group with ≥2 active locations + ≥1 active product; assert list page renders correct `productAvailability` and detail page renders members. Would catch a future `ANY(${ids})` regression.
- KPI tooltip text sourcing: author per-card, derived from the `tasks/todo.md` audit's resolved decision text (D1/D2/D3 etc) so tooltips match the canonical math definition.
- Phase 7.11 deferral mechanism: a short note in REQUIREMENTS.md (REPORT-V2-NN entry) plus a tagged "deferred to v2 maintenance-fee work" line in `tasks/todo.md` 7.11.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit-fix backlog (master source of truth for Phase 6 scope)

- `tasks/todo.md` — Resolved D-decisions D1–D13 (top of file) and Phase 1–8 line-items; the unchecked items here are Phase 6's scope
- `tasks/handoff-2026-04-27-pr-28-open.md` — §4 enumerates the open items with reasons; §3 has the Phase 5.2 backfill rollback pattern that informs D8 audit-log rollback
- `tasks/analytics-audit/multi-pos-merge-proposal.csv` — 22 clusters / 29 defunct rows; review UI in plan 06-01 reads this directly
- `tasks/analytics-audit/phase-5-1-investigation.md` — context on the assignedAt reseed (informs D8 audit-log shape)
- `tasks/analytics-audit/phase-7-6d-investigation.md` — Monday config-group sync semantics (referenced by 7.6a, useful context for any future Monday-import regressions)

### D8 multi-POS merge (plan 06-01)

- `src/lib/sales-csv.ts` — sales-record reversal-matching path; D8 merge rewrites `location_id` here
- `src/db/schema.ts` — `salesRecords`, `kioskAssignments`, `location*Memberships`, `locations` (FKs to rewrite, archive flag on locations)
- `scripts/backfill-kiosk-install-dates.ts` — pattern reference for audit-log-driven rollback (D-02)
- `src/app/(app)/settings/duplicates/` — likely host for the review UI (existing duplicates page; may extend or sister-route)

### Thresholds-as-settings (plan 06-05)

- `src/lib/analytics/thresholds-server.ts` — existing cached `appSettings` reader (extend pattern for new keys)
- `src/lib/analytics/display-timezone-server.ts` — companion cached-settings reader pattern
- `src/lib/analytics/queries/heat-map.ts` — heat-map green/red call site
- `src/lib/analytics/queries/outlet-tiers.ts` (or wherever `getOutletTiers` lives) — outlet-tier 80/50/20 magic numbers
- `src/lib/analytics/plateau-insight.ts` — `PLATEAU_THRESHOLD_PCT = 10` const stays as-is (deliberately excluded from this phase)
- `src/db/schema.ts` line ~98 — `appSettings` table definition

### Geocoding (plan 06-06)

- `src/db/schema.ts` — `locations.latitude`, `locations.longitude` columns (NULL today on ~392 rows)
- `src/app/(app)/settings/data-import/sales/pipeline.ts` — pattern reference for dry-run-then-apply admin UI flow
- `scripts/import-from-monday.ts` — pattern for chunked external-API calls with retry/rate-limit
- (No existing geocoding code — greenfield module under `src/lib/geocoding/` or similar)

### D2 reversal-matcher (plan 06-07)

- `src/lib/sales-csv.ts` — reversal matcher, in-batch and cross-batch matching paths
- `src/lib/__tests__/sales-csv.test.ts` (or adjacent) — existing test patterns
- `tasks/handoff-2026-04-27-pr-28-open.md` §4 — scope notes (cents-math is prophylactic; 2% orphan gap + ORDER BY are real)

### Test infrastructure (plan 06-02)

- `src/lib/__tests__/monday-client.test.ts` — the 14 `it.todo` placeholders
- `src/lib/monday-client.ts` — implementation under test
- `tests/e2e/kiosk-config-groups.spec.ts` (or wherever the existing spec lives) — extend with multi-location fixture

### KPI tooltip sweep (plan 06-03)

- `src/components/analytics/kpi-card.tsx` — `tooltip` prop (already shipped)
- `src/app/(app)/analytics/location-groups/capacity-metrics.tsx` — canonical example with Avg-Basket tooltip wired
- `src/app/(app)/analytics/{hotel-groups,regions,commission}/...` — call sites needing tooltips (~18+)

### Phase 7.11 deferral (plan 06-04)

- `.planning/REQUIREMENTS.md` — destination for the deferral note (likely under v2 / Notifications or new section)
- `tasks/todo.md` line for Phase 7.11 — re-tag with explicit deferral reason

### Project standards (cross-cutting)

- `.planning/PROJECT.md` — Out of Scope list (locks v2 boundaries)
- `.planning/ROADMAP.md` — Phase 6 scope and success criteria 1–10
- `CLAUDE.md` (project) — npm/lockfile drift Docker regen procedure (any dep added during this phase needs this); admin password rotation script doc
- `~/.claude/CLAUDE.md` — phase branching strategy, summary commits per plan, phase completion commit

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`appSettings` table** (`src/db/schema.ts:98`) — typed key-value store with `analytics_display_timezone`, `threshold_red_max`, `threshold_green_min` already living here. New threshold keys extend the same pattern.
- **`thresholds-server.ts` / `display-timezone-server.ts`** — cached server-side readers using Next `cache()` + `revalidateTag()` pattern. Direct templates for new threshold readers.
- **`KpiCard.tooltip` prop** — already shipped on Avg-Basket card; remaining work is text-only at each call site.
- **Monday import dry-run flow** (`src/app/(app)/settings/data-import/`) — six-state UI (connect → mapping → preview → import → complete) is a canonical pattern for the geocoding admin UI.
- **`scripts/backfill-kiosk-install-dates.ts`** — established pattern for SET LOCAL config flag + per-row audit-log + dry-run/apply CLI shape (D8 rollback can mirror).
- **Phase 5.3 immutability trigger** (migration 0036) — proves the `app.allow_*_mutation` GUC pattern works; D8 apply may need a similar guard for `sales_records.location_id` if we want to make rewrites tamper-evident long-term (likely overkill for this phase).
- **Existing duplicates page** (`src/app/(app)/settings/duplicates/`) — natural neighbour for the D8 cluster review UI (sister route or extension).
- **`audit_logs` table + `recordAuditEntry()` helper** — used everywhere; D8/geocoding/thresholds-save all write here.

### Established Patterns

- **Admin UI flow**: settings pages live under `src/app/(app)/settings/{name}/`; pipeline.ts hosts orchestration logic; actions.ts hosts server actions.
- **CLI script shape**: `scripts/<verb>-<noun>.ts` with `--dry-run` / `--apply` flags; reads `DATABASE_URL` from env; writes audit log per affected row; idempotent by design.
- **Cached server-side settings reads**: `cache()` wrapper + tag-based revalidation; tag pattern `analytics:thresholds`, `analytics:display_timezone`, etc.
- **Test stubs**: `vi.fn()` for unit tests, `test.fixme(...)` for Playwright placeholders (per Phase 02 conventions in STATE.md).
- **Per-phase branch with summary commits**: `gsd/phase-N-name`; per-plan PRs into phase branch; phase branch to main on full verification.

### Integration Points

- **`/settings/duplicates/merge-review`** (new) — D8 review UI; reads `multi-pos-merge-proposal.csv`, persists per-cluster decisions, hosts Apply button.
- **`/settings/thresholds`** (new) — admin UI for editing heat-map and outlet-tier thresholds; reads/writes `appSettings`.
- **`/settings/geocoding`** (new, or extend `/settings/data-import`) — admin UI for the Google Maps geocoding flow.
- **Existing FilterBar** — picks up new threshold URL params (`?greenMin=`, `?redMax=`, `?tierTop=` etc.) as temp overrides; "Save as default" button on `/settings/thresholds` writes back.
- **`audit_logs`** — every Phase 6 destructive op writes here (D8 row rewrites, threshold saves, geocoding populates, future kiosk-config-group bulk-assigns).
- **Vercel Production env** — needs `GOOGLE_MAPS_API_KEY` added before geocoding plan ships.

</code_context>

<specifics>
## Specific Ideas

- D8 review UI should feel like the existing `/settings/duplicates` and `/settings/outlet-types` admin surfaces — same chrome, same audit-log shape, same "show diff before commit" ergonomics.
- Geocoding dry-run preview should look like the Monday import preview (six-state flow). User explicitly wants to see all 392 rows before clicking Apply, not just summary stats.
- Thresholds editor should support per-session URL-param overrides (for what-if exploration) AND a deliberate "Save as default" button — mirrors how saved-views work for filters.
- D8 destructive merge ships **first** in the phase, not last — get the risky op out while attention is fresh and the rest of the work lands on a cleaned-up dataset.
- Plateau ±10% deliberately stays hard-coded for now — user excluded it from this phase's editable set despite the audit listing it.

</specifics>

<deferred>
## Deferred Ideas

- **Plateau ±10% threshold** lifted into settings — explicitly excluded from this phase. Future work when there's a "maturity insight thresholds" section worth its own admin surface.
- **Trend Builder auto-granularity thresholds (31/60/90/200)** as settings — these are smoothness tuning, not business thresholds; not surfaced as user-editable.
- **Per-user threshold overrides** — global only for now. Future if anyone actually asks.
- **D8 hybrid CSV+UI review** and **CLI apply path** — rejected; admin UI is the single review/apply surface.
- **Pre-merge `pg_dump` to S3** for D8 rollback — rejected; audit-log + Neon PITR is enough.
- **Hybrid Google+OSM geocoding** — rejected; Google Maps only for one-off + future re-imports.
- **Monday-client test infra rewrite (MSW / Nock)** — out of scope; `vi.fn()` per-test stubs are consistent with the repo.
- **Schema cleanup of redundant denormalized columns** (`locations.hotelGroup` text, `locations.operatingGroupId` FK — 0 rows populated, per D5) — explicitly deferred in `tasks/todo.md`; revisit in a dedicated cleanup pass post-Phase 6.
- **D2 cents-math hardening** beyond regression-test scaffold — handoff classifies as prophylactic at the magnitudes we see; in-scope is the orphan gap and ORDER BY determinism.
- **Drizzle upstream PR for `patches/drizzle-orm+0.45.2.patch`** — explicitly out of scope per ROADMAP.

### Reviewed Todos (not folded)

None — `gsd-tools todo match-phase 6` returned 0 matches; the audit backlog at `tasks/todo.md` is referenced as canonical scope source rather than as folded todos.

</deferred>

---

*Phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog*
*Context gathered: 2026-04-27*
