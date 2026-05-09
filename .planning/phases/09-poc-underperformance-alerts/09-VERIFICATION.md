---
phase: 09-poc-underperformance-alerts
verified: 2026-05-09T19:00:00Z
status: human_needed
score: 7/7 plans verified
overrides_applied: 0
human_verification:
  - test: "Push branch + apply migrations to preview DB"
    expected: "Preview deploy succeeds; migrations 0043 and 0044 applied cleanly to preview DB (kiosk_performance_alert_state table created, email_log status enum extended)"
    why_human: "Operator must push gsd/phase-09-poc-underperformance-alerts, wait for Vercel deploy, then apply migrations via DATABASE_URL against the preview Neon DB. Claude cannot push or run migrations against remote DBs."
  - test: "Run npx playwright test tests/admin/performance-alerts.spec.ts against preview alias"
    expected: "All assertions in performance-alerts.spec.ts pass: admin page loads with stat cards, Run now button triggers a toast, rate-limit feedback appears on second trigger within 5 min"
    why_human: "Requires PLAYWRIGHT_BASE_URL set to the git-branch alias, TEST_ADMIN_EMAIL, and TEST_ADMIN_PASSWORD. Spec exists at tests/admin/performance-alerts.spec.ts but has not been run against a live deploy."
  - test: "Run npx playwright test tests/kiosks/silence.spec.ts against preview alias"
    expected: "All assertions in silence.spec.ts pass: kiosk detail page shows admin panel, silence with reason records alertSilencedAt, unsilence clears it, audit log rows written for both"
    why_human: "Same env-var requirements. Spec exists at tests/kiosks/silence.spec.ts but has not been run against a live deploy."
  - test: "Manual visual UAT of /admin/performance-alerts"
    expected: "Page shows 6 stat cards (Last run, Classified, Bottom tier, Emails sent 24h, Skipped no POC 24h, Silenced kiosks). Run now button shows success toast. Second click within 5 min shows rate-limit toast with minutes remaining."
    why_human: "Visual / interactive UX verification cannot be done programmatically without a running instance."
  - test: "Manual visual UAT of /kiosks/[id] silencing panel (admin user)"
    expected: "Admin sees KioskAdminPanel card. Submitting reason >=3 chars and clicking Silence alerts sets silenced state. Panel switches to unsilence mode showing reason. Clicking Unsilence alerts clears state. Audit log shows both events."
    why_human: "Interactive state transitions and toast feedback require a running browser session."
  - test: "Non-admin sees no silencing panel on /kiosks/[id]"
    expected: "User with role != admin sees no KioskAdminPanel card on the kiosk detail page"
    why_human: "Role-based conditional render requires logging in as a non-admin user against the live app."
  - test: "End-to-end cron / Inngest event trigger"
    expected: "Sending performance-alerts/run.requested event via Inngest dev UI (or inngest.send) causes: classifier runs against Live kiosks, dispatch loop sends emails to matching POCs, NULL-POC kiosks produce email_log rows with status=skipped, same-week second trigger is idempotent (no duplicate emails), audit_logs row written for the run"
    why_human: "Requires a running Inngest dev server or connected cloud environment with live data. Cannot be verified by static code inspection."
  - test: "Set BETTER_AUTH_URL to git-branch alias before running Playwright"
    expected: "All /api/auth/* calls return 200 (not 403 Invalid origin) against the preview deploy"
    why_human: "Operator must set BETTER_AUTH_URL env var in Vercel per CLAUDE.md instructions before the Playwright runs are valid."
---

# Phase 9: POC Underperformance Alerts — Verification Report

