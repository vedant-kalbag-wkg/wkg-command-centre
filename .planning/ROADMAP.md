# Roadmap: v1.1 — Data Foundation + Email

## Overview

v1.1 turns v1.0's MVP into the day-to-day ops platform the team operates from. Five phases, executed in dependency order: data foundation rebuild (DATA-01..05) lands first because it's the keystone — the rebuilt Monday-authoritative data feeds every downstream phase. Email infrastructure (EMAIL-01..04) ships next as the substrate for the single weekly POC underperformance alert (POC-ALERT-01), which was rescoped on 2026-05-09 from a broader notifications/reports programme. Access control extension (AUTH-06..07) modernises RBAC onto CASL and is independent of the data/email arc. Phase 11 closes outstanding tooling, polish, and tech-debt items into one consolidated batch.

Phase numbering continues from v1.0 (Phase 7+). Branching strategy is `phase` — every phase ships on its own `gsd/phase-NN-{slug}` branch and squash-merges to main once verified.

Source documents: `PROJECT.md` (current milestone section), `REQUIREMENTS.md`, `MILESTONES.md` (v1.0 close), `.planning/notes/v2-data-reset-decision.md`, `.planning/seeds/v2-{data-reset-phase,sales-corpus-backfill}.md`, `.planning/research/v1.1-{email-queue,rbac-model,notifications-model,map-library}.md`.

## Phases

**Phase Numbering:**
- Integer phases (7, 8, 9, 10, 11): Planned milestone work
- Decimal phases (e.g., 9.1): Urgent insertions discovered mid-milestone (marked INSERTED)

