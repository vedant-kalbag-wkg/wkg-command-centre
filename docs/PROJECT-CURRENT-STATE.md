# WeKnow Command Centre — Current State & Requirements

**Document scope:** Consolidated current-state reference for the kiosk management platform across **v1.0** (shipped 2026-04-29) and **v1.1** (in flight, Phase 10 active 2026-05-10). Synthesised from `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/MILESTONES.md`, `.planning/RETROSPECTIVE.md`, the v1.0 archive in `.planning/milestones/`, every per-phase CONTEXT/PLAN/SUMMARY artifact, and `tasks/v2-carryover-from-v1-phase-6.md`.

**Last updated:** 2026-05-10
**Production URL:** https://wkg-command-centre.vercel.app
**Active branch:** `gsd/phase-10-access-control-extended`

---

## 1. What This Product Is

An internal web application — branded **WeKnow Command Centre** in production — that replaced Monday.com as the system of record for managing **1,000+ kiosk deployments across 373+ active hotel/venue locations**. Used by ~30 users in Operations, IT, and read-only stakeholder roles across UK, AU, and EU regions.

**Core value:**

- Four interchangeable views (Table / Kanban / Gantt / Calendar) over a normalised kiosk + location data model with temporal assignment history.
- A full analytics arc: dashboard, trend builder, maturity, heat map, outlet tiers, commission, flag review.
- A destructive-data toolkit (multi-POS site merge, server-side geocoding, threshold settings) hardened by operator UAT against prod.
- Cross-currency-correct reporting via daily Bank-of-England FX normalisation to GBP base (v1.1).
- Weekly POC underperformance alerting to surface bottom-tier kiosks (v1.1).
- CASL-driven configurable RBAC with admin-authorable custom roles (v1.1, Phase 10 in flight).

Monday.com remains the **upstream-only data feed** for hotel-board enrichment via `enrich-locations-from-monday.ts` (one-way, NULL-fields-only). Sales data ingests through the `etl-azure` arc.

---

## 2. Tech Stack & Operational Constraints

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| ORM | Drizzle ORM 0.45.2 (with `patches/drizzle-orm+0.45.2.patch`) |
| Database | Neon Postgres (pooled connection) |
| Auth | Better Auth 1.5 (email/password, invite-only, no SSO) |
| Tables | TanStack Table v8 |
| State | Zustand |
| Drag/drop | dnd-kit |
| Gantt | `@svar-ui/react-gantt` |
| Calendar | react-big-calendar |
| Styling | Tailwind v4 with WeKnow brand tokens |
| UI primitives | shadcn/ui + base-ui |
| Email | Resend (primary) + Brevo (fallback documented), via Inngest for queue + retry |
| Async / scheduled | Inngest 4.2.6 (POC alerts cron, FX cron, email retries) |
| File storage | AWS S3 eu-west-2 (contract documents) |
| Hosting | Vercel |
| Brand | We Know Group — Azure `#00A6D3`, Graphite `#121212`, Circular Pro |

**Operational constraints:**

- **Lockfile drift** — macOS-arm64 ↔ Linux-x64 platform skew breaks `npm ci` repeatedly. Canonical regen path is the `linux/amd64` Docker procedure documented in `CLAUDE.md`.
- **Vercel preview env vars** — `BETTER_AUTH_URL` must use the **git-branch alias** (not the per-deploy URL), or every redeploy invalidates Better Auth's `trustedOrigins` and `/api/auth/*` returns 403.
- **Prod admin** — `vedant.kalbag@weknowgroup.com`. Rotation script: `scripts/reset-admin-password.ts`.
- **Lockdown** — external/customer-facing portal is a non-goal, locked behind the `archive/portal-lockdown-2026-04-25` branch.

**Process & QA policy** (not a tech constraint, but enforced by convention — codified in repo `CLAUDE.md`):

- Playwright is the mandatory first-layer UAT. Every user-facing feature needs at least one happy-path spec and one edge-case spec, run against the preview alias before the phase is "done". `--list` passing is not sufficient evidence.

---

## 3. Data Model — Current State

| Entity | Notes |
|---|---|
| `user` / `account` (Better Auth) | Email/password credentials. `user.role` is text in v1.0; in Phase 10 (v1.1) replaced by `role_id` FK with multi-role IAM-style assignment. |
| `locations` | One row per hotel; **same-name pairs allowed today** (multi-kiosk-per-site interpretation). Phase 7 added partial unique index on `normalised_name WHERE archived_at IS NULL`. Holds region FK, location group, internal POC, status, banking details, contracts (S3-backed), lat/lng. |
| `kiosks` | 20+ fields; hardware/software/CMS metadata. `kioskId` derived from Monday Asset ID (item.name). `outlet_code` lives here (per-kiosk, not per-location). `alert_silenced_at` + `alert_silenced_reason` added in Phase 9. |
| `kiosk_assignments` | Temporal join — kiosk × location × assigned_at × ended_at. Validated when Phase 5.2 backfilled 362 → `live_date`. |
| `pipeline_stages` | Configurable, FLOAT8-ordered for race-free reorder; admin can add/rename/remove. |
| `audit_logs` | Application-layer, denormalised actor/entity names; per-record `AuditTimeline` + global admin log. |
| `user_views` | Saved view configs (filters/group/columns/sort) per viewType. |
| `products` / `providers` / `location_products` | Per-location product configuration (Phase 4). |
| `kiosk_config_groups` / `app_settings` | Phase 4.1 — third Monday board + admin-tunable thresholds. |
| `merge_proposals` | Phase 6.1 multi-POS merge proposal lifecycle. |
| `email_log` | Phase 8 — `payloadHash` unique idx for digest idempotency; records `resend_message_id`. |
| `kiosk_performance_alert_state` | Phase 9 — prior tier + `last_alerted_at` for flip-in + 30-day cap. |
| `exchange_rates(currency, rate_date, rate_to_gbp, source, fetched_at)` | Phase 9.1 — composite PK `(currency, rate_date)`; carry-forward lookup. |
| `sales_records.net_amount_gbp numeric(12,2)` | Phase 9.1 — stamped at ingest with BoE rate; backfilled historically; identity for `currency='GBP'`. |
| `roles` / `role_permissions` / `user_roles` (Phase 10) | Hybrid normalised role schema; CASL rules persisted as JSON; per-(user, role, dimension) scope binding; explicit-deny-wins (AWS IAM). |

**Locked invariants:**
- Monday is the authoritative SoT for hotel/location identity (codified in `.planning/notes/v2-data-reset-decision.md`).
- Sales ETL with unknown outlet code creates kiosk + assigns to global `LOCATION_NEEDED` sentinel.
- Two-pass `assigned_at` seed: `live_date` primary, `MIN(salesRecords.date)` fallback.
- No manual SQL for recurring destructive operator ops — admin UI features only.

---

## 4. v1.0 — MVP — Kiosk Management Platform

**Scoped:** 2026-03-?? · **Shipped:** 2026-04-29 · **Phases:** 6 (with one `4.1` decimal insertion).

### Phase 1 — Foundation (3/3 plans, completed 2026-03-18)

**Goal:** Working auth layer, three-role access control, fully-normalised DB schema ready for downstream features.
**Requirements:** AUTH-01..05.
**Success criteria:** account create/login/refresh, password reset via email, admin user management, Read-only role enforcement, sensitive-field redaction.

| Plan | Scope |
|---|---|
| 01-01 | Project scaffold — Next.js 16, Drizzle, Neon, Tailwind v4, shadcn/ui |
| 01-02 | Better Auth — email/password, 30-day sliding sessions, password reset |
| 01-03 | RBAC + full DB schema — roles, kiosks, locations, kiosk_assignments, pipeline_stages, audit_logs, user_views |

