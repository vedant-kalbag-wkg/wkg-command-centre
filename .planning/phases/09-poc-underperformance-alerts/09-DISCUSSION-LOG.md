# Phase 9: POC Underperformance Alerts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 09-poc-underperformance-alerts
**Areas discussed:** scope rescope, underperformance definition, schedule cadence, granularity, POC routing, frequency cap, classification window, email content, opt-out / silencing, admin visibility, eligibility filter, weekly run timing, phase rename, REQUIREMENTS.md handling

---

## Scope rescope

| Option | Description | Selected |
|--------|-------------|----------|
| Replace phase 9 (this scope only) | Drop NOTIF-01/02 + REPORT-05/06 entirely; phase 9 becomes a single deliverable: "email kiosk POC when their kiosk's location is flagged underperforming". | ✓ |
| Skip phase 9 in v1.1, add separate underperforming-POC requirement | Defer NOTIF-01/02 + REPORT-05/06 to v1.2; v1.1 ships email substrate (Phase 8) + Auth (Phase 10) + Polish (Phase 11) only. Add a small new requirement under polish or a new mini-phase. | |
| Cancel rescope — keep original phase 9 | Keep NOTIF-01/02 + REPORT-05/06 as scoped. POC alert lives as one of the NOTIF-01 trigger types. | |

**User's choice:** Replace phase 9 (this scope only)
**Notes:** User opened the discussion by stating "skip this entire phase. The only notification I want to be sent is to the internal POC based on underperforming locations identified in the analysis" — pivoting away from the broader notification apparatus.

---

## Underperformance definition

| Option | Description | Selected |
|--------|-------------|----------|
| Outlet tier = 'bottom' | Use the existing percentile-based outlet-tier classification (thresholds in appSettings, admin-tunable). Reuses Phase 6 / portfolio infra; no new threshold surface. | ✓ |
| Heat-map 'cold' classification | Use the heat-map cold/warm/hot classification instead. Different math (geo / time-based). | |
| Low-performer-patterns flag | Use whatever drives the low-performer-patterns widget (pattern-based: declining trend, plateau, etc.). | |
| TBD — talk through it | Don't commit yet. | |

**User's choice:** Outlet tier = 'bottom'
**Notes:** Cleanest reuse — outlet tiers already have admin-tunable cutoffs in appSettings via the existing thresholds editor (Phase 6 plan 06-05).

---

## Schedule cadence (initial)

| Option | Description | Selected |
|--------|-------------|----------|
| Weekly Inngest schedule | Inngest cron runs once a week, recomputes outlet tiers, emails each affected POC. Idempotency via payloadHash. | ✓ |
| On classification change | Event-driven: only email when a kiosk's classification flips INTO underperforming. Requires storing prior classification per kiosk. | |
| Admin-triggered manual run | No schedule; admin clicks a "send POC alerts now" button. Lower automation. | |
| TBD — talk through it | Don't commit yet. | |

**User's choice:** Weekly Inngest schedule
**Notes:** Combined later with the flip-in + monthly cadence cap (see Frequency cap below).

---

## Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per kiosk (outlet code) | Each kiosk classified independently. POC alerted per kiosk. Caveat: a hotel with 3 bottom-tier kiosks could generate 3 alerts to the same POC. | |
| Per location (aggregated) | Sum kiosk sales up to location, re-classify location into top/mid/bottom. New aggregation logic; cleaner UX but a "location tier" isn't surfaced today. | |
| Per kiosk, batched per POC | Classify per kiosk (no aggregation change); email batches all of a POC's bottom-tier kiosks into one email. Reuses tier math; reduces inbox spam. | ✓ |

**User's choice:** Per kiosk, batched per POC
**Notes:** Avoids reimplementing tier math (D-03 picked the existing per-outlet-code classifier) while solving the inbox-spam case.

---

## POC routing

| Option | Description | Selected |
|--------|-------------|----------|
| `kiosks.internal_poc_id` only — skip if NULL | Email only the explicitly-assigned POC. NULL → log skip in email_log + surface in admin UI. | ✓ |
| `kiosks.internal_poc_id`, fallback to location's other kiosk POCs | Reduces silent-skip risk; adds a join + dedupe. | |
| `kiosks.internal_poc_id`, fallback to admin | NULL POC → route to all admin users. Less risk of unflagged underperformance. | |

