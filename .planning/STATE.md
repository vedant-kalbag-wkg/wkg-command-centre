---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: "Phase 10 (Access Control Extended) code-complete 2026-05-10. 8 plans across 6 waves shipped on branch `gsd/phase-10-access-control-extended`. Awaiting operator UAT against preview alias per CLAUDE.md gate and 10-HUMAN-UAT.md runbook. Once UAT clears: phase-completion summary commit + PR + merge to main."
last_updated: "2026-05-10T00:00:00Z"
last_activity: 2026-05-10 -- Phase 10 code-complete (8/8 plans)
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 43
  completed_plans: 33
  percent: 77
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-03 at v1.1 milestone scoping)

**Core value:** Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure — with analytics that Monday.com cannot produce.
**Current focus:** Phase 10 — access-control-extended

## Current Position

Phase: 10 (access-control-extended) — EXECUTING
Plan: 1 of 8
Status: Executing Phase 10
Last activity: 2026-05-11 -- Phase 10 execution started

## Pending v1.1 close-out actions (from completed phases)

These are tracked but do not block Phase 10 starting. Pick up when their
preconditions surface — see each phase's `deferred-items.md` for the
canonical entry.

- **DEFERRED-08.02-01** — `src/lib/rbac.test.ts` fails when `RESEND_API_KEY`
  is unset (`new Resend(...)` at module scope in `src/lib/email.ts`). Fix
  is lazy construction inside each send helper. Tracked in
  `phases/08-email-infrastructure/deferred-items.md`. Workaround:
  `RESEND_API_KEY=re_test_key npx vitest run`.

- **Phase 8 DNS-cutover items (1, 4, 8)** — sandbox UAT used Resend's
  shared sender (`onboarding@resend.dev`); the throwaway-user invite +
  arbitrary-recipient EMAIL-03 path needs DNS records on
  `command.weknowgroup.com` before it can be re-tested. Tracked in
  `phases/08-email-infrastructure/08-HUMAN-UAT.md`.

- **DEFERRED-09.1-01** — `analytics-currency-render` Test 1 (single-
  currency native render) deferred until a preview/staging env has
  non-GBP sales data. Renderer dispatch is unit-tested; only the live
  visual confirmation is missing. Tracked in
  `phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/deferred-items.md`.

- **DEFERRED-09.1-02** — `exchange_rates` table on prod is empty until
  the BoE Inngest cron fires at 06:00 Europe/London. Default path: wait;
  manual seed only if a non-GBP import lands first. Tracked in same
  deferred-items.md.

## v1.1 Phase Index

