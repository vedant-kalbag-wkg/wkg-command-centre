# Phase 9: POC Underperformance Alerts - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a single notification flow: **on a weekly schedule, email each kiosk's
internal POC when their `Live` kiosk has fallen into the bottom outlet-tier
classification.** No other notification surfaces ship in v1.1.

This phase REPLACES the original v1.1 § C scope. The original four
requirements (NOTIF-01 per-user kiosk-status notifications, NOTIF-02 admin
offline alerts, REPORT-05 scheduled fleet-health digests, REPORT-06 custom
report templates) are **dropped from v1.1 entirely** at the user's
direction (2026-05-09) — no v2.0 carryover. They are replaced by a single
new requirement: **POC-ALERT-01 — Weekly bottom-tier POC email alert**.

### In scope

- New Inngest scheduled function (Mondays 09:00 Europe/London) that:
  1. Computes per-kiosk outlet-tier for `Live` kiosks against the existing
     percentile cutoffs (`appSettings: threshold_outlet_tier_top|mid|bottom`)
  2. Updates a new `kiosk_performance_alert_state` row per kiosk with
     `tier`, `classified_at`, `last_run_at`, `last_alerted_at`
  3. Selects kiosks that flipped INTO bottom tier this run, OR remained
     bottom and have not been alerted in ≥30 days
  4. Batches selected kiosks per-POC (`kiosks.internal_poc_id`) and emits
     one `email/send.requested` per POC with `kind='underperforming_poc'`
- New email template `src/emails/poc-underperformance.tsx` rendered via
  `@react-email/components` + brand tokens from `src/emails/brand.ts`
- New `EmailKind` + `EmailTemplate` union entries + `TEMPLATES` dispatch
  entry in `src/inngest/{events,functions/send-email}.ts`
- Admin per-kiosk silencing: new `kiosks.alert_silenced_at` (timestamptz)
  + `kiosks.alert_silenced_reason` (text) columns + admin UI surface to
  set / unset
- Admin read-only page `/admin/performance-alerts` showing last run
  metadata (timestamp, classified count, alerted count, skipped-no-POC
  count) + a "Run now" button that fires the Inngest function on demand
- New `appSettings` row `underperformance_window_days` (default 30) for
  the trailing-window length the cron uses; admin-tunable
- Drizzle migration adding the state table + kiosks columns + appSettings
  seed
- email_log gains a new `kind='underperforming_poc'` value (no schema
  change — `kind` is `text`)

### Out of scope (other phases / dropped)

- **NOTIF-01** (per-user kiosk-status / pipeline-stage emails) — DROPPED
  from v1.1, no v2 carry (user decision 2026-05-09)
- **NOTIF-02** (admin offline alerts) — DROPPED from v1.1, no v2 carry
- **REPORT-05** (scheduled fleet-health digests) — DROPPED from v1.1,
  no v2 carry
- **REPORT-06** (custom report templates) — DROPPED from v1.1, no v2 carry
- **Per-user `/account/notifications` opt-out page** — not built; the
  alert is operational, not a preference, and is silenced at the kiosk
  level by an admin instead
- **In-app notification bell** — explicitly out of scope for v1.1; no
  longer tracked for v1.2 either since the broader notification work was
  dropped
- **email_log admin UI** — Phase 11 polish if operators ask
- **RBAC tier rules / custom granular roles** — Phase 10
- **Tooling, polish, tech debt** — Phase 11

</domain>

<decisions>
## Implementation Decisions

### Scope cut (2026-05-09)
- **D-01:** Phase 9 is rescoped from "Notifications & Scheduled Reports"
  to "POC Underperformance Alerts". The four original requirements
  (NOTIF-01, NOTIF-02, REPORT-05, REPORT-06) are dropped from v1.1 with
  no v2 carryover. Justification: 30-user internal tool already lives in
  Outlook; the only operational alert that delivers actual value is
  flagging POCs whose kiosks are underperforming. The broader notification
  apparatus would have been built infrastructure with no validated user
  demand.