**User's choice:** kiosks.internal_poc_id only — skip if NULL
**Notes:** Strict ownership. NULL-POC kiosks become an operational visibility item via the admin page (skip count surfaced).

---

## Frequency cap (anti-spam)

| Option | Description | Selected |
|--------|-------------|----------|
| Every week while bottom-tier | One email per week per bottom-tier kiosk for as long as it stays bottom. Pro: front-of-mind. Con: chronic underperformers nag indefinitely. | |
| Only on flip into bottom | Email only when classification flips non-bottom → bottom. Requires prior-classification storage. | |
| On flip-in, then monthly while bottom | Immediate email on flip-in; thereafter once a month. Compromise. Needs prior-classification AND last_alerted_at storage. | ✓ |

**User's choice:** On flip-in, then monthly while bottom
**Notes:** Drives the new `kiosk_performance_alert_state` table — see D-11 in CONTEXT.md.

---

## Classification window

| Option | Description | Selected |
|--------|-------------|----------|
| Trailing 30 days | Each weekly run classifies on prior 30 days. Smooths noise; sustained dips take ~3 weeks to surface. | |
| Trailing 90 days | Quarter-on-quarter. Very stable; flip-ins lag real issues by weeks. | |
| Calendar month (last completed) | Run on 1st-Monday-after-month-end; classify on closed month. Aligns with internal reporting. Caveat: 3 of 4 weekly runs are no-ops. | |
| Admin-configurable in appSettings | New `appSettings.underperformance_window_days` (default 30). One more knob; matches the thresholds-editor pattern. | ✓ |

**User's choice:** Admin-configurable in appSettings
**Notes:** Fits the established Phase 6 thresholds-editor pattern. Default 30 days.

---

## Email content + deep links

| Option | Description | Selected |
|--------|-------------|----------|
| Bare list + outlet-tiers page link | Each row: kiosk_id, location, region. One CTA → /analytics/portfolio. No metric numbers. Lowest engineering surface. | |
| List + per-kiosk metric + deep link to each kiosk | Each row: kiosk_id, location, region, total sales, percentile rank. Per-row "View kiosk →" link. Footer link to /analytics/portfolio. | ✓ |
| Summary + 'why flagged' sentence + portfolio link | Brief summary, then row list (kiosk_id + location only), then portfolio CTA. Splits the difference. | |

**User's choice:** List + per-kiosk metric + deep link to each kiosk
**Notes:** POC needs the data inline to make a decision without context-switching to the dashboard.

---

## Opt-out / silencing controls

| Option | Description | Selected |
|--------|-------------|----------|
| Implicit, no opt-out | Every POC always gets the alert. Treated as operational SLA, not a notification preference. | |
| Per-user opt-out on /account/notifications | POC can disable alerts for themselves. Adds notification_preferences row + UI toggle. | |
| Admin per-kiosk silence (with reason) | Admin marks kiosk as "expected-low-volume"; excluded from alerts. New columns on kiosks. Useful for known small hotels. | ✓ |
| Both per-user opt-out AND admin per-kiosk silence | Both controls. Most flexible; biggest UI surface. | |

**User's choice:** Admin per-kiosk silence (with reason)
**Notes:** No per-user opt-out — operational alert. Silencing is an admin judgment call about specific kiosks (e.g. structurally low-volume hotels).

---

## Admin visibility

| Option | Description | Selected |
|--------|-------------|----------|
| email_log query only — no UI this phase | Defer admin UI to Phase 11 polish. Lowest engineering cost. | |
| Read-only admin page listing last run | New /admin/performance-alerts shows last run metadata. No write actions. | |
| Read-only page + manual 'run now' button | Above + admin-only manual trigger. Useful for testing + after threshold edits. | ✓ |

**User's choice:** Read-only page + manual 'run now' button
**Notes:** Manual trigger is a real operational need — admins tune thresholds and want to see the effect without waiting for Monday.

---

## Eligibility filter