### Phase 2 — Core Entities and Views (9/9 plans, completed 2026-03-19)

**Goal:** Manage all kiosk + location records, filterable Table + Kanban views, saved views, bulk-edit, CSV export, full audit trail.
**Requirements:** KIOSK-01..06, LOC-01..05, VIEW-01..05, KANBAN-01..03, BULK-01..02, AUDIT-01..03.

| Plan | Scope |
|---|---|
| 02-00 | Wave 0: Playwright stubs + shared helpers |
| 02-01 | Kiosk CRUD, inline editing, venue assignment with history, archivedAt schema, audit helper, pipeline-stage seed |
| 02-02 | Location CRUD, S3 contract uploads, banking details with role gate, key contacts editor |
| 02-03 | Table view — TanStack Table v8, Zustand View Engine, filter/sort/group/column-visibility, saved views |
| 02-04 | Kanban — dnd-kit drag-to-update, switchable grouping, pipeline-stage management with colour picker |
| 02-05 | Bulk operations (multi-select edit/archive), CSV export, per-record + global audit timeline |
| 02-06 | UAT gap closure — viewport overflow, save-view button pinning, key-contacts blur-save |
| 02-07 | UAT gap closure — Kanban click-to-overlay sheet |
| 02-08 | UAT gap closure — inline table editing + header column filters/sort |

### Phase 3 — Advanced Views (5/5 plans, completed 2026-03-21)

**Goal:** Gantt timelines + calendar event tracking for deployment planning.
**Requirements:** GANTT-01..04, CAL-01..02.

| Plan | Scope |
|---|---|
| 03-01 | Schema extension — installations, milestones, members, kiosk links + server actions + Playwright stubs |
| 03-02 | Installation CRUD pages + sidebar nav + milestone/team-member management |
| 03-03 | Gantt — `@svar-ui/react-gantt`, Azure/Graphite theming, grouped bars, milestones, resource columns, pending-drag |
| 03-04 | Calendar — react-big-calendar, 3 event types, filters, popovers |
| 03-05 | View integration — `?view=` URL params, Gantt/Calendar tabs on Kiosks page, saved-views extension |

### Phase 4 — Data Migration (4/4 plans, completed 2026-04-01)

**Goal:** Import all Monday.com kiosk + location records (incl. subitem product/provider/commission data) with correct field mapping, dry-run preview, and per-hotel product config UI.
**Requirements:** MIGR-01..03.

| Plan | Scope |
|---|---|
| 04-00 | Wave 0 — schema (products, providers, location_products), Vitest config, unit + Playwright stubs |
| 04-01 | Monday GraphQL client (pagination, retry), field mapper engine, subitem parser, server actions |
| 04-02 | Data Import UI — Settings card + 6-state flow (connect → mapping → preview → import → complete) |
| 04-03 | Location product configuration — Products tab, per-location product editor |

### Phase 4.1 — Data Migration Quality & Correctness (INSERTED, 6/6 plans, completed 2026-04-01)

**Goal:** Fix import quality issues surfaced post-Phase-4: field mappings, kioskId derivation, table displays, location schema extensions, dedicated Products tab, Kiosk Groups from a separate Monday board.
**Requirements:** MIGR-04..15. **Note:** MIGR-04 superseded — Asset ID (Monday `item.name`) became `kiosks.kioskId` (Region+outlet was a misread of the Monday model).

| Plan | Scope |
|---|---|
| 04.1-01 | Schema extension (4 location fields, kioskConfigGroups, appSettings), 5 field-mapper bug fixes, normaliseLocationName |
| 04.1-02 | Import flow extension — three-board ID input |
| 04.1-03 | Kiosk Groups import from Monday board 1466686598 |
| 04.1-04 | Table-display cleanup — kiosk + location columns realigned |
| 04.1-05 | Products tab promotion (out of location detail, into sidebar) |
| 04.1-06 | Hardware-first import order — board 1426737864 first, hotels second |

### Phase 5 — Reporting & Dashboard (delivered off-GSD, completed 2026-04-27)

**Goal:** Real-time fleet-health dashboard on login + time-series trends + region-to-kiosk drill-down + filter-by-any-dimension.
**Requirements:** REPORT-01..04. **All shipped via PRs #23 → #29** (driver swap, Sales/Revenue mode, AU region, Azure ETL smoke, portal lockdown, full analytics-audit fix arc Phases 1-8 over migrations 0027-0037 + 4 backfill scripts). No GSD plans authored — explicit decision logged in retrospective; lost the GSD audit trail but bought iteration speed.

### Phase 6 — Post-audit Operational Follow-ups (7/7 plans, completed 2026-04-28)

**Goal:** Close every non-trivial outstanding item from the analytics-audit arc so v1.0 reaches a fully-stable operational baseline.
**Requirements:** Derived from `tasks/todo.md` audit-fix backlog + carry-overs.

| Sub-phase | Scope | Outcome |
|---|---|---|
| 6.1 | D8 multi-POS site merge UI + apply | 4,171 sales rewrites, 19 archives applied to prod |
| 6.2 + 6.6 | Thresholds-as-settings (admin UI + URL-param overrides + audit log) | Plateau / heat-map / outlet-tier thresholds editable without deploy |
| 6.3 | KPI tooltip rollout | 26/27 KPI cards cite audit-fix D-decisions (D1/D2/D3/D5/D7/D9/D10) |
| 6.4 | D2 reversal-matcher follow-ups | In-batch hardening + cross-batch ORDER BY determinism + regression scaffold |
| 6.5 | Monday-client unit tests | All 14 originally-placeholder cases covered |
| 6.6 | `/settings/geocoding` admin UI + Google Maps | 313 lat/lng populated; in-memory staging (no `geocoding_stagings` table) |
| 6.7 | Phase 7.11 (`freeTrialEndDate`) explicit deferral | Tracked as REPORT-V2-03 |

**v1.0 Validated requirements (closed):**

- ✓ Email/password auth with invite-only signup
- ✓ Session persistence (30-day sliding)
- ✓ Password reset via email link (infra shipped — prod deliverability gap tracked as EMAIL-V2-01 → closed by Phase 8)
- ✓ Admin user management (invite / role-change / deactivate)
- ✓ Sensitive-field redaction by role
- ✓ Full kiosk record (20+ fields, configurable lifecycle, hardware/software/CMS)
- ✓ Configurable lifecycle stages (FLOAT8 ordering)
- ✓ Temporal kiosk-to-venue assignment history
- ✓ Location with S3 contracts + banking details
- ✓ Kiosk + Location joined via `kiosk_assignments` (not a `venue_id` FK)
- ✓ Filterable / sortable / groupable Table view + show/hide columns
- ✓ Saved views per viewType
- ✓ Kanban with drag-to-update + alternative grouping
- ✓ Gantt with milestones + resource lanes
- ✓ Calendar with installation spans + milestones + trial-expiry events
- ✓ 4-tab `?view=` URL-bookmarkable navigation
- ✓ Monday import with dry-run + 1,000+ records + pagination/rate-limit
- ✓ Subitem products/providers/commission-tiers per hotel
- ✓ Fleet-health dashboard, time-series trends, region/hotel/kiosk drill-down, filter-by-dimension
- ✓ D8 multi-POS site merge applied to prod
- ✓ /settings/geocoding admin UI
- ✓ Outlet-tier thresholds-as-settings
- ✓ KPI tooltips citing audit-fix D-decisions on 26/27 cards

---