- **D-02:** Phase rename: "Phase 9: POC Underperformance Alerts". Branch
  rename: `gsd/phase-09-poc-underperformance-alerts` (from the prior
  `gsd/phase-09-notifications-and-reports` placeholder in STATE.md;
  branch was never created).

### Underperformance definition
- **D-03:** "Underperforming" = outlet tier classification of `bottom`,
  computed using the existing percentile cutoffs in
  `src/lib/analytics/thresholds-server.ts` (which read from `appSettings`
  rows `threshold_outlet_tier_top|mid|bottom`, admin-tunable via the
  existing `/analytics/portfolio` threshold editor). NO new threshold
  concept is introduced. NO new tier math. The cron reuses whatever the
  portfolio outlet-tiers page already computes today.
- **D-04:** Window for the tier classification: admin-configurable via a
  new `appSettings` row `underperformance_window_days` (default `30`).
  Trailing window ending at the run timestamp. The planner picks the
  exact `appSettings` schema shape (text vs. numeric value), reuses the
  existing thresholds-editor pattern.

### Aggregation + POC routing
- **D-05:** Classification is **per-kiosk** (matches existing outlet-tier
  math; outlet code is the unit). NO location-level aggregation.
- **D-06:** Email is **batched per-POC**: one email per POC per run,
  listing all of that POC's bottom-tier kiosks selected for alert this
  run. Avoids inbox spam when a POC owns multiple bottom-tier kiosks at
  one hotel or across hotels.
- **D-07:** POC routing is strict: `kiosks.internal_poc_id` only. NULL
  POC → kiosk is skipped, with one `email_log` row per skipped kiosk
  (kind='underperforming_poc', `recipient` left empty or set to a sentinel,
  status indicating skip — planner picks exact representation; the
  `/admin/performance-alerts` page surfaces the skip count). NO fallback
  to admins, NO fallback to other location-co-resident POCs.

### Eligibility filter
- **D-08:** Eligibility for classification AND alert: `kiosks.archived_at
  IS NULL` AND `kiosks.outlet_code IS NOT NULL` AND `pipeline_stage.name =
  'Live'`. Pre-launch (`Prospect`, `Awaiting Configuration`,
  `Configured`, `Ready to Launch`), `On Hold`, `Offline`, and
  `Decommissioned` kiosks are excluded — bottom-tier alerting is only
  meaningful for trading kiosks.
- **D-09:** Resolving "Live" against admin-renameable pipeline stages —
  the cron MUST NOT depend on the literal string `"Live"` matching a
  stage name. Recommended: pin a stage UUID via a new `appSettings` row
  (e.g. `pipeline_stage_id_live`) that admins update if they ever rename
  the live stage, OR fall back to the seeded stage at `position=7000`.
  Planner picks; document in PLAN.md. The brittle name match is
  explicitly forbidden.

### Frequency cap (anti-spam)
- **D-10:** Alert dispatch rule:
  - `is_flip_in` = (prior_tier ≠ 'bottom' OR no prior state) AND
    (new_tier = 'bottom') → ALWAYS alert
  - `is_chronic` = (new_tier = 'bottom') AND (prior_tier = 'bottom') AND
    (`last_alerted_at` IS NULL OR `now() - last_alerted_at >= 30 days`) →
    ALERT
  - Otherwise → no alert this run, but state is still updated