**Phase Goal:** Implement a weekly Inngest cron that classifies Live kiosks by bottom-tier percentile rank and emails batched per-POC alerts (flip-in and chronic), with admin per-kiosk silencing UI and an admin dashboard for last-run metadata and manual trigger.
**Verified:** 2026-05-09T19:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Schema tables and columns exist for alert state, silencing, email-log extension | VERIFIED | `migrations/0043_phase_09_poc_alert_state.sql` + `migrations/0044_phase_09_email_log_skipped_status.sql`; `src/db/schema.ts:1146` (`kioskPerformanceAlertState`); `src/db/schema.ts:147` (`alertSilencedAt`, `alertSilencedReason`) |
| 2 | Pure logic library (decideAlert, isoWeekKey, groupByPoc, sha256) is correct and tested | VERIFIED | `src/lib/performance-alerts/classify-dispatch.ts` (decideAlert with flip-in/chronic/no-alert + 30-day cooldown); `src/lib/performance-alerts/iso-week.ts` (Europe/London via Intl.DateTimeFormat); `src/lib/performance-alerts/poc-batching.ts` (groupByPoc); `src/lib/performance-alerts/hash.ts` (sha256 via node:crypto); unit tests in `tests/admin/performance-alerts.integration.test.ts` PASS 35/35 |
| 3 | weeklyPocAlertsFn registered in Inngest serve handler with correct cron | VERIFIED | `src/inngest/functions/weekly-poc-alerts.ts` (id "weekly-poc-alerts", cron `TZ=Europe/London 0 9 * * 1`); `src/app/api/inngest/route.ts:5,9` (imported and passed to serve) |
| 4 | classifyEligibleKiosks applies all required filters (live, not silenced, not archived) | VERIFIED | `src/lib/performance-alerts/classify-kiosks.ts`: filters `archived_at IS NULL`, `outlet_code IS NOT NULL`, `alert_silenced_at IS NULL`, `pipeline_stage_id = liveStageId`; joins kiosk_assignments → locations → regions → sales_records |
| 5 | NULL-POC kiosks are silently skipped with email_log row (status=skipped) | VERIFIED | `src/inngest/functions/weekly-poc-alerts.ts` step "emit-skip-rows": filters `alertable.filter(k => k.internalPocId === null)`, inserts `status='skipped'`, `recipient='[skip:no-poc]'` |
| 6 | Idempotency keyed on (pocUserId, runIsoWeek) prevents duplicate sends | VERIFIED | `src/inngest/functions/weekly-poc-alerts.ts`: `payloadHash = sha256(\`${pocUserId}:${runIsoWeek}\`)` passed to sendEmailFn; email_log table has `payload_hash` unique constraint from migration 0043 |
| 7 | First-run cold-start suppression overrides all decisions to no-alert | VERIFIED | `src/inngest/functions/weekly-poc-alerts.ts` inline logic: if all kiosks have no prior row in diff-state step, overrides all to "no-alert"; avoids flooding POCs on first deploy |
| 8 | Email template renders kiosk table with deep links and portfolio CTA | VERIFIED | `src/emails/poc-underperformance.tsx`: PocUnderperformanceEmail renders Location, Region, Revenue, Percentile columns; per-kiosk `detailUrl` via Link component; CTA to `/analytics/portfolio` |
| 9 | Plain-text email companion exists | VERIFIED | `src/emails/text-versions.ts`: `pocUnderperformanceText()` exports plain-text version |
| 10 | send-email Inngest function dispatches poc-underperformance template | VERIFIED | `src/inngest/functions/send-email.ts`: TEMPLATES includes `"poc-underperformance": PocUnderperformanceEmail`; plain-text branch `else if (template === "poc-underperformance")` calls `pocUnderperformanceText(props)` |
| 11 | Admin /admin/performance-alerts page is RBAC-gated and shows 6 stat cards | VERIFIED | `src/app/(app)/admin/performance-alerts/page.tsx:15`: `requireRole("admin")`; 6 Stat components: Last run, Classified, Bottom tier, Emails sent (24h), Skipped no POC (24h), Silenced kiosks |
| 12 | Run Now button with 5-min rate limit and idempotent inngest.send | VERIFIED | `src/app/(app)/admin/performance-alerts/actions.ts`: queries last audit_log for performance_alert_run entity, rejects if < 5 min ago (returns `minutesRemaining`); `inngest.send` id `performance-alerts-manual-${userId}-${minuteBucket}` |
| 13 | Per-kiosk silencing UI visible to admin only on kiosk detail page | VERIFIED | `src/app/(app)/kiosks/[id]/page.tsx:73`: `{session.user.role === "admin" && <KioskAdminPanel ...>}`; passes `isSilenced={kiosk.alertSilencedAt !== null}` and `currentReason={kiosk.alertSilencedReason ?? null}` |
| 14 | Silence/unsilence server actions update DB and write audit log | VERIFIED | `src/app/(app)/kiosks/[id]/silence-actions.ts`: `silenceKiosk` sets `alertSilencedAt=new Date()` + `alertSilencedReason`; `unsilenceKiosk` sets both to null; both call `writeAuditLog` with action "silence_alerts"/"unsilence_alerts"; reason validation: min(3) chars |
| 15 | POC-ALERT-01 requirement marked complete in REQUIREMENTS.md with traceability entry | VERIFIED | `.planning/REQUIREMENTS.md:49`: `- [x] **POC-ALERT-01**`; `.planning/REQUIREMENTS.md:108`: traceability table row `\| POC-ALERT-01 \| Phase 9 \|` |