## 5. v1.1 — Data Foundation + Email (active milestone)

**Scoped:** 2026-05-03 via `/gsd-new-milestone` · **Phase numbering:** continues from v1.0 (Phase 7+) · **Status (2026-05-10):** 3 phases complete (7, 8 code-complete, 9.1), Phase 9 complete, Phase 10 ready to plan, Phase 11 not yet planned.

**v1.1 architectural decisions (locked at scoping):**

| Area | Decision | Rationale |
|---|---|---|
| Email provider | Resend primary; Brevo fallback documented (not implemented) | Best Next.js/Vercel DX; EU region for GDPR; locked at v1.0 close 2026-04-29 |
| Async + scheduled | Inngest 4.2.6 for queue + cron triggers | Built-in retries / dedupe / idempotency keys. No bespoke `email_jobs` table; thin `email_log` audit only. |
| RBAC model | CASL (`@casl/ability` 6.8.1 + `@casl/react` 6.0.0) | Native fields (with `*` / `**`) + conditions map to "Ops sees pipelineStage but not bankingDetails". Rules JSON → DB-storable → admin-UI authorable without deploy. |
| Notifications scope | Single weekly bottom-tier POC alert email — no in-app bell, no per-user prefs | Rescoped 2026-05-09; broader notification apparatus dropped (no v2 carry) — judged as infrastructure without validated demand. |
| Data reset | Wipe-and-rebuild from Monday, not surgical merge | Codified in `.planning/notes/v2-data-reset-decision.md`. |
| Operator ops | Recurring destructive ops are admin UI features, not scripts | Locked 2026-05-03. |

### Phase 7 — Data Foundation Rebuild (6/6 plans, completed 2026-05-08, PR #36 merged)

**Goal:** Establish Monday as authoritative SoT via wipe-and-rebuild. Operator-driven multi-POS merge UI replacing legacy `scripts/multi-pos-merge.ts`. DB-level same-name prevention. Sales ETL fallback to `LOCATION_NEEDED` sentinel.
**Requirements:** DATA-01..05.

| Plan | Scope |
|---|---|
| 07-01 | Schema additions (sentinel, normalised_name) + Drizzle push |
| 07-02 | `runHotelLocationImport` from 4 Monday hotel boards + wipe-and-reseed runbook with advisory lock |
| 07-03 | Location-merge admin UI — multi-select, preview, atomic apply, audit |
| 07-04 | Same-name prevention guardrails + import dry-run warnings |
| 07-05 | `LOCATION_NEEDED` sentinel pattern in sales ETL fallback |
| 07-06 | Two-pass `assigned_at` backfill integration (`live_date` primary, `MIN(sales)` fallback) |

### Phase 8 — Email Infrastructure (3/3 plans, code-complete; operator UAT pending)

**Goal:** Replace nodemailer SMTP (silent-fail in prod) with Resend. Self-serve change-password from `/account/security`. Lay down Inngest-backed transactional alerts substrate for downstream consumers.
**Requirements:** EMAIL-01..04.

| Plan | Scope | State |
|---|---|---|
| 08-01 | Resend integration + Inngest send/retry substrate + `email_log` schema + branded templates | ✓ |
| 08-02 | Self-serve change-password (`/account/security`) + password-changed confirmation email (first EMAIL-04 consumer) | ✓ |
| 08-03 | Forgot-password deliverability UAT runbook + `08-HUMAN-UAT.md` operator items | code-ready; awaiting DNS records on `command.weknowgroup.com` |

**Pending close-out:** DEFERRED-08.02-01 (`src/lib/rbac.test.ts` fails when `RESEND_API_KEY` unset; fix is lazy `Resend(...)` construction inside each send helper); DNS-cutover items 1, 4, 8 in `08-HUMAN-UAT.md`.

### Phase 9 — POC Underperformance Alerts (7/7 plans, completed 2026-05-09, PR #38 merged)

**Goal:** Weekly Inngest cron (Mondays 09:00 Europe/London) classifies `Live` kiosks against existing percentile cutoffs over an admin-tunable trailing window. Per-POC batched emails for kiosks that flipped INTO bottom tier (or remained bottom and last alerted ≥30 days ago). Admin per-kiosk silencing. Read-only `/admin/performance-alerts` dashboard.
**Requirements:** POC-ALERT-01.

| Plan | Scope |
|---|---|
| 09-01 | `kiosk_performance_alert_state` table + `kiosks.alert_silenced_*` columns + migrations 0043/0044/0045 |
| 09-02 | `decideAlert` decision function, `iso-week`, `hash`, `poc-batching` modules + unit tests |
| 09-03 | `classifyEligibleLocations` + Inngest weekly cron + step-level idempotency + cold-start detection |
| 09-04 | Branded `PocUnderperformanceEmail` React component + plain-text variant |
| 09-05 | `/admin/performance-alerts` read-only dashboard + "Run now" with 5-minute rate-limit |
| 09-06 | Per-location silencing UI on `/locations/[id]` + audit trail |
| 09-07 | STATE.md / REQUIREMENTS.md / phase-summary close-out |

### Phase 9.1 — Multi-currency Analytics Forex Normalisation (INSERTED, 11 plans, completed 2026-05-09)

**Goal:** Cross-currency portfolios rank correctly. Adds `exchange_rates` populated daily from Bank of England (no triangulation through EUR; ~25 majors). Stamps `sales_records.net_amount_gbp` at ingest with carry-forward + 7-day staleness ceiling. Swaps every analytics SUM site to dual-emit `(net_amount, net_amount_gbp, currency_key)` for renderer auto-pick. Phase 9 classifier + commission processor switch to GBP-normalised. `/admin/performance-alerts` always-GBP with stale-rate banner. POC email continues native via existing `format-currency.ts`.
**Tracks:** GitHub issue #39 (surfaced from PR #38 review). **Requirements:** FX-01..04.

| Plan | Scope |
|---|---|
| 09.1-01 | Wave 0 — test fixtures + RED scaffolds (FX-01..04) |
| 09.1-02 | Wave 1 — schema + EmailKind + drizzle push |
| 09.1-03 | Wave 1 — FX library: boe-fetch + rate-lookup + currencies |
| 09.1-04 | Wave 2 — Inngest cron `fx-rates-fetch-daily` + serve registration |
| 09.1-05 | Wave 3 — ETL stamping + backfill script + 0048 NOT-NULL flip operator-gated |
| 09.1-06 | Wave 3 — Analytics SQL audit dual-emit (41 sites / 13 files) |
| 09.1-07 | Wave 4 — Renderer dispatch + tooltips + classifier/commission swaps + admin stale banner |
| 09.1-08 | Wave 5 — Doc edits + `09.1-HUMAN-UAT.md` operator runbook |
| 09.1-09 | Gap closure 1 — plain-text dispatch + UUID-shape validator + inArray IN-list + FX_ALERT_TO env-required + hotel-groups buildActiveLocationCondition migration |
| 09.1-10 | Gap closure 1 — `daysBetweenIso` shared helper (DST-safe) + backfill cursor uuid-typed + commission processor uuid[] bind (no 65k ceiling) + pivot-engine WR-09 currency_key symmetry |
| 09.1-11 | Gap closure 2 — recipient lifted to run-start in fx cron + azure-etl + EmailTemplate union extended with "plain-text" sentinel + num-rooms-subquery regex post-CR-01 + FX cron integration tests |

**Pending:** DEFERRED-09.1-01 (`analytics-currency-render` Test 1 deferred until preview/staging has non-GBP sales data — renderer dispatch is unit-tested; only live visual confirmation missing); DEFERRED-09.1-02 (`exchange_rates` table on prod is empty until BoE Inngest cron fires at 06:00 Europe/London — default path is wait).

