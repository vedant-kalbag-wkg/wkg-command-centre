# Kiosk Management Platform

## What This Is

An internal web app — branded **WeKnow Command Centre** in production — that replaces Monday.com as the system of record for managing 1,000+ kiosk deployments across hotel and venue locations. v1.0 ships four interchangeable views (Table / Kanban / Gantt / Calendar) over a normalised kiosk + location data model with temporal assignment history, plus a full analytics arc (dashboard, trends, maturity, heat map, outlet tiers, commission, flag review) wired into a destructive-data toolkit (multi-POS site merge, geocoding, threshold settings) hardened by operator UAT against prod. Used by Operations, IT, and broader analytics stakeholders (~30 users).

## Core Value

Operations and IT teams can accurately track, plan, and **report on** every kiosk deployment across all regions from a single tool that models the business's actual data structure — with analytics that Monday.com cannot produce. Validated in v1.0: the analytics-audit arc surfaced and resolved enough math discrepancies (D1–D10) that the dashboard suite is now the canonical revenue/maturity reference for the team.

## Current State

**Shipped:** v1.0 MVP — 2026-04-29 (see `MILESTONES.md`)

- 7 phases, 34 GSD plans, 61 tasks delivered
- 1,000+ kiosks across 373+ active locations on prod
- 37 prod DB migrations (0001 → 0037)
- ~92.8k LOC across 667 TS/TSX/SQL files
- Prod URL: `https://wkg-command-centre.vercel.app`

**Active:** v1.1 — Data foundation + email (scoping initiated 2026-05-03 via `/gsd-new-milestone`).

## Current Milestone: v1.1 — Data foundation + email

**Goal:** Establish Monday as authoritative source of truth via wipe-and-rebuild, ship transactional email + a single weekly POC underperformance alert (rescoped 2026-05-09 from broader notifications/reports), extend access control, polish — turning v1.0's MVP into the day-to-day ops platform the team operates from.

**Target features:**
- Data foundation rebuild from Monday — wipe-and-reseed, location-merge admin UI, same-name prevention guardrails, `LOCATION_NEEDED` sentinel, two-pass `assigned_at` seed rule (subsumes `DM-V2-01` + `DQ-V2-01/02/03` + `MIGR-07/08` from v1.0 carryover)
- Email infrastructure — Resend integration replacing nodemailer SMTP; self-serve change-password UI; forgot-password prod deliverability UAT; transactional alerts substrate
- POC underperformance alerts — single weekly Inngest cron emailing kiosk POCs when their `Live` kiosks fall into the bottom outlet-tier (`POC-ALERT-01`, depends on email substrate). Replaces broader NOTIF/REPORT scope, dropped 2026-05-09 with no v2 carry.
- Access control extended — configurable Ops/IT/Read-only tiers + custom granular roles
- Test coverage + tooling — staging orphan-rate baseline, Monday drift detection, analytics dashboards `useEffect → loadData()` migration, GitHub auto-delete-merged-branches
- Polish + tech debt — tab hover/loading polish, calendar empty-state overlay, bulk-action type-safety, Drizzle 0.45.2 patch audit

**Key context:**
- Phase numbering continues from v1.0's last phase — v1.1 starts at Phase 7
- "No manual SQL for ops cleanup" rule locked: every recurring destructive operator op is a first-class admin UI feature, not a script
- Monday is now the authoritative SoT for hotel/location identity; v1.1 codifies this through the data-reset and prevention guardrails
- Estimated 7-9 phases over 6-10 weeks (matches v1.0 cadence)
- Forward-looking deferrals: 2024-to-date sales corpus backfill (`.planning/seeds/v2-sales-corpus-backfill.md`), `freeTrialEndDate` analytics (tied to maintenance-fee recurring-revenue work), analytics CTE type-safety refactor

## Requirements

### Validated

#### Authentication & access control (Phase 1)

- ✓ Email/password auth with invite-only signup — v1.0
- ✓ Session persistence across browser refresh (30-day sliding) — v1.0
- ✓ Password reset via email link — v1.0 (infrastructure shipped; **see `EMAIL-V2-01` for prod deliverability gap**)
- ✓ Admin user management (invite / role-change / deactivate) — v1.0
- ✓ Sensitive-field redaction by role (banking details, contracts) — v1.0

#### Kiosk + location data model (Phase 2)

- ✓ Full kiosk record (20+ fields, configurable lifecycle pipeline, hardware/software/CMS metadata) — v1.0
- ✓ Configurable lifecycle stages (admin add/reorder/rename/remove, FLOAT8 ordering) — v1.0
- ✓ Temporal kiosk-to-venue assignment history — v1.0
- ✓ Location record with contracts (S3-backed file uploads + structured fields) and banking details — v1.0
- ✓ Kiosk and Location as separate entities joined by `kiosk_assignments` (not a simple `venue_id` FK) — v1.0