- **D-11:** Frequency cap requires persisting prior classification.
  New table `kiosk_performance_alert_state` (singleton row per kiosk):
  - `kiosk_id` (uuid PK FK → kiosks.id ON DELETE CASCADE)
  - `tier` (text, enum-ish: 'top' | 'mid' | 'bottom')
  - `classified_at` (timestamptz NOT NULL)
  - `last_run_at` (timestamptz NOT NULL — set every run, even when not
    alerting; lets us distinguish "kiosk skipped this run" from "kiosk
    was alerted")
  - `last_alerted_at` (timestamptz NULL — only set when an alert was
    actually emitted for this kiosk)
  Planner picks the exact column types and whether to add an index on
  `tier` for the per-run query.

### Schedule
- **D-12:** Inngest cron schedule: `0 9 * * 1` with `TZ=Europe/London`
  (Mondays 09:00 London time). Inngest's tz-aware cron handles DST.
  Single weekly run; no other cadence.
- **D-13:** Manual trigger from `/admin/performance-alerts` "Run now"
  button is admin-RBAC-gated and fires the same Inngest function via
  `inngest.send({ name: 'performance-alerts/run.requested' })` (or
  similar — planner picks event name). Idempotency via the `last_run_at`
  state column prevents accidental double-runs within a short window
  (planner enforces e.g. 5-minute minimum between runs, or relies on
  Inngest dedupe keys).

### Email content + deep links
- **D-14:** Email body lists each bottom-tier kiosk with: `kioskId`,
  location name, region, total sales over the configured window,
  percentile rank (or rank position — planner picks; brand-voice copy in
  `~/.claude/weknow-brand-guidelines.md`).
- **D-15:** Each kiosk row in the email has a per-kiosk deep link to
  `/kiosks/[id]`. Email footer has a single CTA to `/analytics/portfolio`
  (where the outlet-tiers widget lives).
- **D-16:** Email subject + brand voice are Claude's discretion (per
  WeKnow brand guidelines: Azure / Graphite, Circular Pro fallback,
  professional + actionable tone). Planner produces the strawman; the
  copy is reviewed during execution.
- **D-17:** Idempotency: `payloadHash` keyed on `(poc_user_id,
  run_iso_week)` so re-runs in the same ISO week (manual + scheduled, or
  duplicate cron fires) collapse to a single email. The `email_log`
  partial unique index `(kind, payload_hash) WHERE payload_hash IS NOT
  NULL` already exists from Phase 8 and is the enforcement point.

### Silencing controls (admin only)
- **D-18:** No per-user opt-out — the alert is operational, not a
  preference. The POC cannot disable it for themselves.
- **D-19:** Admin-only per-kiosk silencing: new columns
  `kiosks.alert_silenced_at` (timestamptz NULL) + `kiosks.alert_silenced_
  reason` (text NULL). When `alert_silenced_at IS NOT NULL`, the kiosk
  is excluded from BOTH classification and alerting (it does not appear
  in the email and does not produce a state row update — planner picks
  whether silenced kiosks still get classified-but-not-alerted, or
  excluded entirely from the cron walk).
- **D-20:** Admin UI for silencing lives on the kiosk detail page
  (`src/app/(app)/kiosks/[id]/`) as a small admin-RBAC-gated control —
  exact placement is planner's discretion (likely an admin section or
  modal). Reason field is free-text (no enum); brand-voice prompt copy
  in the form.

### Admin visibility
- **D-21:** New page `/admin/performance-alerts` (admin-only RBAC). Read
  shows: last run timestamp, kiosks classified, kiosks newly alerted,
  kiosks skipped (NULL POC), kiosks silenced. Source: query
  `kiosk_performance_alert_state` + `email_log` filtered to
  `kind='underperforming_poc'`. No write actions other than the "Run now"
  trigger button.
- **D-22:** "Run now" button is the only write surface in this phase's
  admin UI. It posts a server action that emits the Inngest event and
  redirects with a flash message ("Run queued — refresh in ~30 seconds").

### Schema additions (consolidated)
- **D-23:** Migration adds:
  1. New table `kiosk_performance_alert_state` (per D-11)
  2. New columns `kiosks.alert_silenced_at` + `kiosks.alert_silenced_
     reason` (per D-19)
  3. New `app_settings` rows seeded: `underperformance_window_days` = 30
     (per D-04), and `pipeline_stage_id_live` if the planner picks the
     UUID-pin route in D-09
  No changes to `email_log`, `audit_logs`, `user`, `account`, or any
  other auth / Phase 8 table.

### Claude's Discretion
- Email subject line, exact body copy, plain-text branch — frame within
  brand voice (`~/.claude/weknow-brand-guidelines.md`)