### Phase 10 — Access Control Extended (0/8 plans, ready to plan 2026-05-10)

**Goal:** Migrate RBAC onto CASL. Tier rules stored as JSON in DB, editable from admin UI without deploy. `redactSensitiveFields` becomes `permittedFieldsOf(ability, 'read', subject)` drop-in. Admin can author / edit / clone custom granular roles (subjects × actions × fields × conditions) and assign per-user.
**Requirements:** AUTH-06, AUTH-07.

**Locked design decisions (from 10-CONTEXT.md):**

1. **Rules persistence schema** — Hybrid `roles` (id, name, kind: `system` | `tier` | `custom`) + `role_permissions` (role_id, subject, action, fields jsonb, conditions jsonb, inverted, ordinal). Replace-all edit semantics. Scope rules layered at builder time (Option B).
2. **Default tier mapping** — Admin is immutable `kind='system'` and bypasses CASL. Ops-IT and Read-only are editable `kind='tier'` seed rows. `user.role` text replaced by `role_id` FK in one migration. External-user invariant kept as code-level guard.
3. **Custom-role assignment model** — IAM-style multi-role per user via `user_roles (user_id, role_id, assigned_at, assigned_by)`. Effective Ability = union/precedence of all assigned roles. Scope attaches at assignment time, not on the role definition: `userScopes` evolves to per-(user, role, dimension). Conflict resolution: explicit-deny-wins (AWS IAM semantics).
4. **Admin-UI authoring shape** — Form-driven GUI at new `/settings/roles`. Add-rule wizard: subject multi-select → action chips → field picker (auto-populated from Drizzle column list with `*` / `**` wildcard chips) → condition builder. No raw JSON editor in v1.1. Save safety: rule-level diff preview + impacted-users count + confirmation modal. User-to-role assignment stays on `/settings/users/[id]`.

| Plan | Scope |
|---|---|
| 10-01 | Wave 1 RED test scaffolds (16 files) |
| 10-02 | Wave 1 schema (3 tables) + 3 migrations + audit union widen + CASL deps |
| 10-03 | Wave 2 `buildAbility` (react.cache) + types/subjects/fields/external-invariant/seed/role-mirror/lockout-guard/ability-context |
| 10-04 | Wave 3 `rbac.ts` shim + 3 `redactSensitiveFields` call sites (location-products-client owned by 10-07) |
| 10-05 | Wave 3 `/settings/roles` list + drill-in + diff-preview + impacted-users count |
| 10-06 | Wave 4 `/settings/users/[id]/page.tsx` + role-actions + `deleteUser` lockout wrap |
| 10-07 | Wave 5 layout `AbilityProvider` + 3 `<Can>` client gates |
| 10-08 | Wave 6 preview Playwright UAT + ops runbook + ROADMAP/REQUIREMENTS/STATE close-out |

**Out of scope for Phase 10 (deferred):** raw JSON rule editor; impersonation simulator; UI-layer protected-tier guards beyond `kind='system'` data-layer enforcement; group / role-inheritance; multi-tenant role isolation; Better Auth plugin authoring; SSO / external IdP; time-bound role grants.

### Phase 11 — Tooling, Polish & Tech-Debt Close-out (not yet planned)

**Goal:** Close every outstanding non-trivial item batched at v1.1 close so v1.1 reaches a clean operational baseline before v1.2 / v2.0 scope.
**Requirements:** TEST-01, MONDAY-01, REF-01, INFRA-01, POLISH-01..02, DEBT-01..02.
**Depends on:** Phases 7–10 (touches code shipped in each).

**Success criteria:**
1. Staging orphan-rate baseline measurement + CI invariant assertion when threshold exceeded.
2. Scheduled Monday-drift detection job surfacing diffs in admin UI.
3. Analytics dashboards migrated to shared `loadData()` pattern; `react-hooks/set-state-in-effect` suppressions removed.
4. GitHub auto-delete-merged-branches enabled; tab hover/loading polish + calendar empty-state overlay.
5. Zod-validated patch schemas in kiosk + location `bulk-actions.ts`; `as any` casts removed.
6. Drizzle 0.45.2 patch audit complete (upgraded to 0.46+ or documented why stuck).

---

## 6. Final-State Requirements Register

### Validated (closed in v1.0)