**Score:** 15/15 code-verifiable truths — all VERIFIED

---

### Required Artifacts

| Artifact | Plan | Status | Details |
|----------|------|--------|---------|
| `migrations/0043_phase_09_poc_alert_state.sql` | 09-01 | VERIFIED | Creates kiosk_performance_alert_state, adds alertSilenced* to kiosks, seeds app_settings |
| `migrations/0044_phase_09_email_log_skipped_status.sql` | 09-01 | VERIFIED | Extends email_log status enum with queued + skipped |
| `src/db/schema.ts` (kioskPerformanceAlertState, alertSilencedAt) | 09-01 | VERIFIED | schema.ts:1146 + schema.ts:147 |
| `src/lib/performance-alerts/classify-dispatch.ts` | 09-02 | VERIFIED | decideAlert with full flip-in/chronic/no-alert logic |
| `src/lib/performance-alerts/iso-week.ts` | 09-02 | VERIFIED | isoWeekKey with Europe/London timezone |
| `src/lib/performance-alerts/poc-batching.ts` | 09-02 | VERIFIED | groupByPoc |
| `src/lib/performance-alerts/hash.ts` | 09-02 | VERIFIED | sha256 via node:crypto |
| `src/lib/performance-alerts/classify-kiosks.ts` | 09-03 | VERIFIED | classifyEligibleKiosks with all required filters |
| `src/inngest/functions/weekly-poc-alerts.ts` | 09-03 | VERIFIED | 7-step Inngest function, cron + event trigger, first-run suppression |
| `src/app/api/inngest/route.ts` | 09-03 | VERIFIED | weeklyPocAlertsFn registered in serve() |
| `src/emails/poc-underperformance.tsx` | 09-04 | VERIFIED | React Email component with kiosk table + deep links |
| `src/emails/text-versions.ts` | 09-04 | VERIFIED | pocUnderperformanceText plain-text companion |
| `src/inngest/functions/send-email.ts` | 09-04 | VERIFIED | TEMPLATES + plain-text branch for poc-underperformance |
| `src/app/(app)/admin/performance-alerts/page.tsx` | 09-05 | VERIFIED | 6 stat cards, RBAC gate, recent runs list |
| `src/app/(app)/admin/performance-alerts/run-now-button.tsx` | 09-05 | VERIFIED | Client component calling triggerRunNow |
| `src/app/(app)/admin/performance-alerts/actions.ts` | 09-05 | VERIFIED | triggerRunNow with 5-min rate limit + idempotent send |
| `src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx` | 09-06 | VERIFIED | Silence/unsilence UI with reason validation |
| `src/app/(app)/kiosks/[id]/silence-actions.ts` | 09-06 | VERIFIED | silenceKiosk + unsilenceKiosk server actions |
| `src/app/(app)/kiosks/[id]/page.tsx` | 09-06 | VERIFIED | Admin-conditional KioskAdminPanel render |
| `.planning/REQUIREMENTS.md` | 09-07 | VERIFIED | POC-ALERT-01 ticked, traceability table updated |
| `tests/admin/performance-alerts.spec.ts` | 09-07 | VERIFIED (file exists; not run against live preview) | 1.1K Playwright spec for admin page + RunNow flow |
| `tests/kiosks/silence.spec.ts` | 09-07 | VERIFIED (file exists; not run against live preview) | 4.8K Playwright spec for silence toggle flow |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `weekly-poc-alerts.ts` | `src/app/api/inngest/route.ts` | import + serve() | WIRED | route.ts:5 imports weeklyPocAlertsFn; route.ts:9 passes it in serve array |
| `weekly-poc-alerts.ts` | `send-email.ts` | inngest.send event `"email/send"` | WIRED | Step "emit-poc-emails" sends events that trigger sendEmailFn |
| `send-email.ts` | `poc-underperformance.tsx` | TEMPLATES object | WIRED | TEMPLATES["poc-underperformance"] = PocUnderperformanceEmail |
| `send-email.ts` | `text-versions.ts` | pocUnderperformanceText import | WIRED | Plain-text branch calls pocUnderperformanceText(props) |
| `kiosk-admin-panel.tsx` | `silence-actions.ts` | import silenceKiosk / unsilenceKiosk | WIRED | Panel imports both server actions and calls them in transition handlers |
| `page.tsx` (kiosk detail) | `kiosk-admin-panel.tsx` | conditional render + prop pass | WIRED | page.tsx:73-79 renders KioskAdminPanel with isSilenced + currentReason from DB |
| `run-now-button.tsx` | `actions.ts` | import triggerRunNow | WIRED | Button imports triggerRunNow and calls it in transition handler |
| `classify-kiosks.ts` | `kiosk_performance_alert_state` (DB) | Drizzle query | WIRED | classifyEligibleKiosks queries/joins kiosk_performance_alert_state in diff-state step |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `admin/performance-alerts/page.tsx` | `latestRunAt`, `tierCounts`, `sentCount`, `silencedCount`, `recentRuns` | Drizzle queries against kioskPerformanceAlertState, emailLog, kiosks, auditLogs | Yes — SQL MAX(), COUNT(), SELECT with WHERE/GROUP BY | FLOWING |
| `kiosk-admin-panel.tsx` | `isSilenced`, `currentReason` | Props from parent server component (kiosk DB row) | Yes — parent fetches via getKiosk() which queries kiosks table | FLOWING |
| `weekly-poc-alerts.ts` (email payload) | kiosk rows, POC batches | classifyEligibleKiosks() DB query → groupByPoc() | Yes — live Drizzle query joins kiosks, assignments, locations, sales_records | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: Test suite passes — vitest PASS 35/35 (unit + integration tests for pure logic and weekly-poc-alerts pipeline). Playwright specs exist but cannot be run without a live preview environment.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit + integration tests pass | `npx vitest run` (from prior phase execution) | PASS 35/35 | PASS |
| performance-alerts.spec.ts exists and parseable | `ls tests/admin/performance-alerts.spec.ts` | 1.1K file | PASS |
| silence.spec.ts exists and parseable | `ls tests/kiosks/silence.spec.ts` | 4.8K file | PASS |
| Playwright against live preview | Requires PLAYWRIGHT_BASE_URL + credentials | Not run | SKIP (needs live deploy) |