| Option | Description | Selected |
|--------|-------------|----------|
| Only pipeline_stage = 'Live' | Pre-launch / On Hold / Decommissioned / Offline all skipped. Excludes archived. Excludes kiosks with no outlet_code. | ✓ |
| Live + Offline (alert on both) | Include Offline because zero-sales → trivially bottom. Risk: redundant with the dropped NOTIF-02 work. | |
| All stages except archived + decommissioned | Broader net. Pre-launch kiosks would also classify (probably zero sales → bottom → noisy alerts). | |

**User's choice:** Only pipeline_stage = 'Live'
**Notes:** Bottom-tier classification is only meaningful for trading kiosks. Resolving "Live" against admin-renameable stages is a planner-side detail captured in D-09.

---

## Weekly run timing

| Option | Description | Selected |
|--------|-------------|----------|
| Mondays 09:00 Europe/London | Cron `0 9 * * 1`. Lands at start of week, ready for planning. | ✓ |
| Mondays 07:00 Europe/London | Earlier; arrives before standup. | |
| Fridays 16:00 Europe/London | End-of-week summary feel. Risk: lands as POCs check out for weekend. | |
| TBD — default to Mondays 09:00 Europe/London | Don't decide; planner uses default. | |

**User's choice:** Mondays 09:00 Europe/London
**Notes:** TZ=Europe/London cron syntax handles DST correctly per Inngest semantics.

---

## Phase rename

| Option | Description | Selected |
|--------|-------------|----------|
| Rename to 'POC Underperformance Alerts' | Phase + branch updated. Cleaner mapping to actual work. | ✓ |
| Keep 'Notifications & Scheduled Reports' name + branch | Don't rename; just narrow scope. Phase name no longer accurate. | |
| Rename phase only, keep branch as-is | STATE.md updated; branch stays. | |

**User's choice:** Rename to 'POC Underperformance Alerts'
**Notes:** Branch was never created (only listed in STATE.md as a placeholder), so the rename has no git-side cost.

---

## REQUIREMENTS.md handling for dropped requirements

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to v2.0 (mark in REQUIREMENTS.md) | Strike NOTIF-01/02 + REPORT-05/06; note "Deferred to v2.0 — superseded by phase 9 POC alert". | |
| Drop entirely from v1.1 (no v2.0 carry) | Remove from REQUIREMENTS.md. Don't carry to v2.0 either. POC-ALERT-01 takes their place. | ✓ |
| Defer with explicit re-evaluation trigger | Defer to v2.0 with note "reconsider once X is shipped". | |

**User's choice:** Drop entirely from v1.1 (no v2.0 carry)
**Notes:** User judged the broader notification work was infrastructure without validated demand. If reopened later, it's a fresh case, not a v2 backlog item.

---

## Claude's Discretion

- Email subject + exact body copy + plain-text branch — frame within `~/.claude/weknow-brand-guidelines.md`
- Whether percentile rank renders as a number, bar, or word ("bottom 12%")
- Exact `appSettings` value type for the window (text-encoded number vs. numeric column)
- Manual-trigger event name + dedupe approach for the "Run now" button (Inngest dedupe key vs. server-side rate limit)
- Whether silencing UI lives on kiosk detail page, admin panel, or both
- Strategy for resolving "Live" pipeline stage (D-09) — UUID-pin appSettings vs. seeded-position fallback vs. denormalised flag on `pipeline_stages`
- Inngest function file layout (likely `src/inngest/functions/weekly-poc-alerts.ts`)
- Whether to introduce a `performance_alert_runs` summary table or compute admin-page metrics on-the-fly

## Deferred Ideas

- NOTIF-01 (per-user kiosk-status emails) — DROPPED, no v2 carry
- NOTIF-02 (admin offline alerts) — DROPPED, no v2 carry
- REPORT-05 (scheduled fleet-health digests) — DROPPED, no v2 carry
- REPORT-06 (custom report templates) — DROPPED, no v2 carry
- In-app notification bell — no longer tracked
- `/account/notifications` page — not built (no per-user prefs in v1.1)
- email_log admin UI — Phase 11 polish if operators ask
- Per-user POC opt-out — explicitly chosen against
- Location-level tier aggregation — could revisit later
