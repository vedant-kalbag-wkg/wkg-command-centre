---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 7 Plan 05 complete (prod cutover verified) — only Phase 7 verification gate remaining before merge
last_updated: "2026-05-08T05:45:00.000Z"
last_activity: 2026-05-08 -- Phase 7 Plan 05 complete (prod cutover; 95103 sales byte-perfect; 372 customer_codes; commit 5973f39)
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 5
  completed_plans: 5
  percent: 95
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-03 at v1.1 milestone scoping)

**Core value:** Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure — with analytics that Monday.com cannot produce.
**Current focus:** Phase 7 — Data Foundation Rebuild

## Current Position

Phase: 7 (Data Foundation Rebuild) — ALL PLANS COMPLETE
Plan: Plan 07-05 (UAT + prod cutover) COMPLETE on 2026-05-08
Status: Phase 7 verification + completion gate is the only remaining work before merging gsd/phase-07-data-foundation-rebuild into main
Last activity: 2026-05-08 -- Plan 07-05 prod cutover (commit 5973f39); migrations 0039+0040 applied to prod, 95103 sales byte-perfect, 510 active locations / 400 active kiosks, 4 same-name conflicts deferred to operator merge UI on prod, 42-kiosk Monday operator-data gap accepted

## v1.1 Phase Index

- Phase 7: Data Foundation Rebuild — DATA-01..05 — branch `gsd/phase-07-data-foundation-rebuild`
- Phase 8: Email Infrastructure — EMAIL-01..04 — branch `gsd/phase-08-email-infrastructure`
- Phase 9: Notifications & Scheduled Reports — NOTIF-01..02, REPORT-05..06 — branch `gsd/phase-09-notifications-and-reports`
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
- **Email + deep-link only** for notifications in v1.1 — no in-app bell; subscriptions per-kiosk star + per-region; throttling = 5-min Inngest drain keyed by `(userId, entityType)`

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

Current session: 2026-05-08 — Phase 7 Plan 05 prod cutover complete
Stopped at: All Phase 7 plans complete; only Phase 7 verification + completion gate remaining
Resume file: none (HANDOFF.json deleted post-resumption per workflow)
Next action: /gsd-verify-work or /gsd-ship for Phase 7 close-out