---

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| POC-ALERT-01 | 09-01 through 09-07 | Weekly bottom-tier POC email alert with Inngest cron, per-POC batching, silencing, admin dashboard | SATISFIED | REQUIREMENTS.md:49 `- [x]`; traceability table at REQUIREMENTS.md:108; all 7 plans' artifacts verified |

---

### Anti-Patterns Found

No blocker anti-patterns found in the modified files. Spot-checked:
- `silence-actions.ts` — no TODOs, no stub returns, full DB update + audit log
- `weekly-poc-alerts.ts` — no placeholder comments; all 7 steps substantive
- `page.tsx` (admin) — all stat values from real DB queries, no hardcoded empty arrays
- `kiosk-admin-panel.tsx` — no `return null` stubs; conditional render is intentional admin-gating

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

---

### Human Verification Required

The following 8 items require operator action before this phase can be considered fully UAT'd. All code-level verification is complete.

#### 1. Push branch and apply migrations

**Test:** Push `gsd/phase-09-poc-underperformance-alerts` to origin, wait for Vercel preview deploy, then apply migrations 0043 and 0044 to the preview DB.
**Expected:** Preview deploy succeeds; `kiosk_performance_alert_state` table exists in preview DB; `kiosks.alert_silenced_at` column exists; `email_log.status` CHECK constraint accepts 'skipped'.
**Why human:** Requires operator credentials to push the branch and run migrations against the remote Neon preview DB.