#### Views (Phases 2 + 3)

- ✓ Filterable, sortable, groupable Table view with show/hide columns — v1.0
- ✓ Saved views (filters / grouping / columns / sort) per viewType — v1.0
- ✓ Kanban with drag-to-update + alternative grouping — v1.0
- ✓ Gantt timeline with milestones and resource lanes (`@svar-ui/react-gantt`) — v1.0
- ✓ Calendar view with installation spans, milestones, trial-expiry events — v1.0
- ✓ 4-tab `?view=` URL-bookmarkable navigation — v1.0

#### Bulk + audit (Phase 2)

- ✓ Multi-select bulk edit + archive — v1.0
- ✓ CSV export of filtered table data — v1.0
- ✓ Application-layer audit log (per-record + global) with denormalised actor/entity names — v1.0

#### Migration (Phases 4 + 4.1)

- ✓ Monday.com GraphQL importer with dry-run, pagination, retry, rate-limit handling — v1.0
- ✓ Three-board sequential import (hardware → hotels → kiosk-config-groups) — v1.0
- ✓ Per-hotel product configuration with provider + commission tiers — v1.0
- ✓ Field-mapper correctness pass (Phase 4.1): kioskId from Asset ID, region/locationGroup/internalPoc on locations, dedicated Products + Kiosk Config Groups tabs — v1.0
- ⚠ Same-name location collapse — display-only suffix strip in v1.0; bulk merge → DM-V2-01

#### Reporting (Phase 5, off-GSD)

- ✓ Dashboard with fleet health, pipeline breakdown, key metrics — v1.0
- ✓ Time-series charts (Trend Builder, Maturity, Heat Map) — v1.0
- ✓ Drill-down summary → hotel-group → outlet → kiosk — v1.0
- ✓ Global FilterBar with region / phase / hotel-group / date — v1.0
- ✓ Commission, Flag Review, Actions Dashboard, Performer Patterns, Experiments — v1.0
- ✓ D2 reversal-matcher determinism fix (Phase 6) — v1.0

#### Operational tooling (Phase 6)

- ✓ D8 multi-POS site merge — applied to prod (4,171 sales rewrites, 19 archives) — v1.0
- ✓ /settings/geocoding admin UI with Google Maps integration — 313 lat/lng populated — v1.0
- ✓ Outlet-tier thresholds-as-settings (admin UI + URL-param overrides) — v1.0
- ✓ KPI tooltips citing audit-fix D-decisions on 26/27 cards — v1.0

### Active (v1.1 — Data foundation + email)

#### A. Data foundation rebuild

- [ ] Wipe-and-rebuild from Monday — establish Monday as authoritative SoT for location identity (subsumes the v1.0 carryover items `DM-V2-01`, `DQ-V2-01`, `DQ-V2-02`, `DQ-V2-03`, `MIGR-07`, `MIGR-08`)
- [ ] Location-merge admin UI — first-class operator feature for collapsing same-name location rows; replaces `scripts/multi-pos-merge.ts`
- [ ] Same-name prevention guardrails — DB unique partial index + dry-run import warnings + admin alerts
- [ ] `LOCATION_NEEDED` sentinel — sales ETL fallback for unknown outlet codes
- [ ] Two-pass `assigned_at` seed rule — `live_date` primary, earliest CSV sale fallback (reuses `scripts/backfill-kiosk-install-dates.ts`)

Full design in `.planning/notes/v2-data-reset-decision.md`; phase strawman in `.planning/seeds/v2-data-reset-phase.md`.

#### B. Email infrastructure (locked: Resend primary, Brevo fallback)

- [ ] Resend integration replacing nodemailer SMTP — fixes silent-fail prod forgot-password (`EMAIL-01`)
- [ ] Self-serve change-password from `/account/security` (`EMAIL-02`)
- [ ] Forgot-password end-to-end deliverability UAT against prod (`EMAIL-03`)
- [ ] Transactional alerts substrate (`email_jobs` queue + cron worker + branded templates) — substrate for category C (`EMAIL-04`)

#### C. POC underperformance alerts

> Rescoped 2026-05-09 — original NOTIF/REPORT scope dropped (no v2 carry). See `.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md` for rationale.

- [x] Weekly bottom-tier POC email alert (`POC-ALERT-01`) — depends on `EMAIL-04`. **Code-complete 2026-05-09; awaiting Playwright UAT against preview alias.** Inngest cron (Mondays 09:00 Europe/London) classifies `Live` kiosks against existing percentile cutoffs over an admin-tunable trailing window; emails `kiosks.internal_poc_id` on flip-into-bottom + monthly thereafter; admin per-kiosk silencing; `/admin/performance-alerts` read-only page + "Run now" trigger.