- ✓ Phase 7: Data Foundation Rebuild — DATA-01..05 — **MERGED 2026-05-08** (PR #36, squash `05fbf07`; full review loop: PR #34 merge → PR #35 revert → PR #36 with 4 fix commits)
- ✓ Phase 8: Email Infrastructure — EMAIL-01..04 — **MERGED 2026-05-09** (PR #37, commit `693e28d`; sandbox UAT complete via `onboarding@resend.dev`. 3 items remain `deferred-to-dns-cutover` — pickup when DNS records on `command.weknowgroup.com` are added; tracked in `phases/08-email-infrastructure/deferred-items.md` + `08-HUMAN-UAT.md`)
- ✓ Phase 9: POC Underperformance Alerts — POC-ALERT-01 — **MERGED 2026-05-09** (PR #38; 3-round Claude review loop closed, all CR-01..03 + WR-03 + revenue/percentile float bugs + cosmetic nits fixed)
- ✓ Phase 9.1 (INSERTED): Multi-currency analytics — forex normalisation to GBP base reporting — FX-01..04 — **MERGED 2026-05-10** (PR #40, squash `ca62db3`; 2-round Claude review loop: round 1 closed 4 medium + 3 nit; round 2 closed 2 observations including commission_ledger.gross_amount → gross_amount_gbp rename via migration 0049). Prod migrations 0046–0049 applied + 95,103-row GBP-identity backfill 2026-05-10.
- ✓ Phase 10: Access Control Extended — AUTH-06..07 — **MERGED 2026-05-10** (8 plans across 6 waves; Q1 reversal: user.role text mirror PRESERVED — Better Auth admin plugin reads it in 12 endpoints; 3 new DB tables: roles, role_permissions, user_roles; redactSensitiveFields → permittedFieldsOf at 3 call sites; `<Can>` gates on sidebar/user-menu/Merge button; CASL Ability built with react.cache; diff-preview modal + impacted-user count on tier rule save)
- Phase 11: Tooling, Polish & Tech-Debt Close-out — TEST-01, MONDAY-01, REF-01, INFRA-01, POLISH-01..02, DEBT-01..02 — branch `gsd/phase-11-tooling-polish-debt`

## v1.0 Closed State (reference only)

v1.0 MVP shipped 2026-04-29 — 7 phases, 34 plans, 61 tasks; archived to `milestones/v1.0-ROADMAP.md` + `milestones/v1.0-REQUIREMENTS.md`. Total prod migrations 0001 → 0037, 1,000+ kiosks across 373+ active locations on prod. Full v1.0 phase summary in `MILESTONES.md`.

## Accumulated Context

### Decisions (carried into v1.1)

Pre-Phase-1 architectural decisions (still load-bearing for v1.1):

- Use Better Auth 1.5.x for auth/RBAC — Auth.js on security-only maintenance, Lucia deprecated
- Use `kiosk_assignments` temporal join table (not a simple `venue_id` FK) — assignment history is the primary Monday.com differentiator
- Use FLOAT8 for pipeline stage ordering positions — avoids batch UPDATE race conditions on reorder
- Use application-layer audit log with denormalised actor/entity names — DB triggers cannot provide business context

v1.0 close decisions (newly load-bearing for v1.1):

- **Resend as v1.1 email provider, Brevo as documented fallback** (locked 2026-04-29) — best Next.js/Vercel DX, EU region for GDPR, free tier covers volume
- **Monday is authoritative SoT for hotel/location identity** (locked during v1.1 scoping 2026-05-03) — codified via wipe-and-rebuild approach in `.planning/notes/v2-data-reset-decision.md`
- **No manual SQL for recurring operator cleanup** — every recurring destructive op is a first-class admin UI feature, not a script (locked 2026-05-03)
- **Two-pass `assigned_at` seed rule** — `live_date` primary, earliest CSV sale fallback (locked 2026-05-03)
- **`LOCATION_NEEDED` sentinel** for sales-orphan outlet codes (locked 2026-05-03)
- Tooltip-as-audit-trace pattern (Plan 06-03) — reusable substrate for v1.1 analytics work

v1.1 scoping decisions (locked 2026-05-03):

- **Inngest** (`inngest@4.2.6`) for email queue + cron triggers — replaces bespoke `email_jobs` table + manual cron; thin `email_log` audit table with `payloadHash` unique idx for digest idempotency
- **CASL** (`@casl/ability@6.8.1` + `@casl/react@6.0.0`) for RBAC — DB-storable JSON rules, admin-UI authorable, `redactSensitiveFields` → `permittedFieldsOf` drop-in
- ~~**Email + deep-link only** for notifications in v1.1 — no in-app bell; subscriptions per-kiosk star + per-region; throttling = 5-min Inngest drain keyed by `(userId, entityType)`~~ — **superseded 2026-05-09**: NOTIF-01/02 + REPORT-05/06 dropped, no v2 carry; replaced by single Inngest weekly cron emailing kiosk POCs when their `Live` kiosks fall into the bottom outlet-tier (POC-ALERT-01); silencing is admin-only per-kiosk; no in-app bell, no per-user prefs page

Phase 7 Plan 06 decisions (locked 2026-05-06 during Plan 06 execution):

- **customer_code is the canonical hotel-level identifier** — sourced from Monday's `mirror3__1` ("Cust_cd (RPS)"), partial-unique per region, NULL for placeholders. Replaces `locations.outlet_code` (dropped by migration 0040).
- **outlet_code is per-kiosk** — lives on `kiosks.outlet_code`, attached to a location through `kiosk_assignments`. The same hotel can have multiple kiosks each with a distinct code.
- **mondayItemId as universal idempotency key** — every imported `locations` row carries the Monday item id (partial-unique). Replaces `(region, outlet_code)` as the importer's ON CONFLICT target.
- **Conflict-recovery via SAVEPOINT** in the hotel importer — duplicate customer_code across two Monday hotels OR same normalised_name across two boards (e.g. Live Estate + Australia DCM) no longer aborts Phase 1's tx; the conflicts are logged as `[Phase 07-06]` notes for operator triage via the merge UI.
- **Sentinel keying changed** — `(name='LOCATION_NEEDED', GLOBAL region)` is the new identification pair. The legacy `outlet_code='__LOCATION_NEEDED__'` is gone (column dropped).
- **Dimension resolver Pass 0** — sales rows with non-empty `customerCode` resolve via `locations.customer_code` first; falls back to kiosks-side outlet_code (Pass 1) then sentinel (Pass 2). Validated byte-perfect against the prod-canonical Jan2026 corpus (95103 rows / £1,783,083.58).

Full v1.0 decision history: `milestones/v1.0-ROADMAP.md` and per-plan SUMMARY.md files in `milestones/v1.0-phases/`.

### Roadmap Evolution

- Phase 9.1 inserted after Phase 9 — Multi-currency analytics (forex normalisation to GBP base reporting). URGENT. Tracks GitHub issue #39, surfaced from PR #38 code review where the cross-currency mis-ranking gap was identified in `classifyEligibleLocations`. v1.1 ROADMAP.md created the same day (2026-05-09) — previously the v1.1 phase index lived only in STATE.md.

### Blockers/Concerns

- **Email transport silent-fail in prod** — `nodemailer` defaults to `localhost:1025`; SMTP_* env vars never set in Vercel. Forgot-password / invite emails fail silently. **Resolved by Phase 8 (EMAIL-01).**
- **macOS-vs-Linux lockfile drift** — codified in `CLAUDE.md`; revisit if it recurs once after v1.1 starts
- **Stale `gsd/phase-06-…` branch on origin** — GitHub auto-delete-merged-branches not enabled (Phase 11 / INFRA-01)
- **2 Dependabot moderates** flagged at v1.0 close — to be triaged during v1.1

### Pending Todos

None at v1.1 scoping start. Three unresolved debug sessions tracked in v1.1 category F:

- `.planning/debug/calendar-empty-state-overlay.md` — fix specified, awaiting human verify (Phase 11 / POLISH-02)
- `.planning/debug/tab-hover-loading-state.md` — fix specified, awaiting human verify (Phase 11 / POLISH-01)
- `.planning/debug/knowledge-base.md` — pattern registry, not unresolved

## Session Continuity

Current session: 2026-05-09 — Phase 9.1 code-complete (8/8 plans shipped)
Stopped at: Phase 9.1 (Multi-currency forex normalisation) shipped 2026-05-09 on branch `gsd/phase-09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep`. 8 plans across 5 waves: 09.1-01 Wave 0 fixtures + RED tests; 09.1-02 schema substrate (exchange_rates table, sales_records.net_amount_gbp NULLABLE, EmailKind extended); 09.1-03 FX library (boe-fetch + rate-lookup + currencies); 09.1-04 Inngest cron `fx-rates.fetch-daily` + serve registration; 09.1-05 ETL stamping + backfill script + migration 0048 NOT NULL flip operator-gated; 09.1-06 analytics SQL audit dual-emit (41 sites / 13 files) with saved-pivot back-compat (D-17); 09.1-07 renderer dispatch + tooltips + classifier/commission swaps + admin stale-rate banner; 09.1-08 doc surgery (ROADMAP/REQUIREMENTS/PROJECT/STATE) + 09.1-HUMAN-UAT.md operator runbook. Awaiting operator UAT against preview alias per CLAUDE.md gate (`PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/fx-normalisation/`); list-pass is NOT sufficient evidence.
Resume file: `.planning/phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/09.1-HUMAN-UAT.md`
Next action: Operator runs the 09.1-HUMAN-UAT.md checklist against the preview deploy: confirm `BETTER_AUTH_URL` is the git-branch alias; trigger `fx-rates-fetch-daily` Inngest cron once on preview; apply migration 0048 NOT NULL flip post-backfill; run Playwright suite against preview alias; walk the 3 visual UAT items; confirm `SELECT COUNT(*) FROM sales_records WHERE net_amount_gbp IS NULL` returns 0; confirm zero npm dep drift. Once UAT clears, phase-completion summary commit + PR + merge to main. Phase 10 (Access Control Extended) is the next downstream item once 9 + 9.1 are merged.

### Phase 9.1 decisions captured 2026-05-09

- **Rate source = Bank of England daily spot** (D-01) — native GBP base, no triangulation. ECB and NetSuite-as-source rejected.
- **Ingest = Inngest cron `fx-rates.fetch-daily`** (D-02), runs ~06:00 UTC, ordered before existing Azure sales ETL.
- **Currency coverage = BoE-supported broad set** (D-03) — ~25 majors. Unknown currency in CSV → ETL fails loudly.
- **Backfill = from earliest `transaction_date` to today** (D-04). GBP rows shortcut to identity (no rate lookup).
- **Non-publish dates = carry-forward via lookup** (D-05). `exchange_rates` only stores publish-day rows.
- **BoE fetch failure = ingest with carry-forward fallback + alert** (D-06). Sales keep flowing during outages.
- **Staleness ceiling = 7 days** (D-07). Beyond 7d carry-forward, ETL hard-fails for the affected blob.
- **Alert path = Phase 8 `email_log` substrate** (D-08). New kinds `fx_rate_fetch_failed`, `fx_rate_stale`.
- **GBP companion columns = `net_amount_gbp` only** (D-09). ROADMAP must be edited to drop the vat/total listing — `gross_amount` was dropped 2026-04-24 so total is derived (net+vat); no current consumer for vat-in-GBP.
- **No user-facing toggle** (D-10). Display follows data: single-currency cohort → native, multi-currency cohort → GBP.
- **Every aggregate query dual-emits** (D-11) — `SUM(net_amount)` + `SUM(net_amount_gbp)` + `currency` key (single value when COUNT(DISTINCT currency)=1, else NULL).
- **Sorting/ranking always uses GBP** (D-12). EUR-only and GBP-only regions rank correctly head-to-head.
- **Per-kiosk drill-down** = native (D-13) — matches existing Phase 9 POC email contract via `format-currency.ts`. Unchanged.
- **`classifyEligibleLocations` swap to GBP** (D-14) — single-line change at `src/lib/performance-alerts/classify-locations.ts:172`.
- **`commission/processor.ts` swap to GBP** (D-15) — commission is paid out in GBP regardless of source currency.
- **`/admin/performance-alerts` always GBP** (D-16) — cross-portfolio surface. Adds stale-rate banner.
- **`pivot-engine.ts` field name preserved** (D-17) — `net_amount` ID kept for saved-pivot compat; underlying SQL rewritten per D-11.

### Phase 9.1 close (post-execution) 2026-05-09

8 plans across 5 waves shipped on branch `gsd/phase-09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep`. Headline deliverables (FX-01..FX-04 code-complete):

- **Migration trio (0046 / 0047 / 0048)** — `exchange_rates` table with composite PK `(currency, rate_date)` and `numeric(18,10) rate_to_gbp` precision; `sales_records.net_amount_gbp numeric(12,2)` NULLABLE column; NOT NULL flip operator-gated post-backfill (Pitfall 7 split). EmailKind extended in TS only with `fx_rate_fetch_failed` + `fx_rate_stale` (no DB CHECK on `email_log.kind` per Phase 8 house style).
- **FX library** (`src/lib/fx/`) — `BOE_SERIES_TO_CCY` (27 IADB series → ISO 4217), `BOE_SUPPORTED_CURRENCIES` (28-entry frozen list incl. GBP identity), `parseBoeCsv` (pure wide-form → long-form melt with zod validation), `buildBoeCsvUrl` + `fetchBoeRatesForDate` (native fetch, no new deps), `getRateForDate` (GBP-identity-shortcut + carry-forward, returns staleDays signal — caller enforces D-07 ceiling).
- **Inngest cron `fx-rates.fetch-daily`** at `TZ=Europe/London 0 6 * * *` — extracted handler with StepShim type for integration drivability; idempotent bulk upsert via composite PK; fan-out `fx_rate_fetch_failed` event before re-throw (avoids Inngest step-state discard); audit-log writeback every run; registered alongside weekly-poc-alerts in `src/app/api/inngest/route.ts`.
- **ETL stamping + 7-day staleness gate** — `pipeline.ts` per-chunk batched (currency, date) rate gather + per-row `net_amount_gbp` stamp inside the same transaction (D-03/D-04/D-05/D-07); `azure-etl.ts` defensive per-blob pre-commit stale-FX gate that fans out `fx_rate_stale` and refuses commit. `scripts/backfill-net-amount-gbp.ts` idempotent (`WHERE net_amount_gbp IS NULL`) cursor-restartable backfill with `--dry-run`.
- **Analytics SQL audit + dual-emit (41 sites / 13 files)** — every `SUM(net_amount)` site dual-emits `(SUM(net_amount), SUM(net_amount_gbp), currency_key)` per D-11. Sales mode and Revenue mode both swap. `currency_key` resolver: `MIN(currency)` when `COUNT(DISTINCT currency)=1`, else `NULL`. Cross-cohort sort/rank/percentile always `net_amount_gbp` per D-12. CTE-level dual-emit propagation in hotel-groups.ts. Pivot-engine `ALLOWED_COLUMNS` preserves field id `net_amount` for saved-pivot back-compat (D-17 / Pitfall 4); GBP companion + currency_key auto-emitted by `buildPivotSQL`.
- **Renderer dispatch via `pickRevenueDisplay`** (D-10) — RegionDetail / HotelGroupDetail / LocationGroupDetail metric tiles wire native vs GBP per cohort cardinality; pivot-engine `formatCell` extended with optional `currencyKey` arg for per-cell + grand-total dispatch with bucket-level uniformity; back-compat fallback for legacy callers.
- **FX-04 surgical line swaps** — `classify-locations.ts:172` swapped to `net_amount_gbp` (D-14); `commission/processor.ts:206` cumulative base + per-row engine call swapped to `netAmountGbp` (D-15); ledger `grossAmount` now stores GBP. POC email `format-currency.ts` UNCHANGED (D-13/D-14 — kiosks still see €/¥/$ in their personalised emails).
- **`/admin/performance-alerts` always-GBP + stale-rate banner** (D-16) — destructive-styled Card above latest-run Card when `MAX(exchange_rates.fetched_at) > 24h`; copy explicitly references both the 24h trigger and the 7-day downstream consequence the admin needs to prevent.
- **Doc surgery (this plan, 09.1-08)** — ROADMAP Phase 9.1 block corrected (drop vat/total, lock BoE, add 7-day rule, fill plan list); REQUIREMENTS section G with FX-01..04 + 4 traceability rows + totals updated to 24/24; PROJECT.md acknowledges scope under new G section; this STATE.md close entry; `09.1-HUMAN-UAT.md` operator runbook.

Zero new npm dependencies across all 8 plans (verified via empty `git diff package.json package-lock.json`). Operator UAT against preview alias is the merge gate per CLAUDE.md "Playwright specs against preview deploys" rule.

### Phase 8 decisions captured 2026-05-08

- Sending domain: `noreply@command.weknowgroup.com` (subdomain of weknowgroup.com, transactional-only)
- Auth-flow emails (forgot-password / invite / external-invite): sync Resend in handler — Inngest reserved for digests/notifications/reports
- Templates: `@react-email/components` with brand tokens in `src/emails/brand.ts`
- Change-password confirmation: timestamp + "contact admin"; no IP, no UA (minimal PII)
- EMAIL-03 UAT bar: invite throwaway → click link → set password → sign in (operator-driven, not Claude-driven, since deliverability requires a real inbox)

### Phase 8 housekeeping flagged

- `.planning/ROADMAP.md` lives only on `docs/architecture-and-azure-hosting` (commit `1a0d6a7`); port to phase-branch line before v1.1 close-out merge. The port must reflect the 2026-05-09 phase 9 rescope (POC-ALERT-01 replaces NOTIF-01/02 + REPORT-05/06).

### Phase 9 decisions captured 2026-05-09

- **Scope cut** — NOTIF-01/02 + REPORT-05/06 dropped from v1.1, no v2 carry; replaced by POC-ALERT-01
- **Underperformance** = outlet tier 'bottom' (existing percentile cutoffs in `appSettings`, admin-tunable via thresholds editor)
- **Aggregation** — per-kiosk classification, batched per-POC (one email per POC per run)
- **POC routing** — strict `kiosks.internal_poc_id`; NULL → silent skip with `email_log` row
- **Eligibility** — `pipeline_stage='Live'` AND not archived AND `outlet_code IS NOT NULL`
- **Cadence** — flip-into-bottom always alerts; chronic bottom alerts monthly; weekly cron (Mondays 09:00 Europe/London)
- **Window** — admin-configurable via new `appSettings.underperformance_window_days` (default 30)
- **Email content** — list of bottom-tier kiosks (kioskId, location, region, sales-over-window, percentile rank); per-row deep link to `/kiosks/[id]`; footer CTA → `/analytics/portfolio`
- **Silencing** — admin-only per-kiosk via new `kiosks.alert_silenced_at` + `alert_silenced_reason`; no per-user opt-out
- **Admin UI** — new `/admin/performance-alerts` (admin-RBAC) read-only metadata page + manual "Run now" trigger button
- **Schema** — new table `kiosk_performance_alert_state`; new columns on `kiosks`; new appSettings seed; reuses Phase 8 `email_log` partial unique idx for idempotency
- **Resolving "Live"** (Claude's discretion / planner) — UUID-pin via `appSettings` vs. seeded-position fallback vs. denormalised flag on `pipeline_stages`; brittle name match explicitly forbidden

### Phase 10 decisions captured 2026-05-10

- **Q1 reversal — user.role text PRESERVED** — Better Auth admin plugin (1.5.x) reads `session.user.role` text in 12 endpoint handlers; dropping the column would require upstream hooks or a custom session plugin. Mirror kept and refreshed in lock-step via `refreshUserRoleMirror`. Deferred to v1.2 at earliest (DEFERRED-10-01).
- **CASL Ability built with `react.cache`** — `get-user-ctx.ts` calls `buildAbility(rules)` inside `react.cache` so the Ability object is constructed once per request, not per-component.
- **`redactSensitiveFields` → `permittedFieldsOf`** — three call sites in locations server actions / [id]/page / new/page replaced with CASL-native field filtering; no separate allow-list constant.
- **`AbilityProvider` rules-as-prop pattern** — raw rules serialised from server, client reconstructs Ability; avoids hydration mismatch and keeps SSR-safe.
- **3 new DB tables** — `roles` (system + tier kinds), `role_permissions` (subject/action/field/conditions JSON), `user_roles` (M:M join); migrations 0050 + 0051 auto-apply in Vercel build; 0052 (NOT-NULL flip on `user_scopes.role_id`) is operator-gated post-backfill-verify.
- **5 audit-log metadata kinds** — `role.create`, `role.permissions.replace`, `role.delete`, `user.roles.assign`, `user.roles.revoke` added to existing audit log infrastructure.
- **Diff-preview modal** — tier rule saves show a diff modal (N removed / M added / K changed) with impacted-user count before committing; admin confirms before write.
- **`<Can>` gates** — sidebar "Configure" nav-group, user-menu "Admin" section, and location Merge button gated via `<Can I="manage" a="all">` (admin-only); zero visible surface for non-admin roles.

### Phase 10 close (post-execution) 2026-05-10

8 plans across 6 waves shipped on branch `gsd/phase-10-access-control-extended`. Headline deliverables (AUTH-06..AUTH-07 code-complete):

- **Critical reversal documented: user.role text PRESERVED** — Better Auth admin plugin reads it in 12 endpoints; `refreshUserRoleMirror` keeps the text column in sync with `user_roles` writes; drop deferred to v1.2 (DEFERRED-10-01 in `phases/10-access-control-extended/deferred-items.md`).
- **CASL RBAC foundation** — `@casl/ability@6.8.1` + `@casl/react@6.0.0`; `buildAbility` from `role_permissions` rows; `AbilityProvider` rules-as-prop (SSR-safe); `react.cache` singleton per request in `get-user-ctx.ts`.
- **3 new DB tables + 3 migrations** — `roles`, `role_permissions`, `user_roles`; migration 0050 (schema) + 0051 (seed Admin/Ops-IT/Read-only roles + backfill `user_roles` from `user.role`) auto-apply in Vercel build; migration 0052 (`user_scopes.role_id NOT NULL` flip) is operator-gated.
- **`/settings/roles` admin UI** — role list with system-lock indicator; tier role drill-down with rule editor (subject multi-select / action chips / field picker / conditions builder); diff-preview modal + impacted-user count on save; create/clone/delete tier roles.
- **`/settings/users/{id}` roles block** — assign and revoke tier roles with confirmation; last-admin guard: refuses save that would leave system with zero effective admins.
- **`redactSensitiveFields` → `permittedFieldsOf`** at 3 call sites — locations server actions + [id]/page + new/page now use CASL-native field filtering.
- **`<Can>` client gates** — sidebar "Configure" nav-group, user-menu "Admin" section, location Merge button all gated via CASL `<Can>` component.
- **5 audit-log metadata kinds** — `role.create`, `role.permissions.replace`, `role.delete`, `user.roles.assign`, `user.roles.revoke`.
- **Playwright UAT suite** — 4 specs in `tests/access-control/`; `scripts/seed-test-users.ts` idempotent seed (refuses on production); `10-HUMAN-UAT.md` 9-step operator runbook covering Vercel preview, migration ops, Playwright run, manual smoke, post-merge close-out.
- **Zero new runtime npm deps** — `@casl/ability` + `@casl/react` are the only additions; no lockfile drift expected beyond those two packages.