- Whether percentile rank renders as a number, bar, or word ("bottom 12%")
- Exact `appSettings` value type for the window (text-encoded number vs.
  numeric column)
- Manual-trigger event name + planner's rate-limit / dedupe approach
  for the "Run now" button (Inngest dedupe key vs. server-side
  `last_run_at >= now() - 5 min` check)
- Whether the silencing UI goes on the kiosk detail page, the admin
  panel, or both — based on existing kiosk-detail layout patterns
- Free-text vs. structured representation of the silencing reason (the
  spec is free-text but planner may add an audit-log entry)
- Strategy for resolving "Live" pipeline stage (D-09) — UUID-pin
  appSettings vs. seeded position fallback vs. a denormalised flag on
  `pipeline_stages` (e.g. `is_live BOOLEAN`)
- Inngest function file layout — likely
  `src/inngest/functions/weekly-poc-alerts.ts` mirroring
  `send-email.ts`'s shape
- Whether to introduce a small per-run summary row (e.g.
  `performance_alert_runs` table) or compute the admin-page metrics
  on-the-fly from `kiosk_performance_alert_state` + `email_log`. Default
  to on-the-fly; introduce a runs table only if the admin page query
  becomes slow

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked architectural decisions
- `.planning/REQUIREMENTS.md` § C — must be edited by this phase to
  remove NOTIF-01/02 + REPORT-05/06 and add POC-ALERT-01 (see D-01)
- `.planning/STATE.md` — must be edited to update phase 9 name + branch
  + decision summary (see D-02)
- `.planning/PROJECT.md` § "C. Notifications & scheduled reports" —
  align with REQUIREMENTS.md edit; replace bullet list with the
  POC-ALERT-01 single-line description

### Email substrate (Phase 8 — load-bearing)
- `.planning/phases/08-email-infrastructure/08-CONTEXT.md` — D-05
  ("Inngest is reserved for digests, notifications, reports") + D-06
  (`email_log` written for every send, `payloadHash` partial unique idx
  semantics) + D-07 (react-email + `@react-email/components` template
  pattern)
- `src/inngest/events.ts` — `EmailKind` + `EmailTemplate` unions; this
  phase extends both
- `src/inngest/functions/send-email.ts` — `TEMPLATES` dispatch table +
  3-step (`render-html` / `resend-send` / `log`) pattern; this phase
  reuses the function, only adds a new template entry
- `src/emails/brand.ts` — Azure / Graphite / Circular Pro brand tokens;
  reused by the new `poc-underperformance.tsx` template
- `src/emails/password-changed.tsx` + `src/emails/text-versions.ts` —
  reference implementation for the new template's structure + plain-text
  branch
- `src/lib/email.ts` — sync-Resend path is NOT used by this phase (POC
  alert is async via Inngest); read for the `RESEND_API_KEY` lazy-init
  + `EMAIL_FROM` env-var pattern

### Outlet tier classification (Phase 5/6 — load-bearing)
- `src/lib/analytics/thresholds-server.ts` — percentile cutoffs source;
  the cron MUST reuse this rather than reimplement tier math
- `src/app/(app)/analytics/portfolio/outlet-tiers.tsx` — UI surface
  showing the classification today; reference for how `top`/`mid`/`bottom`
  are computed and displayed
- `src/app/(app)/analytics/portfolio/threshold-editor.tsx` — admin UI for
  the existing percentile cutoffs; reference if the new `underperformance_
  window_days` knob co-locates here
- `src/app/(app)/analytics/portfolio/low-performer-patterns.tsx` —
  alternative low-performer surface (NOT the source-of-truth for this
  phase; D-03 picks tier-based, not pattern-based)

### Schema + DB
- `src/db/schema.ts` — new table `kiosk_performance_alert_state` lands
  here; new columns added to `kiosks` (lines ~117-144); new `appSettings`
  seed row
- `src/db/index.ts` — drizzle client export pattern
- Migration file naming: latest is `0041_…` (Phase 8); this phase adds
  `0042_…` (planner picks descriptive name)