#### D. Access control extended

- [ ] Configurable Ops/IT/Read-only RBAC tiers (`AUTH-05`)
- [ ] Custom granular roles (`AUTH-06`)

#### E. Test coverage + tooling

- [ ] Staging orphan-rate baseline measurement (`TEST-01`)
- [ ] Bidirectional Monday sync / drift detection (`MONDAY-01`) — reframed: Monday is now SoT, "drift" means Monday changed and we need to re-import
- [ ] Analytics dashboards `useEffect → loadData()` migration off `react-hooks/set-state-in-effect` (`REF-01`)
- [ ] GitHub auto-delete-merged-branches toggle (`INFRA-01`)

#### G. Forex normalisation (cross-currency analytics)

> **Inserted 2026-05-09** as Phase 9.1 (INSERTED) tracking GitHub issue #39, surfaced from PR #38 code review where the cross-currency mis-ranking gap was identified in `classifyEligibleLocations`. Cross-currency analytics now in scope: Bank of England daily spot rates ingested via Inngest cron; `sales_records.net_amount_gbp` denormalised at ingest with carry-forward + 7-day staleness ceiling; analytics aggregates dual-emit native + GBP + currency-key for renderer auto-pick; classifier + commission processor rank on GBP; per-kiosk POC email continues native via existing `format-currency.ts`.

- [x] Cross-currency analytics: Bank of England daily spot rates ingested via Inngest; sales_records.net_amount_gbp denormalised at ingest; analytics aggregates dual-emit native + GBP + currency-key; classifier + commission rank on GBP. **Code-complete + automated verification passed 2026-05-10 (Phase 9.1, 11 plans = 8 original + 3 gap closure rounds; 16/16 must-haves verified); awaiting Playwright UAT against preview alias per CLAUDE.md gate.** (`FX-01`, `FX-02`, `FX-03`, `FX-04`)

#### F. Polish + tech debt

- [ ] Tab hover state + loading indicator for heavy view-switches (`POLISH-01`) — resolves `.planning/debug/tab-hover-loading-state.md`
- [ ] Calendar empty-state overlay visual distinction (`POLISH-02`) — resolves `.planning/debug/calendar-empty-state-overlay.md`
- [ ] Bulk action type-safety — Zod-validated patch objects in `src/app/(app)/kiosks/bulk-actions.ts` + `src/app/(app)/locations/bulk-actions.ts` (`DEBT-01`)
- [ ] Drizzle 0.45.2 patch audit — confirm if 0.46+ supersedes the hash-based migration detection patch (`DEBT-02`)

#### Deferred beyond v1.1

- [ ] `freeTrialEndDate` analytics — pickup tied to maintenance-fee recurring-revenue work (originally `REPORT-V2-03`)
- [ ] Analytics CTE type-safety refactor — `db as any` in 11 analytics query files; significant scope, defer to v1.2 / v2.0
- [ ] 2024-to-date sales corpus backfill + Azure daily ETL takeover — see `.planning/seeds/v2-sales-corpus-backfill.md`
- [ ] `multi-pos-merge.ts` single-pair fixture (originally `TEST-V2-01`) — drops with location-merge UI; coverage moves to UI-level tests in category A

### Out of Scope

| Feature | Reason |
|---------|--------|
| SSO/OAuth login | Email/password sufficient for v1; current user count doesn't justify SSO complexity. Revisit if user base broadens beyond ~50. |
| Mobile native app | Web-first; tested working on mobile browsers. No revisit planned. |
| Real-time collaboration (live cursors, co-editing) | Not relevant to asset-management workflows. Confirmed in v1.0 — no user feedback requesting it. |
| External/customer-facing portal | Internal tool only. **Locked behind `archive/portal-lockdown-2026-04-25` branch**; explicit non-goal in v2.0. |
| IoT/telemetry monitoring | Kiosk health monitoring is a separate system. Not revisited. |
| Billing/invoicing | Handled in separate financial systems. Not revisited. |
| Real-time chat | Not relevant. Not revisited. |
| Map view / geographic visualisation | Server-side geocoding (`/settings/geocoding`, shipped in v1.0) is sufficient for ops needs — operators don't need to see kiosks plotted on a map. v1.1 research preserved at `.planning/research/v1.1-map-library.md` if the call ever reverses. |

## Context