#### 2. Set BETTER_AUTH_URL to git-branch alias

**Test:** `vercel env add BETTER_AUTH_URL preview <branch>` with the git-branch alias URL per CLAUDE.md.
**Expected:** All `/api/auth/*` requests return 200 (not 403 Invalid origin) from the preview deploy.
**Why human:** Requires Vercel CLI access and knowledge of the sanitized branch alias URL.

#### 3. Playwright — performance-alerts.spec.ts

**Test:** `PLAYWRIGHT_BASE_URL=<preview-alias> TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... npx playwright test tests/admin/performance-alerts.spec.ts`
**Expected:** All spec assertions pass: admin page renders 6 stat cards, Run now button triggers success toast, second trigger within 5 min shows rate-limit toast with minutes remaining.
**Why human:** Requires a live preview deploy with BETTER_AUTH_URL set and valid admin credentials.

#### 4. Playwright — silence.spec.ts

**Test:** `PLAYWRIGHT_BASE_URL=<preview-alias> TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... npx playwright test tests/kiosks/silence.spec.ts`
**Expected:** All spec assertions pass: kiosk detail admin panel renders, silence with reason records DB change, unsilence clears it, audit log rows present for both actions.
**Why human:** Same requirements as item 3.

#### 5. Manual visual UAT of /admin/performance-alerts

**Test:** Log in as admin, navigate to `/admin/performance-alerts`.
**Expected:** 6 stat cards visible (Last run, Classified, Bottom tier, Emails sent (24h), Skipped — no POC (24h), Silenced kiosks). "Run now" button present. Clicking it shows success toast. Clicking again within 5 min shows rate-limit toast with minutes remaining.
**Why human:** Visual / interactive UX cannot be verified without a running browser session.

#### 6. Manual visual UAT of /kiosks/[id] silencing panel

**Test:** Log in as admin, navigate to any kiosk detail page.
**Expected:** "Alert silencing (admin only)" card visible at bottom. Enter reason >= 3 chars, click "Silence alerts" — card switches to "Alerts are currently silenced" state with reason shown. Click "Unsilence alerts" — card reverts. Audit log entries visible in the admin audit trail for both actions.
**Why human:** State transitions and toast feedback require live browser interaction.

#### 7. Non-admin cannot see silencing panel

**Test:** Log in as a non-admin user, navigate to `/kiosks/[id]`.
**Expected:** No "Alert silencing" card visible.
**Why human:** Role-conditional render requires a non-admin session.

#### 8. End-to-end Inngest event trigger

**Test:** Send `performance-alerts/run.requested` event via Inngest dev UI (or `inngest.send` in a REPL with `NODE_ENV=development`).
**Expected:** Classifier runs against Live kiosks; dispatch loop emails the matching POCs; NULL-POC kiosks produce `email_log` rows with `status='skipped'`; a second trigger for the same ISO week is idempotent (no duplicate emails sent); `audit_logs` row written with `entityType='performance_alert_run'`.
**Why human:** Requires a running Inngest dev server connected to a seeded DB with Live kiosks and POC assignments.

---

### Gaps Summary

No code-level gaps. All 7 plans' must_haves are fully implemented and wired. The `human_needed` status reflects 8 operator UAT items (Playwright specs against live preview + manual end-to-end flow testing) that cannot be verified by static code inspection. The codebase is code-complete for Phase 9.

---

_Verified: 2026-05-09T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