**Auth:** AUTH-01..05.
**Kiosk:** KIOSK-01..06. **Location:** LOC-01..05.
**Views:** VIEW-01..05, KANBAN-01..03, GANTT-01..04, CAL-01..02.
**Bulk + audit:** BULK-01..02, AUDIT-01..03.
**Migration:** MIGR-01..15 (MIGR-04 superseded; MIGR-07/08/09 partial — MIGR-09 fully closed by Phase 7 location-merge UI).
**Reporting:** REPORT-01..04 (off-GSD via PRs #23–#29).

### Active (v1.1)

**Data:** DATA-01..05 (Phase 7 — closed).
**Email:** EMAIL-01..04 (Phase 8 — code-complete; EMAIL-03 awaiting DNS for prod UAT).
**POC alerts:** POC-ALERT-01 (Phase 9 — closed).
**Forex:** FX-01..04 (Phase 9.1 — closed; live visual + non-GBP UAT pending preview/staging data).
**Access control:** AUTH-06, AUTH-07 (Phase 10 — planning).
**Polish + debt:** TEST-01, MONDAY-01, REF-01, INFRA-01, POLISH-01..02, DEBT-01..02 (Phase 11 — unplanned).

### Out of Scope (explicit non-goals)

| Feature | Reason |
|---|---|
| SSO / OAuth login | Email/password sufficient for v1; user count doesn't justify SSO complexity. Revisit if user base broadens beyond ~50. |
| Mobile native app | Web-first; tested on mobile browsers. |
| Real-time collaboration | Not relevant to asset-management workflows. |
| External / customer-facing portal | Internal tool only. Locked behind `archive/portal-lockdown-2026-04-25`. |
| IoT / telemetry monitoring | Separate system. |
| Billing / invoicing | Separate financial systems. |
| Real-time chat | Not relevant. |
| Map view / geographic visualisation | Server-side `/settings/geocoding` is sufficient for ops. |
| Multi-tenant role isolation | Roles are global; no per-`hotel_group` authoring scope. |
| Time-bound role grants | Assignments are permanent until revoked in v1.1. |

---

## 7. v2 Carryover (deferred backlog)

Tracked in `tasks/v2-carryover-from-v1-phase-6.md`. Will be incorporated into v2 PROJECT.md when `/gsd:complete-milestone` runs.

| Class | Items | Effort |
|---|---|---|
| Data quality | V2-DQ-01 (61 NULL lat/lng), V2-DQ-02 (Cluster 10 wrong sibling-copied address), V2-DQ-03 (60 NO_MONDAY locations triage) | 4-6 hrs operator + ~$1 API |
| Data model | V2-DM-01 (audit + collapse 19+ same-name active location pairs — policy decision: collapse-all vs keep-as-multi-kiosk) | 1-2 days if collapse-all |
| Test coverage | V2-TEST-01 (multi-pos-merge single-pair fixture), V2-TEST-02 (staging orphan-rate baseline) | 1-2 hrs |
| Refactoring | V2-REF-01 (analytics dashboards `useEffect → loadData()` migration) | bundle with broader RSC refactor |
| Integration | V2-MONDAY-01 (bidirectional Monday sync / drift detection) | 1-3 days |
| Email infra | V2-EMAIL-01 (Resend wire-up — closed by Phase 8), V2-EMAIL-02 (self-serve change-pw — closed by Phase 8 plan 02), V2-EMAIL-03 (forgot-pw reliability sweep — closed by Phase 8), V2-EMAIL-04 (transactional alerts substrate — closed by Phase 8) | resolved |
| Infra | V2-INFRA-01 (GitHub auto-delete-after-merge for branches) | 5 mins (now in Phase 11 INFRA-01) |
| Reporting | REPORT-V2-03 (Phase 7.11 `freeTrialEndDate` analytics — blocked on maintenance-fee design) | open |

---

## 8. Architectural Decision Register

| Decision | Made in | Outcome |
|---|---|---|
| Better Auth 1.5.x for auth/RBAC | pre-Phase-1 | ✓ Good — invite-only + 30-day sliding sessions shipped clean |
| `kiosk_assignments` temporal join (not `venue_id` FK) | pre-Phase-1 | ✓ Good — drove Phase 5.2 prod backfill (362 → `live_date`); the differentiator vs Monday |
| FLOAT8 for pipeline-stage ordering | Phase 1 | ✓ Good — no race conditions in v1.0 |
| Application-layer audit log with denormalised actor/entity names | Phase 2 | ✓ Good — DB triggers couldn't have produced human-readable per-record `AuditTimeline` |
| Phase 4 depends on Phase 2, not Phase 3 | scoping | ✓ Good — no schema churn during Monday import |
| Phase 5 delivered off-GSD | Phase 5 | ⚠ Revisit — worked but lost the GSD audit trail |
| ClickUp-style configurable pipeline | Phase 1 | ✓ Good — admin UI shipped, used for stage additions |
| Asset ID as `kiosks.kioskId` (MIGR-04 superseded) | Phase 4.1 | ✓ Good — Region+outlet was a misread of the Monday data model |
| `@svar-ui/react-gantt` over custom Gantt | Phase 3 | ✓ Good — Azure/Graphite token overrides worked cleanly; saved 1-2 weeks |
| In-memory geocoding staging (no `geocoding_stagings` table) | Phase 6.6 | ✓ Good — ~80KB fits client React state; symmetric stage/commit/cancel; persistence is a future swap |
| ALL-OR-NOTHING single-transaction multi-POS merge | Phase 6.1 D-03 | ✓ Good — 4,171-row prod merge applied atomically |
| Tooltip-as-audit-trace pattern | Phase 6.3 | ✓ Good — closes SC5; reusable substrate for v2 |
| Multi-kiosk-per-site over same-name collapse for v1.0 | Phase 6 (late session) | — Pending — DM-V2-01 in v2 |
| Wipe-and-rebuild from Monday (not surgical merge) | v1.1 scoping | ✓ Good — Phase 7 shipped clean |
| No manual SQL for ops cleanup | v1.1 scoping | ✓ Good — `multi-pos-merge.ts` retired in favour of admin UI |
| Resend primary + Brevo fallback documented | v1.0 close 2026-04-29 | ✓ Phase 8 code-complete; awaiting DNS for full prod UAT |
| Inngest for queue + cron triggers | v1.1 scoping | ✓ Good — replaces "queue + cron worker" wholesale; consumed by Phases 8/9/9.1 |
| CASL for RBAC | v1.1 scoping | — In flight — Phase 10 planning |
| Single weekly bottom-tier POC alert (rescoped from broader notifications) | 2026-05-09 | ✓ Good — Phase 9 shipped; rescoping was load-bearing |
| BoE daily spot rate, no triangulation through EUR | Phase 9.1 D-01 | ✓ Good — free, zero-auth, native GBP base |
| 7-day FX staleness ceiling with hard-fail at sales ETL | Phase 9.1 D-07 | ✓ Good — loud signal that pipeline is broken vs a long weekend |
| Hybrid `roles` + `role_permissions` schema (Phase 10) | 2026-05-10 | — Locked at scoping; ready for plan |
| IAM-style multi-role per user with explicit-deny-wins | Phase 10 D-3 | — Locked at scoping |
| Form-driven GUI rule editor (no raw JSON) | Phase 10 D-4 | — Locked at scoping |
| Phase 7.11 (`freeTrialEndDate`) explicit deferral | Phase 6 | — Pending — REPORT-V2-03; blocked on maintenance-fee design |

---

## 9. Cross-cutting Operational Notes

- **CI / lockfile:** Always regenerate `package-lock.json` inside `--platform linux/amd64` Docker with an isolated build dir; never run `npm install` on macOS between Docker regen and commit.
- **Vercel previews:** Pin `BETTER_AUTH_URL` to the git-branch alias, never to a per-deploy URL.
- **Playwright UAT:** `npx playwright test` against `PLAYWRIGHT_BASE_URL=<git-branch alias>`; `--list` is not sufficient evidence.
- **Destructive flows:** 06-01 multi-POS merge `--apply` and 06-06 geocoding `Apply` against real Google Maps remain operator-driven manual checklists, not Playwright-automated.
- **Prod admin rotation:** `scripts/reset-admin-password.ts` only — bypasses the normal sign-up flow by writing directly into `account` for the existing user. Hand off via secure channel, never commit.

---

## 10. Code Map — Where Each Capability Lives

This is the file-level orientation a new engineer needs to fix any issue or extend any subsystem. Pair with [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for runtime model and [`docs/DATABASE.md`](./DATABASE.md) for the schema.

### Auth & RBAC

| Capability | Location |
|---|---|
| Better Auth server config | `src/lib/auth.ts` |
| Better Auth client | `src/lib/auth-client.ts` |
| Role gates (`requireRole`, `getSessionOrThrow`) | `src/lib/rbac.ts` |
| User context derivation (incl. scopes) | `src/lib/auth/get-user-ctx.ts` |
| Role-gating helpers (server-side) | `src/lib/auth/gating.ts` (+ `gating.test.ts`) |
| Sensitive-field redaction (today) | `redactSensitiveFields` in `src/lib/rbac.ts` |
| Row-level scoping (regions / hotelGroups / locationGroups) | `src/lib/scoping/` |
| External-user invariant | `src/app/portal/layout.tsx` + `userType='external'` filter logic |
| Audit writer | `src/lib/audit.ts` |
| Reset admin password CLI | `scripts/reset-admin-password.ts` (see CLAUDE.md) |
| **Phase 10 target** — CASL ability builder, subjects/fields registry, Can gates | `src/lib/casl/` (to be created), `src/inngest/` not affected |

### Data layer

| Capability | Location |
|---|---|
| Schema (single source of truth) | `src/db/schema.ts` (~50 `pgTable`s) |
| Driver auto-detect (Neon vs postgres-js) | `src/db/index.ts` + `src/db/is-neon-url.ts` |
| `.execute()` row-shape normaliser | `src/db/execute-rows.ts` |
| Migrations | `migrations/0000_..` → `migrations/0049_phase_09_1_commission_ledger_gross_amount_gbp.sql` |
| Seeds | `src/db/seed*.ts` (admin user, pipeline stages, kiosks, markets, sales-demo) |
| Drizzle config (forces `sslmode=verify-full` for migrations) | `drizzle.config.ts` |

### Domain modules

| Capability | Location |
|---|---|
| Monday.com importer (GraphQL client + field mapper + subitem parser) | `src/lib/monday/` + `scripts/import-from-monday.ts` |
| Hotel-board enrichment (one-way, NULL-fields-only) | `scripts/enrich-locations-from-monday.ts` |
| Multi-POS site merge (server logic) | `src/lib/multi-pos-merge.ts` (legacy script — replaced by location-merge UI in Phase 7) |
| Location-merge admin UI + server actions | `src/app/(app)/locations/merge-proposals/` + `src/app/(app)/settings/data-quality/` |
| Same-name guardrails (DB partial unique idx + dry-run warning) | `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql` + `src/lib/duplicates/` |
| Sales ETL orchestrator | `src/lib/sales/etl/azure-etl.ts` |
| Advisory-lock wrapper | `src/lib/sales/etl/advisory-lock.ts` (`withAdvisoryLock(db, key, fn)`) |
| Azure Blob source | `src/lib/sales/azure-blob-source.ts` + `src/lib/sales/azure-client.ts` |
| `LOCATION_NEEDED` sentinel handling in ETL | `src/lib/sales/etl/azure-etl.ts` (Phase 7 plan 05) |
| Two-pass `assigned_at` backfill | `scripts/backfill-kiosk-install-dates.ts` |
| Geocoding (Google Maps + in-memory staging) | `src/lib/geocoding/` + `src/app/(app)/settings/geocoding/` |
| Outlet exclusions (per-region overrides) | `outletExclusions` table + `src/app/(app)/settings/outlet-exclusions/` |
| Commission ledger (GBP-normalised post-9.1) | `src/lib/commission/processor.ts` + `commission_ledger` table (col `gross_amount_gbp` added in `0049`) |

### Email + scheduled work (Phase 8/9/9.1)

| Capability | Location |
|---|---|
| Resend client + send helpers | `src/lib/email.ts` |
| Branded react-email templates | `src/emails/` (incl. `PocUnderperformanceEmail`, `PasswordChangedEmail`, FX alerts) |
| Inngest client + event types | `src/inngest/client.ts` |
| Inngest functions | `src/inngest/functions/` — `send-email.ts` (id `send-email`, retry logic inline), `fx-rates-fetch-daily.ts` (id `fx-rates-fetch-daily`), `weekly-poc-alerts.ts` (id `weekly-poc-alerts`) |
| Inngest webhook | `src/app/api/inngest/route.ts` |
| `email_log` audit + `payloadHash` idempotency | `email_log` table + `migrations/0041..0044` |
| Self-serve change-password | `src/app/(app)/account/security/` + `src/app/api/account/password-changed/route.ts` |
| Forgot-password flow | Better Auth `/api/auth/[...all]` + `src/app/(auth)/reset-password/` |

### POC underperformance (Phase 9)

| Capability | Location |
|---|---|
| Decision function | `src/lib/poc-alerts/decideAlert.ts` |
| Helpers (`iso-week`, `hash`, `poc-batching`) | `src/lib/poc-alerts/` |
| Classifier | `src/lib/poc-alerts/classifyEligibleLocations.ts` |
| Cron + step-level idempotency | `src/inngest/functions/weekly-poc-alerts.ts` (function id `weekly-poc-alerts`; event `performance-alerts/run.requested`) |
| State table | `kiosk_performance_alert_state` (`migrations/0043`) |
| Silencing fields on kiosks | `kiosks.alert_silenced_at` + `alert_silenced_reason` (`migrations/0044`+`0045`) |
| Admin dashboard | `src/app/(app)/admin/performance-alerts/` |
| Per-location silencing UI | `src/app/(app)/locations/[id]/` |

### Forex normalisation (Phase 9.1)

| Capability | Location |
|---|---|
| BoE fetcher | `src/lib/fx/boe-fetch.ts` |
| Carry-forward rate lookup | `src/lib/fx/rate-lookup.ts` |
| Currencies registry | `src/lib/fx/currencies.ts` |
| Daily Inngest cron | `src/inngest/functions/fx-rates-fetch-daily.ts` (function id `fx-rates-fetch-daily`; ~06:00 UTC, before Azure ETL) |
| ETL stamping (`net_amount_gbp` at ingest) | `src/lib/sales/etl/azure-etl.ts` (carry-forward + 7-day staleness ceiling) |
| Backfill | `scripts/backfill-net-amount-gbp.ts` |
| `exchange_rates` schema | `migrations/0046_phase_09_1_exchange_rates.sql` |
| `sales_records.net_amount_gbp` (NOT NULL post-`0048`) | `migrations/0047`+`0048` |
| Analytics dual-emit (`SUM(net_amount), SUM(net_amount_gbp), currency_key`) | 41 sites across 13 files in `src/lib/analytics/` (Phase 9.1 plan 06) |
| Renderer dispatch (native vs GBP per cohort) | `src/components/analytics/` (currency-render dispatch) |
| Stale-rate banner | `/admin/performance-alerts` page (always-GBP) |
| Admin UAT helpers | `scripts/uat-probe-fxstale.ts`, `scripts/uat-trigger-fx-fetch.ts` |

### Frontend views

| Capability | Location |
|---|---|
| Table view (TanStack Table v8 + Zustand View Engine) | `src/components/table/` |
| Kanban (dnd-kit) | `src/components/pipeline/` + `src/app/(app)/kiosks/` |
| Gantt (`@svar-ui/react-gantt`) | `src/components/gantt/` |
| Calendar (react-big-calendar) | `src/components/calendar/` |
| Saved views (filters/group/columns/sort) | `src/components/table/` + `user_views` table |
| Audit timeline (per-record + global) | `src/components/audit/` |
| Brand tokens (Azure / Graphite / Circular Pro) | Tailwind v4 config; `~/.claude/weknow-brand-guidelines.md` |

### Operator scripts (most-used)

| Script | Purpose |
|---|---|
| `scripts/run-azure-etl.ts` | CLI ETL runner (uses `pg.Pool` directly) |
| `scripts/v2-wipe-and-reseed.ts` | Phase 7 wipe-and-rebuild runbook |
| `scripts/v2-preflight.ts` | Pre-wipe baseline / golden-snapshot diff |
| `scripts/import-from-monday.ts` | Bulk Monday import |
| `scripts/multi-pos-merge.ts` | Legacy — superseded by location-merge UI |
| `scripts/probe-monday-vs-db-addresses.ts` | Address-quality CSV producer (`/tmp/monday-vs-db-addresses.csv`) |
| `scripts/backfill-kiosk-install-dates.ts` | Two-pass `assigned_at` seed |
| `scripts/backfill-net-amount-gbp.ts` | One-shot historical FX backfill |
| `scripts/reset-admin-password.ts` | Prod credential rotation |
| `scripts/render-email-check.ts` | Live Resend round-trip during email-template QA |
| `scripts/snapshot-db-state.ts` | Determinism check post-wipe-and-reseed |

---

## 11. Environment Variables — Required vs Optional per Deploy Target

| Variable | Local | Preview / Prod | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Required | Required | Postgres connection (Neon-pooled in deployed envs) |
| `BETTER_AUTH_SECRET` | Required | Required | Better Auth signing |
| `BETTER_AUTH_URL` | Required (`http://localhost:3003`) | Required (**git-branch alias**, NOT per-deploy URL) | Origin Better Auth signs against |
| `RESEND_API_KEY` | Optional (`re_test_key` to satisfy rbac.test.ts — DEFERRED-08.02-01) | Required | Email send |
| `EMAIL_FROM` | Optional | Required | `from:` address |
| `ADMIN_SUPPORT_EMAIL` | Optional | Required | Contact for password-changed alerts |
| `FX_ALERT_TO` | Optional | **Required** | `fx_rate_fetch_failed` + `fx_rate_stale` recipient. Phase 9.1 throws at call site if unset. |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Optional (use Inngest dev server) | Required | Inngest webhook auth |
| `MONDAY_API_TOKEN` | Optional | Required for Monday import | Monday GraphQL |
| `BOARD_ID` | Optional | Optional | Override consumed only by `scripts/diagnose-new-board.ts`; main `import-from-monday.ts` has board IDs hardcoded |
| `GOOGLE_MAPS_API_KEY` | Optional | Required for `/settings/geocoding` | Geocoding |
| `AWS_S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `NEXT_PUBLIC_AWS_S3_BUCKET` | Optional | Required for contract uploads | S3 |
| `AZURE_STORAGE_CONNECTION_STRING` *or* `AZURE_STORAGE_ACCOUNT_URL` | Optional | Required for sales ETL | Azure Blob |
| `AZURE_BLOB_CONTAINER` | Optional | Required for sales ETL | `clientdata` (prod) / `testdata` (smoke) |
| `ETL_AZURE_ENABLED` + `ETL_SHARED_SECRET` | Optional | Both required for ETL endpoint | Sales ETL gate |
| `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` | Optional | N/A | Auth-flow E2E specs |
| `PLAYWRIGHT_BASE_URL` | Optional | N/A | Run Playwright against preview |
| `BREVO_API_KEY` (fallback) | — | — | Documented but not implemented |

Full annotated reference: [`.env.example`](../.env.example).

---

## 12. Known Issues / Pending Close-out — Things a Dev Team Should Resolve

These are the exact items that block "fully shipped" status across v1.0 + v1.1. Each names a discovering plan, a remediation path, and the canonical tracking entry in `.planning/`.

### v1.1 Phase 8 (Email)

- **DEFERRED-08.02-01** — `src/lib/rbac.test.ts` fails when `RESEND_API_KEY` is unset because `new Resend(...)` runs at module scope in `src/lib/email.ts`.
  - **Fix:** Move `Resend` instantiation into a lazy factory inside each send helper.
  - **Workaround:** `RESEND_API_KEY=re_test_key npx vitest run`.
  - **Tracking:** `.planning/phases/08-email-infrastructure/deferred-items.md`.
- **08-HUMAN-UAT items 1, 4, 8** — Phase 8 sandbox UAT used Resend's shared sender (`onboarding@resend.dev`). The throwaway-user invite + arbitrary-recipient EMAIL-03 path needs DNS records on `command.weknowgroup.com` before it can be re-tested.
  - **Fix:** Add DKIM, SPF, return-path, MX records per Resend dashboard guidance for `command.weknowgroup.com`. Re-run the UAT runbook in `08-HUMAN-UAT.md` against the preview alias with `BETTER_AUTH_URL` pinned correctly.
  - **Tracking:** `.planning/phases/08-email-infrastructure/08-HUMAN-UAT.md`.

### v1.1 Phase 9.1 (Forex)

- **DEFERRED-09.1-01** — `analytics-currency-render` Test 1 (single-currency native render) deferred until a preview/staging env has non-GBP sales data.
  - **Fix:** When non-GBP cohort exists in any preview env, re-run the spec; flip from RED to green; update deferred-items.md to closed.
  - **State:** Renderer dispatch is unit-tested; only the live visual confirmation is missing.
  - **Tracking:** `.planning/phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/deferred-items.md`.
- **DEFERRED-09.1-02** — `exchange_rates` table on prod is empty until the BoE Inngest cron fires at 06:00 Europe/London.
  - **Fix path:** Default is wait. Manual seed only if a non-GBP import lands first; canonical command in `deferred-items.md`.
  - **Tracking:** Same `deferred-items.md`.

### v1.1 Phase 10 (Access Control) — open research questions for the planner

The locked decisions are in §5 of this doc; the planner must still resolve these before tasks ship. Each is captured at `.planning/phases/10-access-control-extended/10-CONTEXT.md` § "Open research questions":

1. **Better Auth role-plugin compatibility** — Better Auth's session middleware reads `session.user.role` as text. Either (a) replace with custom session augmenter that derives role names from `user_roles → roles.name`, or (b) keep `user.role` text as denormalised mirror. Pick one in PLAN.
2. **Field-list registry derivation** — Auto-derived at build time from Drizzle introspection (no drift) vs hand-maintained `subject → string[]` map in `src/lib/casl/subjects.ts`. Decide.
3. **Atomicity of the migration PR** — Schema + seed + call-site rewrites + Better Auth session adjustment + `user.role` text drop in one PR vs split.
4. **CASL on the client** — Which existing client-rendered UI gates migrate to `<Can>`; the rest stay server-only.
5. **Audit-log shape for role edits** — Reuse `auditLogs` writer; design `details` jsonb shape (`role.permissions.replace`, `user.roles.assign`).
6. **Lock-out prevention at write-time** — Server action must refuse to save a state where zero users have effective `manage all` permission. Cheap server check; no UI surface beyond an error toast.

### v2 carryover (not blocking v1.1 ship, but tracked)

- **V2-DQ-01** — 61 active locations have NULL latitude/longitude. Operator hand-research per Monday board, then re-run `scripts/enrich-locations-from-monday.ts` + `/settings/geocoding` Apply with "Re-geocode all UNCHECKED".
- **V2-DQ-02** — Cluster 10 (`0Y` Clayton London Wall) has a wrong sibling-copied address. Hand fix.
- **V2-DQ-03** — 60 NO_MONDAY outlets need triage (link to Monday / archive / accept).
- **V2-DM-01** — 19+ same-name active location pairs. Policy decision: collapse-all vs keep-as-multi-kiosk. Two new same-name pairs (Sheraton Heathrow SSM, Radisson Blu Edwardian SSM) are direct consequences of Wave 1 renames and should be collapsed early in v2.
- **V2-TEST-01** — Add a fixture-driven integration test that seeds exactly 1 pending merge_proposal pair (regression against the `ANY(${ids}::uuid[])` Drizzle bug fixed in `b58a70b` via `inArray()`).
- **V2-TEST-02** — Staging orphan-rate baseline measurement + CI invariant (becomes Phase 11 TEST-01).
- **V2-REF-01** — Migrate analytics dashboards from `useEffect` to shared `loadData()` pattern; remove `react-hooks/set-state-in-effect` suppressions (becomes Phase 11 REF-01).
- **V2-MONDAY-01** — Bidirectional Monday sync with drift detection (becomes Phase 11 MONDAY-01).
- **V2-INFRA-01** — GitHub auto-delete-after-merge for branches (becomes Phase 11 INFRA-01).
- **REPORT-V2-03** — Phase 7.11 `freeTrialEndDate` analytics treatment, blocked on a maintenance-fee design decision.

### Phase 11 (Tooling, Polish, Tech-Debt) — not yet planned

The full close-out backlog. Each is independent and can be picked up in any order. Detailed scope in §5 — Phase 11 success criteria.

| ID | Where it lives |
|---|---|
| TEST-01 | New CI assertion + `tests/etl/` orphan-rate fixture |
| MONDAY-01 | New Inngest function `monday.drift-detect` + admin diff surface |
| REF-01 | `src/components/analytics/**` `useEffect → loadData()` |
| INFRA-01 | GitHub repo settings (web UI) |
| POLISH-01 | `.planning/debug/tab-hover-loading-state.md` — fix specified, awaiting verify |
| POLISH-02 | `.planning/debug/calendar-empty-state-overlay.md` — fix specified, awaiting verify |
| DEBT-01 | `src/app/(app)/kiosks/bulk-actions.ts` + `src/app/(app)/locations/bulk-actions.ts` (Zod patch schemas, drop `as any`) |
| DEBT-02 | `patches/drizzle-orm+0.45.2.patch` audit — upgrade to 0.46+ if it supersedes the hash-based migration detection patch, or document why we're stuck |

---

## 13. Ship-Readiness Checklist

A development team picking up this codebase to take v1.1 over the line should walk this list top-to-bottom. Items already done are checked.

### Local environment

- [ ] `npm install` clean on macOS-arm64 (lockfile shape verified — see CLAUDE.md if it fights you).
- [ ] `npx drizzle-kit push` against fresh `wkg_kiosk_dev` succeeds with only `CREATE` statements.
- [ ] `npm run db:seed` + `seed-pipeline-stages.ts` create the admin user + 9 stages.
- [ ] `npm run dev` boots on `:3003`; sign in as `admin@weknow.co` / `Admin123!` works.
- [ ] `npx inngest-cli dev -u http://localhost:3003/api/inngest` registers all functions in the dashboard at `:8288`.
- [ ] `RESEND_API_KEY=re_test_key npx vitest run` is green (workaround for DEFERRED-08.02-01 until lazy-init lands).
- [ ] `npx playwright test` against the local dev server is green.

### CI

- [ ] `npm ci` is green on Linux x64 — confirms lockfile drift not present.
- [ ] Lint, type-check, vitest, Playwright list green on PR.
- [ ] Migration `_journal.json` consistent with files under `migrations/`.

### Per-environment env vars (preview + prod)

- [x] `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (git-branch alias).
- [x] `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_SUPPORT_EMAIL`, `FX_ALERT_TO`.
- [x] `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- [x] `MONDAY_API_TOKEN`, `GOOGLE_MAPS_API_KEY` (and `BOARD_ID` only if running the `diagnose-new-board.ts` diagnostic).
- [x] AWS S3 vars + Azure Blob vars + `ETL_AZURE_ENABLED` + `ETL_SHARED_SECRET`.

### DNS + email deliverability (closes EMAIL-03)

- [ ] DKIM/SPF/return-path/MX records on `command.weknowgroup.com` per Resend dashboard.
- [ ] Throwaway-user invite → click link → set password → sign in flow passes against preview.
- [ ] `08-HUMAN-UAT.md` items 1, 4, 8 manually re-tested.

### Database state on prod

- [ ] All migrations through `0049` applied (`DATABASE_URL='<prod>' npx drizzle-kit migrate`).
- [ ] `app_settings.underperformance_window_days` set (default 30 — confirm desired prod value).
- [ ] `app_settings.pipeline_stage_id_live` points at the canonical Live stage UUID.
- [ ] `exchange_rates` is non-empty (BoE cron has fired at least once — closes DEFERRED-09.1-02).
- [ ] `sales_records.net_amount_gbp` is fully backfilled and NOT NULL (`migrations/0048`).
- [ ] No stuck advisory locks (`SELECT * FROM pg_locks WHERE locktype='advisory' AND NOT granted`).

### Phase 9 prod cutover (POC alerts)

- [ ] Inngest cron `weekly-poc-alerts` is registered and enabled.
- [ ] First production run is observable on `/admin/performance-alerts` with classified/skipped/silenced counts.
- [ ] Manual "Run now" trigger respects the 5-minute rate limit.
- [ ] Per-kiosk silencing UI on `/locations/[id]` writes `alert_silenced_at` + audit row.

### Phase 9.1 prod cutover (FX)

- [ ] Inngest cron `fx-rates-fetch-daily` is registered, enabled, and ordered before the Azure ETL.
- [ ] `/admin/performance-alerts` is always-GBP and the stale-rate banner appears when last successful BoE fetch is >24h.
- [ ] A single non-GBP cohort exists somewhere (preview or prod) and the renderer-dispatch spec runs green — closes DEFERRED-09.1-01.

### Phase 10 (in flight) — pre-merge gates

- [ ] All 8 plans (`10-01..10-08`) executed and per-plan summaries committed.
- [ ] `redactSensitiveFields` removed from every call site; `permittedFieldsOf` covers all sensitive fields.
- [ ] Default `tier` rules for Ops-IT and Read-only seeded; `kind='system'` Admin seeded and immutable.
- [ ] `/settings/roles` admin UI: list + drill-in + diff preview + impacted-users count + confirm modal.
- [ ] `/settings/users/[id]` allows multi-role assignment; lock-out guard refuses to save a zero-`manage all` state.
- [ ] Better Auth session adjustment lands; `session.user.role` derivation continues to work end-to-end.
- [ ] Playwright UAT against preview alias passes for: admin tier edit + custom role create + role-clone + per-user assignment + sensitive-field redaction parity.

### Phase 11 (not yet planned) — fold into the next milestone or close

- [ ] Decision: ship Phase 11 inside v1.1 (preferred — it's the close-out) or roll into v1.2.
- [ ] Plan all 8 success criteria into discrete plans before execute.

### Pre-prod release dry run

- [ ] PR branch builds clean on Vercel preview.
- [ ] `BETTER_AUTH_URL` on the preview env points at the git-branch alias.
- [ ] `PLAYWRIGHT_BASE_URL=<alias> TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... npx playwright test` runs the post-Phase-10 UAT suite green.
- [ ] Operator-driven manual checklists run on preview: 06-01 multi-POS merge `--apply`, 06-06 geocoding `Apply`, Phase 8 forgot-password real-inbox UAT, Phase 9 manual "Run now", Phase 9.1 FX cron manual trigger.
- [ ] Two Dependabot moderates flagged at v1.0 close (carried in `tasks/v2-carryover-from-v1-phase-6.md`) reviewed and resolved.

### Post-merge to main

- [ ] Tag the release.
- [ ] Apply migrations to prod manually (`DATABASE_URL='<prod>' npx drizzle-kit migrate`).
- [ ] Verify Inngest crons re-register against the prod webhook.
- [ ] Smoke prod via `https://wkg-command-centre.vercel.app/`: sign in, `/admin/performance-alerts`, `/settings/data-import`, `/analytics/portfolio`.
- [ ] Update `.planning/STATE.md` with the milestone close.

---

## 14. Quick Reference

| Need | Command |
|---|---|
| Boot dev server | `npm run dev` |
| Boot Inngest dev server | `npx inngest-cli@latest dev -u http://localhost:3003/api/inngest` |
| Run unit tests | `RESEND_API_KEY=re_test_key npx vitest run` |
| Run Playwright locally | `npx playwright test` |
| Run Playwright vs preview | `PLAYWRIGHT_BASE_URL=<git-branch alias> TEST_ADMIN_EMAIL=… TEST_ADMIN_PASSWORD=… npx playwright test tests/<path>` |
| Seed admin + stages | `npm run db:seed && npx tsx --env-file=.env.local --tsconfig tsconfig.json src/db/seed-pipeline-stages.ts` |
| Generate migration | `npx drizzle-kit generate` |
| Apply migration locally | `npx drizzle-kit migrate` |
| Apply migration to prod | `DATABASE_URL='<prod-url>' npx drizzle-kit migrate` |
| Reset prod admin password | `ADMIN_EMAIL=… ADMIN_PASSWORD=… DATABASE_URL='<prod>' npx tsx scripts/reset-admin-password.ts` |
| Regenerate lockfile (Linux x64) | See repo `CLAUDE.md` § "npm lockfile must stay in sync" |
| Where is the next thing? | `.planning/STATE.md` |
| What's the v1.1 plan tree? | `.planning/ROADMAP.md` |
| What ships if everything in §13 is checked? | v1.1 — Data Foundation + Email |

---

*This document is generated from the `.planning/` corpus and is meant to be regenerated rather than hand-maintained. The canonical sources of truth remain `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, and the per-phase artifacts under `.planning/phases/` and `.planning/milestones/`.*