- v1.0 replaced Monday.com as the canonical source of truth on 2026-04-29. Monday.com remains the upstream-only data feed for hotel-board enrichment via `enrich-locations-from-monday.ts` (one-way, NULL-fields-only).
- Stack: Next.js 16 (App Router), Drizzle ORM 0.45.2 (with patch `patches/drizzle-orm+0.45.2.patch`), Neon Postgres (pooled connection), Better Auth 1.5, TanStack Table v8, Zustand, dnd-kit, `@svar-ui/react-gantt`, react-big-calendar, Tailwind v4 with WeKnow brand tokens, shadcn/ui + base-ui, Vercel hosting.
- 1,000+ kiosk records across 373+ active locations on prod (post-Wave 1+2 cleanup). 312 lat/lng populated; 61 still NULL pending v2 hand-edit.
- 30+ users across Operations, IT, and read-only stakeholders across UK, AU, EU regions.
- Prod admin: `vedant.kalbag@weknowgroup.com`. Rotation script: `scripts/reset-admin-password.ts` (see `CLAUDE.md`).
- Lockfile drift recurring failure mode (macOS-arm64 vs Linux-x64) — canonical regen via `linux/amd64` Docker per `CLAUDE.md`.
- Vercel preview env-var pinning: `BETTER_AUTH_URL` must use the git-branch alias, not the per-deploy URL — see `CLAUDE.md`.

## Constraints

- **Hosting:** Vercel (Next.js) + Neon Postgres + AWS S3 (eu-west-2) for contract documents
- **Authentication:** Email/password only (no SSO) — invite-only, no public registration
- **Email:** Currently nodemailer SMTP defaulting to localhost:1025 — silent-fail in prod. v2 lock: Resend primary, Brevo fallback (documented but not implemented)
- **Data sources:** Monday.com (one-way enrichment), historical sales data ingested via `etl-azure` arc
- **Scale:** 1,000+ kiosk records, ~30 concurrent users, prod sales tables in low millions of rows
- **Brand:** We Know Group brand guidelines — Azure `#00A6D3`, Graphite `#121212`, Circular Pro font (see `~/.claude/weknow-brand-guidelines.md`)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Better Auth 1.5.x for auth/RBAC | Auth.js on security-only maintenance; Lucia deprecated | ✓ Good — invite-only flow + 30-day sliding sessions shipped clean |
| `kiosk_assignments` temporal join table (not `venue_id` FK) | Assignment history is the primary Monday.com differentiator | ✓ Good — drove Phase 5.2 prod backfill (362 → `live_date`) |
| FLOAT8 for pipeline-stage ordering | Avoids batch UPDATE race conditions on reorder | ✓ Good — no race conditions observed in v1.0 |
| Application-layer audit log with denormalised actor/entity names | DB triggers cannot provide business context | ✓ Good — global audit log with cursor pagination shipped |
| Phase 4 depends on Phase 2, not Phase 3 | Schema must be stable before Monday.com import | ✓ Good — no migration churn during Phase 4 |
| Phase 5 delivered off-GSD via PR-driven development | Reporting needed real data + iteration speed | ⚠ Revisit — worked but lost the GSD audit trail; see RETROSPECTIVE.md |
| ClickUp-style configurable pipeline (not fixed stages) | Business needs evolve; new statuses without dev intervention | ✓ Good — admin UI shipped, used for stage additions |
| Monday import: hardware first, hotels second, config groups third | Establishes kiosk identities before associations | ✓ Good — three-step import shipped |
| Asset ID (Monday `item.name`) as `kiosks.kioskId` (not Region+outlet_code) | Monday data model misread in initial requirements; Asset ID is the stable hardware identity | ✓ Good — MIGR-04 superseded with this rationale documented |
| Multi-kiosk-per-site over same-name collapse for v1.0 | Operational ambiguity; collapse policy needs explicit user signoff | — Pending — DM-V2-01 in v2 |
| In-memory geocoding staging (no `geocoding_stagings` table) | ~80KB fits client React state; cancel becomes trivially correct | ✓ Good — symmetric stage/commit/cancel verbs leave persistence as a future swap |
| Resend as v2 email provider (Brevo fallback documented) | Best Next.js/Vercel DX, EU region for GDPR, free tier covers volume | — Pending — locked at v1.0 milestone close 2026-04-29 |
| ALL-OR-NOTHING single-transaction multi-POS merge | D-03 from Phase 6.1; partial-merge state is unrecoverable for sales rewrites | ✓ Good — 4,171-row prod merge applied atomically |
| Tooltip-as-audit-trace for analytics KPIs | Surfaces D1/D2/D3/D5/D7/D9/D10 mappings to operators reading the dashboard | ✓ Good — closes SC5; pattern reusable for v2 |
| Phase 7.11 (`freeTrialEndDate` analytics) explicit deferral | Tied to maintenance-fee recurring-revenue work, not yet scoped | — Pending — REPORT-V2-03 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-10 — Phase 9.1 (Multi-currency forex normalisation) automated verification passed 16/16; HUMAN-UAT operator gate pending against preview alias before merge*
