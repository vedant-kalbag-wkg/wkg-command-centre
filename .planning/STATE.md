---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: data-foundation-and-email
status: verifying
stopped_at: "Phase 9 (POC Underperformance Alerts) code-complete + reviewed via /gsd-execute-phase 9. 7 plans / ~30 commits across 5 waves. gsd-code-reviewer initial verdict BLOCK (CR-01/CR-02/CR-03 + WR-03) — all four resolved in commit 3570cbe. gsd-verifier verdict human_needed: 7/7 plans + 15/15 code truths COVERED; 8 operator UAT items in 09-HUMAN-UAT.md (push, preview deploy, BETTER_AUTH_URL pin, migrations 0043+0044, Playwright admin+silencing specs against preview alias, manual visual UAT, end-to-end Inngest event trigger). Phase 8 also still awaiting operator UAT (08-HUMAN-UAT.md)."
last_updated: "2026-05-09T22:35:00.000Z"
last_activity: 2026-05-09 -- Phase 9 close: code review fixes committed (CR-01/02/03 + WR-03), gsd-tools phase complete called, awaiting operator UAT before merge.
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 15
  completed_plans: 15
  percent: 20
  notes: "Phase 7 fully shipped. Phase 8 + Phase 9 both code-complete pending operator UAT (08-HUMAN-UAT.md, 09-HUMAN-UAT.md). Neither yet counts toward completed_phases. completed_plans counts every plan with a committed SUMMARY across the 3 planned-and-executed phases (5 + 3 + 7 = 15)."
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-03 at v1.1 milestone scoping)

**Core value:** Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure — with analytics that Monday.com cannot produce.
**Current focus:** Phase 9 code-complete; awaiting operator UAT before merging. Phase 10 (Access Control Extended) is the next planning target.

## Current Position

Phase: 09
Status: Phase 9 code-complete 2026-05-09. ~30 commits ahead of origin/main across 5 waves (schema → pure logic → email template → cron + classification → admin UI + kiosk silencing UI → doc close-out). 629 unit tests pass, `tsc --noEmit` clean. 8 operator-only items pending: branch push, Vercel preview deploy, BETTER_AUTH_URL preview env var pinned to git-branch alias, migrations 0043+0044 applied to preview DB, Playwright specs (`tests/admin/performance-alerts.spec.ts` + `tests/kiosks/silence.spec.ts`) run against preview, manual visual UAT, end-to-end weekly cron event verification. POC-ALERT-01 ticked in REQUIREMENTS.md.
Last activity: 2026-05-09

## v1.1 Phase Index

- ✓ Phase 7: Data Foundation Rebuild — DATA-01..05 — **MERGED 2026-05-08** (PR #36, squash `05fbf07`; full review loop: PR #34 merge → PR #35 revert → PR #36 with 4 fix commits)
- → Phase 8: Email Infrastructure — EMAIL-01..04 — branch `gsd/phase-08-email-infrastructure` (code-complete; awaiting operator UAT)
- → Phase 9: POC Underperformance Alerts — POC-ALERT-01 — branch `gsd/phase-09-poc-underperformance-alerts` (code-complete 2026-05-09; awaiting operator Playwright + manual UAT against Vercel preview alias)
- Phase 10: Access Control Extended — AUTH-06..07 — branch `gsd/phase-10-access-control-extended`
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

Current session: 2026-05-09 — Phase 9 close-out
Stopped at: Phase 9 (POC Underperformance Alerts) code-complete via /gsd-execute-phase 9. 7 plans / ~30 commits across 5 waves. Code-complete: schema (0043 + 0044 migrations), pure-logic library (decideAlert / isoWeekKey / groupByPoc / sha256), POC underperformance email template + plain-text companion, weekly Inngest cron + classify-kiosks bridge, admin /admin/performance-alerts page + Run-now trigger, kiosk silencing UI on /kiosks/[id]. Operator UAT punch list (8 items) tracked in `09-HUMAN-UAT.md` (to be persisted by verifier). Phase 8 also still awaiting operator UAT (`08-HUMAN-UAT.md`).
Resume file: `.planning/phases/09-poc-underperformance-alerts/09-07-SUMMARY.md`
Next action: operator runs Phase 9 Playwright specs against preview alias (per CLAUDE.md "Playwright specs against preview deploys"); when both green, merge phase 9 to main. Then `/gsd-discuss-phase 10` for Access Control Extended (AUTH-06..07).

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