- `src/db/seed-pipeline-stages.ts` — `Live` stage is seeded at
  `position=7000`; informs the D-09 fallback strategy

### Kiosk + RBAC surface
- `src/app/(app)/kiosks/[id]/page.tsx` — kiosk detail page; D-19
  silencing UI lands here or in admin route (planner picks)
- `src/lib/rbac.ts` — admin-only RBAC gate pattern; D-21 admin page +
  D-22 "Run now" + D-19 silencing UI all use admin gate
- `src/app/(app)/admin/` — existing admin route group; new
  `performance-alerts/` subroute lands here

### Operational context (CLAUDE.md)
- `CLAUDE.md` § "Vercel preview env vars — `BETTER_AUTH_URL` must use
  the git-branch alias" — same rule applies to `INNGEST_EVENT_KEY` /
  `INNGEST_SIGNING_KEY` / `RESEND_API_KEY` for preview UAT of this phase
- `CLAUDE.md` § "Playwright specs against preview deploys" — the
  manual-trigger button + admin page must be exercised against the
  preview alias before merge; cron testing is via Inngest dev server
  locally
- `CLAUDE.md` § "npm ci lockfile must stay in sync" — no new
  dependencies expected this phase; if planner adds any (unlikely),
  use the linux/amd64 Docker regen recipe
- `~/.claude/weknow-brand-guidelines.md` — brand voice + token rules
  for the new email template

### Auto-memory
- `.claude/projects/-Users-vedant-Work-WeKnowGroup-wkg-kiosk-tool/memory/data_model_locations_kiosks.md` —
  one location per hotel, kiosks per location via `kiosk_assignments`,
  `outlet_code` is per-kiosk (informs D-05)
- `.claude/projects/.../no_manual_sql_for_ops.md` — operator surfaces
  must be admin UI features, not scripts (informs D-21 / D-22 admin
  page + run-now button shape)
- `.claude/projects/.../email_provider_decision.md` — Resend primary;
  Brevo fallback documented only

### Superseded by this phase
- `.planning/research/v1.1-notifications-model.md` — NOTIF-01/02
  research; **superseded** by D-01 scope cut. Kept for historical
  reference only; do NOT use as a design source.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 8 email substrate** — `src/inngest/functions/send-email.ts`'s
  3-step pattern (render-html / resend-send / log) is reused as-is. New
  template registers in the `TEMPLATES` dispatch table; new
  `EmailKind`/`EmailTemplate` union entries in `src/inngest/events.ts`
- **Outlet tier math** — `src/lib/analytics/thresholds-server.ts`
  exposes the percentile-cutoff reader used by the portfolio page. The
  cron job calls this same function; D-03 explicitly forbids
  reimplementing tier math
- **`appSettings` thresholds editor pattern** — Phase 6 plan 06-05
  established the pattern (admin UI → appSettings row → cached server
  reader → analytics consumer). The new `underperformance_window_days`
  row follows this exact pattern
- **`email_log` partial unique idx** — Phase 8 migration 0041 ships
  `(kind, payload_hash) WHERE payload_hash IS NOT NULL`. D-17 idempotency
  rides this index — no schema change needed for `email_log`
- **`react-email` + brand tokens** — `src/emails/brand.ts` + the
  `password-changed.tsx` + `text-versions.ts` shape; the new
  `poc-underperformance.tsx` template clones this scaffold
- **Admin-only RBAC gate** — `src/lib/rbac.ts` pattern; D-21 admin page
  + D-19 silencing UI + D-22 "Run now" all use it

### Established Patterns
- **No bespoke queue / cron tables** (locked v1.1 scoping) — all async +
  scheduled work runs through Inngest; no `vercel.json` cron entries.
  This phase honours that — the weekly trigger is an Inngest schedule
- **Application-layer audit substrate** — every send writes `email_log`;
  state mutations write `audit_logs`. The "Run now" admin button writes
  an `audit_logs` row with `entity_type='performance_alert_run'` and
  actor info (planner picks exact shape)