- [x] **Phase 7: Data Foundation Rebuild** — Wipe-and-rebuild from Monday, location-merge admin UI, same-name guardrails, `LOCATION_NEEDED` sentinel, two-pass `assigned_at` seed (merged 2026-05-08, PR #36)
- [x] **Phase 8: Email Infrastructure** — Resend transport, self-serve change-password, forgot-password deliverability UAT, transactional alerts substrate via Inngest. **MERGED 2026-05-09** (PR #37, commit `693e28d`). Sandbox UAT complete via `onboarding@resend.dev`; 3 DNS-cutover-deferred items pick up when `command.weknowgroup.com` DNS records are added (see `phases/08-email-infrastructure/deferred-items.md` + `08-HUMAN-UAT.md`).
- [x] **Phase 9: POC Underperformance Alerts** — Weekly Inngest cron emails kiosk POCs when their `Live` kiosks fall into bottom outlet-tier; admin per-kiosk silencing; `/admin/performance-alerts` dashboard with manual run trigger (merged 2026-05-09, PR #38)
- [x] **Phase 9.1: Multi-currency analytics — forex normalisation to GBP base reporting** (INSERTED) — Adds `exchange_rates` table populated daily from Bank of England spot rates via Inngest cron, denormalises `net_amount_gbp` onto `sales_records` at ingest with carry-forward + 7-day staleness ceiling, swaps every analytics aggregate to dual-emit native + GBP for auto-pick rendering, switches the Phase 9 POC classifier and commission processor to GBP-normalised revenue for cross-portfolio ranking. **MERGED 2026-05-10** (PR #40, squash `ca62db3`; 2-round Claude review loop closed 4 medium + 3 nit + 2 follow-up observations incl. migration 0049 commission_ledger column rename). Prod migrations 0046–0049 applied + 95,103-row GBP-identity backfill 2026-05-10. Tracks GitHub issue #39. Two deferred items in `phases/09.1-…/deferred-items.md`.
- [ ] **Phase 10: Access Control Extended** — CASL `Ability` migration; configurable Ops/IT/Read-only tier rules in DB JSON; admin UI for tier editing without deploy; custom granular roles authorable in admin UI
- [ ] **Phase 11: Tooling, Polish & Tech-Debt Close-out** — Staging orphan-rate baseline, Monday drift detection, analytics `useEffect → loadData()` migration, GitHub auto-delete-merged-branches, tab hover/loading polish, calendar empty-state overlay, bulk-action type-safety, Drizzle 0.45.2 patch audit

## Phase Details

### Phase 7: Data Foundation Rebuild
**Goal**: Establish Monday as the authoritative source of truth for hotel/location identity via wipe-and-rebuild. Operators can merge multi-POS sites from a first-class admin UI (replacing the legacy `scripts/multi-pos-merge.ts`); same-name location creation is blocked at the DB level; sales ETL fallback for unknown outlet codes attaches to a `LOCATION_NEEDED` sentinel for later operator merge.
**Depends on**: Nothing (first v1.1 phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. Idempotent wipe-and-rebuild runbook (Monday import + sales ETL + two-pass `assigned_at` backfill) produces deterministic golden-snapshot output
  2. Admin can merge N location IDs into one canonical via UI with preview + atomic sales/assignment rewrite + audit entry
  3. DB-level same-name prevention via partial unique index on `normalised_name WHERE archived_at IS NULL`; dry-run import warns on same-name candidates
  4. Sales ETL with unknown outlet code creates kiosk + assigns to global `LOCATION_NEEDED` sentinel; orphan kiosks merge-able via DATA-02
  5. Two-pass `assigned_at` seed rule: `live_date` primary, `MIN(salesRecords.date)` fallback via `backfill-kiosk-install-dates.ts --apply`
**Plans**: 6 plans

Plans:
- [x] 07-01-PLAN.md — Schema additions (sentinel, normalised_name) + Drizzle push to live DB
- [x] 07-02-PLAN.md — `runHotelLocationImport` from 4 Monday hotel boards + wipe-and-reseed runbook with advisory lock
- [x] 07-03-PLAN.md — Location-merge admin UI: multi-select, preview, atomic apply, audit
- [x] 07-04-PLAN.md — Same-name prevention guardrails + import dry-run warnings
- [x] 07-05-PLAN.md — `LOCATION_NEEDED` sentinel pattern in sales ETL fallback
- [x] 07-06-PLAN.md — Two-pass `assigned_at` backfill integration into runbook

### Phase 8: Email Infrastructure
**Goal**: Replace nodemailer SMTP (which silently failed in prod because `SMTP_*` env vars were never set in Vercel) with Resend. Ship self-serve change-password from `/account/security`. Lay down the Inngest-backed transactional alerts substrate (send + retry, branded WeKnow templates, `email_log` audit table with `payloadHash` unique index) that Phase 9's POC alert consumes.
**Depends on**: Phase 7 (none directly, but ships after data foundation lands)
**Requirements**: EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04
**Success Criteria** (what must be TRUE):
  1. Resend transport replaces nodemailer SMTP; forgot-password / invite emails actually deliver in prod; `email_log` records `resend_message_id`
  2. `/account/security` self-serve change-password via Better Auth `authClient.changePassword` + confirmation email
  3. End-to-end forgot-password UAT against prod passes via git-branch-aliased `BETTER_AUTH_URL`
  4. Inngest send + retry functions, branded templates, `email_log` audit table with `payloadHash` unique index for digest idempotency; no bespoke `email_jobs` queue table
**Plans**: 3 plans

Plans:
- [x] 08-01-PLAN.md — Resend integration + Inngest send/retry substrate + `email_log` schema + branded templates
- [x] 08-02-PLAN.md — Self-serve change-password (`/account/security`) + password-changed confirmation email (first EMAIL-04 consumer)
- [x] 08-03-PLAN.md — Forgot-password deliverability UAT runbook + `08-HUMAN-UAT.md` operator items

### Phase 9: POC Underperformance Alerts
**Goal**: A single weekly Inngest cron (Mondays 09:00 Europe/London) classifies `Live` kiosks against the existing percentile cutoffs over an admin-tunable trailing window, batches per-POC, and emails kiosks that flipped into the bottom outlet-tier this run (or remained bottom and were last alerted ≥30 days ago). Admin per-kiosk silencing via `kiosks.alert_silenced_at`. Read-only `/admin/performance-alerts` dashboard with manual "Run now" trigger.
**Depends on**: Phase 8 (EMAIL-04 substrate)
**Requirements**: POC-ALERT-01
**Success Criteria** (what must be TRUE):
  1. Weekly Inngest cron classifies eligible hotels (Live + mature + non-archived + non-silenced) and writes results to `kiosk_performance_alert_state`
  2. Flip-in semantics: kiosks transitioning into bottom tier alert immediately; chronic-bottom kiosks alert no more than once per 30 days; cold-start (no prior state) suppresses all alerts on first run
  3. Per-POC batched emails via the EMAIL-04 substrate; `payloadHash` keyed on `(poc_user_id, run_iso_week)` for idempotency; per-kiosk currency rendered natively in the email
  4. Admin `/admin/performance-alerts` shows last-run metadata, recent runs, classified/skipped/silenced counts; manual "Run now" trigger with 5-minute rate limit
  5. Admin per-kiosk silencing UI on kiosk detail page; `alert_silenced_at` + `alert_silenced_reason` audit fields
**Plans**: 7 plans

Plans:
- [x] 09-01-schema-and-migration-PLAN.md — `kiosk_performance_alert_state` table + `kiosks.alert_silenced_*` columns + migrations 0043/0044/0045
- [x] 09-02-pure-logic-library-PLAN.md — `decideAlert` decision function, `iso-week`, `hash`, `poc-batching` modules with unit tests
- [x] 09-03-cron-and-classification-PLAN.md — `classifyEligibleLocations` + Inngest weekly cron + step-level idempotency + cold-start detection
- [x] 09-04-email-template-PLAN.md — Branded `PocUnderperformanceEmail` React component + plain-text variant
- [x] 09-05-admin-page-PLAN.md — `/admin/performance-alerts` read-only dashboard + "Run now" button with rate-limit
- [x] 09-06-kiosk-silencing-ui-PLAN.md — Per-location silencing UI on `/locations/[id]` + audit trail
- [x] 09-07-doc-updates-PLAN.md — STATE.md / REQUIREMENTS.md / phase-summary close-out

### Phase 9.1: Multi-currency analytics — forex normalisation (INSERTED)
**Goal**: Cross-currency portfolios rank correctly. Adds an `exchange_rates(currency, rate_date, rate_to_gbp, source, fetched_at)` table populated daily from the **Bank of England daily spot rate** (D-01 locked — BoE IADB CSV, no triangulation through EUR, zero-auth, ~25 majors). Denormalises **`net_amount_gbp` only** onto `sales_records` at ingest using the BoE rate for `transaction_date` with carry-forward gap-fill (D-09 — vat/total companion columns deferred until a real consumer surfaces). Rate is locked at insert time — later BoE revisions never retroactively rewrite stamped rows. When the most recent BoE rate for a currency is more than 7 calendar days older than a row's `transaction_date`, the sales ETL hard-fails the affected blob and emits an `fx_rate_stale` email alert (D-07). Swaps every analytics `SUM(net_amount)` aggregate to dual-emit `(SUM(net_amount), SUM(net_amount_gbp), currency_key)` for renderer auto-pick (single-currency cohort → native, mixed → GBP per D-10/D-11). Switches the Phase 9 POC underperformance classifier (`classifyEligibleLocations`) and `commission/processor.ts` commission base to GBP-normalised revenue. `/admin/performance-alerts` always renders GBP and surfaces a stale-rate banner when the last successful BoE fetch is older than 24h. Per-kiosk POC email continues to render native currency via existing `format-currency.ts` (unchanged).
**Depends on**: Phase 9 (classifier change), Phase 7 (sales ETL extension)
**Tracks**: GitHub issue #39 (surfaced from PR #38 code review)
**Requirements**: FX-01, FX-02, FX-03, FX-04
**Success Criteria** (what must be TRUE):
  1. `exchange_rates(currency, rate_date, rate_to_gbp, source, fetched_at)` populated daily from Bank of England via Inngest cron `fx-rates.fetch-daily`; carry-forward lookup for non-publish days; 7-day staleness ceiling enforced at sales ETL with `fx_rate_stale` email alert; fetch failures emit `fx_rate_fetch_failed`
  2. `sales_records.net_amount_gbp` populated on ingest using the BoE rate for `transaction_date` (identity for `currency='GBP'` — no rate lookup); one-shot historical backfill script populates pre-existing rows; migration 0048 flips the column to NOT NULL after backfill completes
  3. Every analytics query audited; cross-cohort aggregations rank/sort on `net_amount_gbp` (always GBP per D-12) while dual-emitting `(SUM(net_amount), SUM(net_amount_gbp), currency_key)` so the renderer auto-picks native for single-currency cohorts and GBP for mixed cohorts (D-10/D-11). Pivot-engine field id `net_amount` preserved for saved-pivot back-compat (D-17). Sales mode and Revenue mode both swap.
  4. `classifyEligibleLocations` ranks on `net_amount_gbp`; `commission/processor.ts` commission base on `net_amount_gbp`; `/admin/performance-alerts` always-GBP + stale-rate banner when MAX(`exchange_rates.fetched_at`) > 24h; POC underperformance email continues to render each kiosk's native-currency revenue via the existing `formatRevenueForKiosk` helper
**Plans**: 11 plans (8 original + 3 gap closure)

Plans:
- [x] 09.1-01-PLAN.md — Wave 0: Test fixtures + RED-stage scaffolds (FX-01..04)
- [x] 09.1-02-PLAN.md — Wave 1: Schema + EmailKind + drizzle push (FX-01/FX-02)
- [x] 09.1-03-PLAN.md — Wave 1: FX library — boe-fetch + rate-lookup + currencies (FX-01/FX-02)
- [x] 09.1-04-PLAN.md — Wave 2: Inngest cron fx-rates.fetch-daily + serve registration (FX-01)
- [x] 09.1-05-PLAN.md — Wave 3: ETL stamping + backfill script + 0048 NOT-NULL flip operator-gated (FX-02)
- [x] 09.1-06-PLAN.md — Wave 3: Analytics SQL audit dual-emit (41 sites / 13 files) (FX-03a)
- [x] 09.1-07-PLAN.md — Wave 4: Renderer dispatch + tooltips + classifier/commission swaps + admin stale banner (FX-03b/FX-04)
- [x] 09.1-08-PLAN.md — Wave 5: Doc edits (ROADMAP/REQUIREMENTS/PROJECT/STATE) + 09.1-HUMAN-UAT.md operator runbook
- [x] 09.1-09-PLAN.md — Wave 1 (gap closure): plain-text dispatch + UUID-shape validator + inArray IN-list + FX_ALERT_TO env-required + hotel-groups buildActiveLocationCondition migration (closes Gaps 1-4 + WR-04)
- [x] 09.1-10-PLAN.md — Wave 1 (gap closure): daysBetweenIso shared helper + backfill cursor uuid-typed + commission processor uuid[] bind (no 65k ceiling) + pivot-engine WR-09 currency_key symmetry test (closes CR-04 + CR-05 + WR-05 + WR-09)
- [x] 09.1-11-PLAN.md — Wave 2 (gap closure 2): recipient lifted to run-start in fx cron + azure-etl (NEW CR-01) + EmailTemplate union extended with "plain-text" sentinel (NEW CR-02) + num-rooms-subquery regex updated post-CR-01 inArray + FX cron integration FX_ALERT_TO stub + run-start throw spec (closes 3 gaps from re-verification)

### Phase 10: Access Control Extended
**Goal**: Migrate RBAC onto CASL (`@casl/ability` + `@casl/react`). Tier rules stored as JSON in DB, editable from an admin UI without deploy; `redactSensitiveFields` becomes `permittedFieldsOf(ability, 'read', subject)`. Custom granular roles authorable in admin UI per-role rule set (subjects × actions × fields × conditions).
**Depends on**: Nothing in v1.1 (independent of data/email arc)
**Requirements**: AUTH-06, AUTH-07
**Success Criteria** (what must be TRUE):
  1. CASL `Ability` built in `get-user-ctx`; `userScopes` continues to drive `conditions`
  2. Configurable Ops/IT/Read-only tier rules persisted as JSON in DB; admin UI for tier editing without deploy
  3. `redactSensitiveFields` replaced by `permittedFieldsOf(ability, 'read', subject)` drop-in across all call sites
  4. Admin can create / edit / clone custom granular roles (subjects × actions × fields × conditions) and assign per-user
  5. Existing 3-role coverage (Admin / Ops-IT / Read-only) preserved as default tier definitions; no behavioural regression for current users
**Plans**: 8 plans

Plans:
- [x] 10-01-wave-0-test-scaffolds-PLAN.md — Wave 1 RED test scaffolds (16 files)
- [x] 10-02-schema-migrations-and-audit-extension-PLAN.md — Wave 1 schema (3 tables) + 3 migrations + audit union widen + CASL deps
- [x] 10-03-casl-core-ability-builder-PLAN.md — Wave 2 buildAbility (react.cache) + types/subjects/fields/external-invariant/seed/role-mirror/lockout-guard/ability-context
- [ ] 10-04-rbac-shim-and-call-site-cutover-PLAN.md — Wave 3 rbac.ts shim + 3 redactSensitiveFields call sites (location-products-client owned by 10-07)
- [ ] 10-05-settings-roles-admin-ui-PLAN.md — Wave 3 /settings/roles list + drill-in + diff-preview + impacted-users
- [ ] 10-06-user-role-assignment-ui-and-removeuser-wrap-PLAN.md — Wave 4 /settings/users/[id]/page.tsx + role-actions + deleteUser lockout wrap
- [ ] 10-07-client-can-gates-and-ability-provider-PLAN.md — Wave 5 layout AbilityProvider + 3 <Can> client gates
- [ ] 10-08-playwright-uat-and-doc-closeout-PLAN.md — Wave 6 preview Playwright UAT + ops runbook + ROADMAP/REQUIREMENTS/STATE close-out

### Phase 11: Tooling, Polish & Tech-Debt Close-out
**Goal**: Close every outstanding non-trivial item batched at v1.1 close: staging orphan-rate baseline, Monday drift detection, analytics `useEffect → loadData()` migration, GitHub auto-delete-merged-branches, tab hover/loading polish, calendar empty-state overlay, bulk-action type-safety, Drizzle 0.45.2 patch audit. v1.1 reaches a clean operational baseline before v1.2 / v2.0 scope.
**Depends on**: Phases 7-10 (touches code shipped in each)
**Requirements**: TEST-01, MONDAY-01, REF-01, INFRA-01, POLISH-01, POLISH-02, DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. Staging orphan-rate baseline measurement + CI invariant assertion when threshold exceeded
  2. Scheduled Monday-drift detection job surfacing diffs in admin UI (Monday is SoT, "drift" means Monday changed)
  3. Analytics dashboards migrated to shared `loadData()` pattern; `react-hooks/set-state-in-effect` suppressions removed
  4. GitHub auto-delete-merged-branches enabled; tab hover/loading polish + calendar empty-state overlay shipped per debug specs
  5. Zod-validated patch schemas in kiosk + location `bulk-actions.ts`; `as any` casts removed
  6. Drizzle 0.45.2 patch audit complete (upgraded to 0.46+ or documented why stuck)
**Plans**: TBD (run `/gsd-plan-phase 11`)

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10 → 11. Phase 10 may execute in parallel with 8/9 (independent of data/email arc).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Data Foundation Rebuild | 6/6 | Complete (PR #36 merged) | 2026-05-08 |
| 8. Email Infrastructure | 3/3 | Code-complete; awaiting operator UAT | — |
| 9. POC Underperformance Alerts | 7/7 | Complete (PR #38 merged) | 2026-05-09 |
| 9.1 Multi-currency analytics — forex normalisation (INSERTED) | 10/11 | Gap closure round 2 planned (09.1-11 — closes 3 NEW regressions introduced by 09.1-09: NEW CR-01 recipient-in-arg-eval, NEW CR-02 EmailTemplate union miss, 2 test regressions); awaiting execution + operator UAT against preview alias (`09.1-HUMAN-UAT.md`) | — |
| 10. Access Control Extended | 3/8 | In Progress|  |
| 11. Tooling, Polish & Tech-Debt Close-out | 0/0 | Not planned | — |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Map view / geographic visualisation | Server-side geocoding (`/settings/geocoding`, shipped v1.0) is sufficient; research preserved at `.planning/research/v1.1-map-library.md` |
| In-app notification centre / bell | Dropped 2026-05-09 with the broader notification rescope |
| Per-user kiosk-status notifications, admin offline alerts, scheduled fleet-health digests, custom report templates | Dropped 2026-05-09 (NOTIF-01/02 + REPORT-05/06); no v2 carry. POC-ALERT-01 is the only outbound operational alert in v1.1 |
| Per-user notification preferences page (`/account/notifications`) | Not built. POC-ALERT-01 is operational, not a preference; silencing is admin-only per-kiosk |
| `freeTrialEndDate` analytics | Deferred (originally REPORT-V2-03); pickup tied to maintenance-fee recurring-revenue work |
| 2024-to-date sales corpus backfill + Azure daily ETL takeover | Deferred to v1.2 / v2.0; activates when full historical CSV/blob feed is available |
| Analytics CTE type-safety refactor | Deferred to v1.2 / v2.0; `db as any` in 11 analytics query files; significant scope |

---
*Created 2026-05-09 — derived from REQUIREMENTS.md (approved 2026-05-03) + per-phase CONTEXT/PLAN/SUMMARY artifacts. Mirrors the v1.0 ROADMAP structure preserved at `milestones/v1.0-ROADMAP.md`.*
