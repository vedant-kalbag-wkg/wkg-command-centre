# Phase 6: Post-audit Operational Follow-ups - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog
**Areas discussed:** D8 multi-POS merge, Thresholds-as-settings, Geocoding, PR sequencing & bundling

---

## Gray-area selection

User selected all four areas:

| Area | Description | Selected |
|------|-------------|----------|
| PR sequencing & bundling | Order, grouping, branching strategy for 6-8 PRs | ✓ |
| D8 multi-POS merge — review & rollback | 22 clusters review; destructive apply | ✓ |
| Thresholds-as-settings — scope & UX | Which thresholds editable, where stored, URL semantics | ✓ |
| Geocoding — provider & invocation | Google vs OSM, admin UI vs script, dry-run shape | ✓ |

---

## D8 Multi-POS Merge

**Context bracket:** User asked for clarification on what a "cluster" meant before answering Q2-Q4. Re-asked after explaining clusters with concrete examples (Hotel Berlin / Heathrow Marriott / Gloucester Hotel Indigo) from the multi-POS proposal CSV.

### Q1: How does the human approve the 22 clusters before apply?

| Option | Description | Selected |
|--------|-------------|----------|
| Edit CSV, re-run script | User edits the CSV, apply script reads verbatim. CLI-driven. | |
| Per-cluster admin UI signoff | Build review page, persist decisions to merge_proposals table | ✓ |
| Hybrid: CSV review + admin Apply button | Manual CSV review, admin UI for apply | |

**User's choice:** Per-cluster admin UI signoff
**Notes:** Higher polish — review surface for 22 clusters with approve/reject/swap-canonical per cluster.

### Q2: What's the rollback safety net for the apply step?

| Option | Description | Selected |
|--------|-------------|----------|
| Audit log only | Per-row audit_logs entries, SQL-reverse via metadata predicate. Neon PITR backstops. | ✓ |
| Audit log + dedicated rollback script | Plus `scripts/rollback-multi-pos-merge.ts` | |
| Audit log + pre-merge SQL dump to S3 | Pre-apply pg_dump of affected rows | |

**User's choice:** Audit log only
**Notes:** Mirrors Phase 5.2 backfill rollback pattern. Neon's 7-day PITR is the secondary backstop.

### Q3: How is the apply step invoked?

| Option | Description | Selected |
|--------|-------------|----------|
| Apply button on the same review page | Server action, single transaction, audit log on apply | ✓ |
| Admin UI signoff + CLI apply | UI persists decisions; shell runs apply | |
| Both: server action AND CLI | Belt-and-braces | |

**User's choice:** Apply button on the same review page
**Notes:** Consistent with the per-cluster UI choice in Q1. No shell access needed.

### Q4: Address-data-quality fix (5.7) — same PR or separate?

| Option | Description | Selected |
|--------|-------------|----------|
| Same PR as 5.5/5.6 | One coherent destructive cleanup | ✓ |
| Separate PR after merge lands | Cleaner blast-radius separation | |
| Defer 5.7 to vNext | 5.5/5.6 only this phase | |

**User's choice:** Same PR as 5.5/5.6
**Notes:** The review UI naturally surfaces address-mismatches as "reject merge — fix addresses instead", so corrections ride along.

### Continuation check

User chose: **Move to Thresholds-as-settings**. Remaining D8 sub-decisions captured as Claude's Discretion.

---

## Thresholds-as-settings

### Q1 (multi-select): Which thresholds become editable in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Plateau ±10% | `PLATEAU_THRESHOLD_PCT` from plateau-insight.ts | |
| Heat-map green/red | `threshold_green_min` / `threshold_red_max` | ✓ |
| Outlet-tier 80/50/20 | Top/Mid/Bottom tier percentile cutoffs | ✓ |
| Trend-builder granularity 31/60/90/200 | Auto-granularity thresholds | |

**User's choice:** Heat-map green/red + Outlet-tier 80/50/20
**Notes:** Plateau ±10% deliberately excluded despite being recommended. Trend-builder granularity also excluded (smoothness tuning, not business threshold).

### Q2: Where do the new threshold settings live?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing appSettings table | Same key-value pattern as analytics_display_timezone | ✓ |
| New dedicated `analytics_thresholds` table | Typed columns per threshold | |

**User's choice:** Extend existing appSettings table

### Q3: Are thresholds global or per-user?

| Option | Description | Selected |
|--------|-------------|----------|
| Global | One set platform-wide, admin-only edit | ✓ |
| Per-user with global default | Each user can override | |

**User's choice:** Global

### Q4: URL-param semantics for threshold overrides?

| Option | Description | Selected |
|--------|-------------|----------|
| Temp override only | URL params override saved setting; explicit Save-as-default button | ✓ |
| URL params auto-save | Any URL change persists immediately | |
| URL = read-only display | URL reflects saved default; no per-view override | |