- **Phase branching** — `gsd/phase-09-poc-underperformance-alerts` per
  `git.branching_strategy: "phase"`. Plans commit to this branch with
  summary commits per plan + a phase-completion commit before merge
- **Pipeline-stage resolution** — pipeline-stage names are admin-
  renameable. Code that depends on a specific stage MUST resolve via
  UUID or denormalised flag, not name match (informs D-09)
- **Playwright as first UAT layer** — admin page + silencing UI must be
  exercised against the preview alias; cron testing is local via
  Inngest dev server

### Integration Points
- **DB schema** — new table `kiosk_performance_alert_state`; new columns
  on `kiosks` (`alert_silenced_at`, `alert_silenced_reason`); new
  appSettings seed row(s). Single drizzle migration `0042_…`
- **Vercel env vars** — no new env vars (RESEND_API_KEY + INNGEST_*
  already wired in Phase 8). The cron just runs in the existing Inngest
  app
- **Inngest mount point** — already at `src/app/api/inngest/route.ts`;
  this phase adds two functions to the `serve({ functions: [...] })`
  list (the cron + the manual-trigger event handler — possibly the same
  function with two triggers)
- **Admin route** — new `src/app/(app)/admin/performance-alerts/page.tsx`
  + `actions.ts` for the "Run now" server action
- **Kiosks detail / admin UI** — silencing UI lands per D-20 (planner
  picks exact placement)

</code_context>

<specifics>
## Specific Ideas

- **"Bottom-tier alert" — not "general kiosk-status alert"** — the user
  was explicit at rescope time: the only notification that delivers
  value is "your kiosk is underperforming, here's the data". General
  status-change emails were judged to be infrastructure without
  validated demand
- **`kiosks.internal_poc_id` is the routing primitive** — already exists
  on the schema since Phase 1; this phase is the first feature to use
  it for outbound communication
- **Reuse, don't reimplement, the outlet-tier math** — the existing
  percentile cutoffs are admin-tunable via the thresholds editor; the
  cron must call the same reader (`thresholds-server.ts`) and the same
  classification function the portfolio page uses
- **Per-POC batching** — one POC, one email per run, listing all of
  their bottom-tier kiosks for that run. NOT one email per kiosk. NOT
  one email per location. Specifically per-POC

</specifics>

<deferred>
## Deferred Ideas

- **NOTIF-01 (per-user kiosk-status / pipeline-stage emails)** —
  DROPPED from v1.1, no v2 carry per user 2026-05-09. If broader
  notifications become valuable, the case is re-opened from scratch
  (not as a v2 backlog item)
- **NOTIF-02 (admin offline alerts)** — DROPPED from v1.1, no v2 carry.
  The phase 9 POC alert covers underperformance which subsumes "kiosk
  has stopped trading" indirectly (zero-sales kiosks land in bottom
  tier). Explicit "this kiosk is offline" alerts are not built
- **REPORT-05 (scheduled fleet-health digests)** — DROPPED from v1.1,
  no v2 carry. The POC alert is the sole scheduled email leaving the
  app
- **REPORT-06 (custom report templates)** — DROPPED from v1.1, no v2
  carry. Admin-authorable digest content is not built
- **In-app notification bell** — was deferred to v1.2 under the
  original phase 9; with the rescope, the bell has nothing to display
  and is no longer tracked
- **`/account/notifications` page** — not built. There is no per-user
  preference surface in v1.1 since the alert is operational and
  silenced at the kiosk level by an admin
- **email_log admin UI** — Phase 11 polish if operators ask. For v1.1,
  the `/admin/performance-alerts` page (D-21) covers the operationally-
  important metadata; full email_log query is via DB / Resend dashboard
- **Per-user POC opt-out** — explicitly chosen against in D-18. Could
  be reconsidered if a POC's inbox volume becomes a real complaint
- **Location-level tier aggregation** — D-05 picked per-kiosk. Could be
  added later as a separate tier surface if ops want a "this hotel as
  a whole is underperforming" view

</deferred>

---

*Phase: 09-poc-underperformance-alerts*
*Context gathered: 2026-05-09*