**User's choice:** Temp override only

### Continuation check

User chose: **Move to Geocoding**.

---

## Geocoding

### Q1: Which geocoding provider?

| Option | Description | Selected |
|--------|-------------|----------|
| Google Maps Geocoding API | Best accuracy, ~$2 for 392 outlets, paid | ✓ |
| OSM Nominatim (free) | Free, 1 req/sec, less accurate | |
| Hybrid: Google primary, OSM fallback | ~2x work | |

**User's choice:** Google Maps Geocoding API
**Notes:** Used downstream for D6 timezone refinement (geo-tz lookup) when that lands.

### Q2: How is geocoding triggered?

| Option | Description | Selected |
|--------|-------------|----------|
| Admin UI button | Settings page, server action with progress polling | ✓ |
| CLI script with --dry-run/--apply | Same pattern as backfill scripts | |
| Both (admin UI primary, CLI mirror) | Belt-and-braces | |

**User's choice:** Admin UI button

### Q3: What does dry-run show before commit?

| Option | Description | Selected |
|--------|-------------|----------|
| Full preview table | All 392 rows with proposed lat/lng + confidence | ✓ |
| Summary stats only | "X populated, Y skipped, Z failed" | |
| Diff-only (only NULL rows) | Skip rows with existing lat/lng in preview | |

**User's choice:** Full preview table

### Q4: Re-run / idempotency / overwrite policy?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip rows with lat/lng | Idempotent; force-overwrite via checkbox | ✓ |
| Always overwrite from geocoder | Truth = geocoder; clobbers manual edits | |
| Skip + log mismatches | Skip + surface geocoder/stored disagreements | |

**User's choice:** Skip rows with lat/lng
**Notes:** Aligns with D6's manual-override convention for `iana_timezone`.

### Continuation check

User chose: **Move to PR sequencing**.

---

## PR Sequencing & Bundling

### Q1: How do you want to slice these into PRs?

| Option | Description | Selected |
|--------|-------------|----------|
| One PR per workstream | 7 PRs, 1:1 with workstreams | |
| Bundle low-risk cleanup into one PR | 5 PRs: A+B+C bundled, then D, E, F, G | ✓ |
| Parallelisable PRs in waves | Wave 1 parallel + Wave 2 D8 closer | |

**User's choice:** Bundle low-risk cleanup into one PR

### Q2: What's the execution order?

| Option | Description | Selected |
|--------|-------------|----------|
| Test infra first, D8 merge last | A → B/C → D → E → F → G | |
| D8 merge first | G → A/B/C → D → E → F | ✓ |
| Independent / by author availability | No prescribed order | |

**User's choice:** D8 merge first
**Notes:** Get the destructive op out of the way while attention is fresh; rest lands on cleaned-up dataset.

### Q3: Branch strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase branch + per-PR sub-branches | Integration branch + short-lived plan branches | ✓ |
| Per-PR branches off main directly | No integration branch | |

**User's choice:** Phase branch + per-PR sub-branches
**Notes:** Per CLAUDE.md preference for phase branching + summary commits.

### Q4: Plan-to-workstream mapping?

| Option | Description | Selected |
|--------|-------------|----------|
| One plan per workstream, 7 plans total | 1:1 mapping with PR slicing | ✓ |
| Group trivials, 5 plans total | Plans match PR shape | |
| Let the planner decide | Defer to /gsd:plan-phase | |

**User's choice:** One plan per workstream, 7 plans total
**Notes:** Resolves with Q1 (5 PRs) as: 7 plans, 5 PRs — plans 06-02/03/04 ship as one bundled cleanup PR.

### Continuation check

User chose: **Write CONTEXT.md (Recommended)**.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` section under "Claude's Discretion":

- D8 audit-log granularity per-row vs per-cluster
- D8 5.7 address-fix mechanism (Monday re-pull vs hand-edit)
- Thresholds admin UI route name
- Threshold validation rules
- Geocoding rate-limit strategy
- Monday-client test fetch-stub style (`vi.fn()`)
- Kiosk-config-groups regression fixture seed shape
- KPI tooltip text sourcing (from audit's resolved decision text)
- Phase 7.11 deferral mechanism (REQUIREMENTS.md note + tasks/todo.md tag)

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section:

- Plateau ±10% threshold as setting
- Trend Builder auto-granularity thresholds as settings
- Per-user threshold overrides
- D8 hybrid CSV+UI review and CLI apply path
- D8 pre-merge pg_dump to S3
- Hybrid Google+OSM geocoding
- Monday-client test infra rewrite (MSW / Nock)
- Schema cleanup of redundant denormalized columns
- D2 cents-math hardening beyond regression scaffold
- Drizzle upstream PR for `patches/drizzle-orm+0.45.2.patch`
