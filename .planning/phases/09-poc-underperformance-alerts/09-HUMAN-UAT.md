---
status: partial
phase: 09-poc-underperformance-alerts
preview_alias: https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app
preview_deploy: https://wkg-command-centre-ksbm50dcs-vedant-kalbag-wkgs-projects.vercel.app
preview_db_host: ep-soft-breeze-abhk62iq.eu-west-2.aws.neon.tech
started: "2026-05-09T13:10:00Z"
updated: "2026-05-09T13:35:00Z"
---

# Phase 9: Human UAT Punch List

All 15 code-verifiable must-haves are VERIFIED. The items below require operator action against a live preview deploy before the phase can be considered fully accepted.

## Pre-conditions (must be done in order)

1. **Push branch to origin** — done at 2026-05-09 13:10 UTC.
   ```bash
   git push origin gsd/phase-09-poc-underperformance-alerts
   ```
   result: passed — `git ls-remote origin gsd/phase-09-poc-underperformance-alerts` returns `ec7a279…`, matches local HEAD.

2. **Wait for Vercel preview deploy** — done at 2026-05-09 13:11 UTC. Initial deploy `j3xo5vin6` returned HTTP 500 because branch-scoped env vars not set yet. Resolved by step 3 below + redeploy `ksbm50dcs` (Ready 13:15 UTC).
   result: passed — final preview deploy reports `Ready`; alias `…git-gsd-p-01eb46…` curl `-I` → `HTTP/2 307` (root redirect to /login) and `/login` → `HTTP/2 200`.

3. **Set BETTER_AUTH_URL to git-branch alias** + redeploy
   ```bash
   echo "https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app" | \
     vercel env add BETTER_AUTH_URL preview gsd/phase-09-poc-underperformance-alerts
   # also added DATABASE_URL + BETTER_AUTH_SECRET scoped to the same branch
   vercel redeploy https://wkg-command-centre-j3xo5vin6-vedant-kalbag-wkgs-projects.vercel.app
   ```
   result: passed — `vercel env ls preview gsd/phase-09-poc-underperformance-alerts` lists `BETTER_AUTH_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET` (added 2026-05-09 13:14 UTC). Generic `RESEND_API_KEY`, `EMAIL_FROM`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` are inherited from project-wide Preview scope.

4. **Apply migrations to preview DB**
   ```bash
   psql "$DATABASE_URL_PREVIEW" -v ON_ERROR_STOP=1 -f migrations/0042_phase_08_email_log_status_check.sql
   psql "$DATABASE_URL_PREVIEW" -v ON_ERROR_STOP=1 -f migrations/0043_phase_09_poc_alert_state.sql
   psql "$DATABASE_URL_PREVIEW" -v ON_ERROR_STOP=1 -f migrations/0044_phase_09_email_log_skipped_status.sql
   ```
   `drizzle-kit migrate` skipped in favour of direct SQL apply (same pattern as Phase 8 — Phase-07-era schema drift causes drizzle-kit push to abort).
   result: passed — verifications:
   - `kiosk_performance_alert_state` table exists ✓ (columns: kiosk_id, tier, classified_at, last_run_at, last_alerted_at)
   - `kiosks.alert_silenced_at` column exists ✓
   - `email_log_status_check` clause: `(status = ANY (ARRAY['queued','sent','failed','skipped']))` ✓
   - `app_settings`: `pipeline_stage_id_live` = `c2cebb12-9b1b-4438-a7d8-a4bcc2ee2c5f` (matches `pipeline_stages.Live`); `underperformance_window_days` = `30` ✓

## Playwright Specs (automated first layer)

5. **Run performance-alerts.spec.ts**
   ```bash
   PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app \
     npx playwright test tests/admin/performance-alerts.spec.ts
   ```
   result: passed — 1 test, 15.0s. The spec exercises admin login → `/admin/performance-alerts` → click `Run now` → assert success toast → second click within 5 min → rate-limit toast.

6. **Run silence.spec.ts**
   ```bash
   PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-p-01eb46-vedant-kalbag-wkgs-projects.vercel.app \
     npx playwright test tests/kiosks/silence.spec.ts
   ```
   result: passed (after one-line test fix) — 5/5 passing, 42.6s.
   - The first test originally used `getByRole("heading", { name: /alert silencing/i })`. shadcn/ui `CardTitle` renders as `<div>` (no `role="heading"`), so the assertion never resolved even though the panel was visible — confirmed by the other 4 tests passing against the same panel via the button role. Fixed in this commit by switching to `getByText(/alert silencing \(admin only\)/i)` to match the literal rendered text. Subsequent tests in the file already use the correct `getByRole("button", …)` pattern.

## Manual Visual UAT (driven via playwright-cli)

7. **Admin performance-alerts dashboard** — `/admin/performance-alerts` rendered after admin login.
   evidence: `.planning/phases/09-poc-underperformance-alerts/uat-artifacts/uat-perf-alerts-dashboard.png`, `…/uat-perf-alerts-rate-limit-toast.png`
   - [x] 6 stat cards visible: Last run, Classified, Bottom tier, Emails sent (24h), Skipped — no POC (24h), Silenced kiosks
   - [x] "Run now" button present
   - [x] Click "Run now" → success toast "Run queued — refresh in ~30 seconds" (verified by Playwright spec; recent_runs list updated at 13:21:47 UTC after manual trigger from spec)
   - [x] Click again within 5 min → rate-limit toast "Already queued — wait ~2 more minutes" (captured live via playwright-cli at 13:25 UTC)
   - [x] Recent runs section updates after the run completes — list shows `Run 2026-W19 — Vedant Kalbag` (13:21:48 UTC) and `Manual run trigger — Vedant Kalbag` (13:21:47 UTC)

8. **Kiosk silencing panel (admin)** — `/kiosks/2c9a7975-326e-414d-9d98-35d9ee3cd3be` after admin login.
   evidence: `.planning/phases/09-poc-underperformance-alerts/uat-artifacts/uat-kiosk-silenced-state.png`
   - [x] "Alert silencing (admin only)" card visible below the kiosk form
   - [x] Enter reason text "UAT 2026-05-09 visual run" (>= 3 chars), click "Silence alerts" → toast "Kiosk alerts silenced", card flips to silenced state showing `Alerts are currently silenced` + the captured reason
   - [x] Click "Unsilence alerts" → card reverts to silence form (button disabled because reason input is empty again)
   - [x] Both actions produce `audit_logs` rows (verified via DB: `SELECT entity_type, COUNT(*) FROM audit_logs WHERE created_at > now() - interval '20 minutes'` → `kiosk` = 10 rows; includes the silence + unsilence actions performed during this UAT and during the silence.spec.ts run).

9. **Non-admin cannot see silencing panel** — code-verified in `src/app/(app)/kiosks/[id]/page.tsx`:
   ```tsx
   {session.user.role === "admin" && (
     <KioskAdminPanel … />
   )}
   ```
   The panel is conditionally rendered server-side; non-admin sessions never receive the markup. UI sign-in as a non-admin was not exercised because the only non-admin in the preview DB (`vedant.kumar@weknowgroup.com`, role=`viewer`, `email_verified=false`) does not have a known credential, and creating one for UAT would be a destructive write against a real account row. The server-side gate is a hard block.
   result: passed (code-verified).

## End-to-End Inngest Flow

10. **Trigger cron function via Inngest dev UI / Run-now button**

    - Manual trigger fired by Playwright spec at 13:21:47 UTC.
    - DB state after trigger:
      - `audit_logs`: 2 rows with `entity_type='performance_alert_run'` (`manual-1778332907041` at 13:21:47, `01KR6EDDNJ9DA9BG0WQ9V6NVQ0` at 13:21:48) ✓
      - `email_log` for `kind='underperforming_poc'`: **0 rows** (preview DB has 0 kiosks at `pipeline_stage_id = Live`; all 392 kiosks have NULL `pipeline_stage_id`)
      - `kiosk_performance_alert_state`: **0 rows** (no Live kiosks means classifier produced 0 classifications)
    - Idempotency check (second run for same ISO week → no duplicate emails): not exercised, because no emails were dispatched in the first run.
    result: **partial — code paths execute (cron audit row written, classifier ran), but the dispatch + email-send paths cannot be exercised against this preview DB**. The fixture has 392 kiosks all with NULL `pipeline_stage_id`, so the `WHERE pipeline_stage_id = $live` filter matches 0 rows.
    follow-up for full E2E validation: either (a) seed the preview DB with at least one kiosk at `pipeline_stage_id = Live` + linked transactions covering the trailing 30 days + a test POC with a non-NULL `internal_poc_id` and exercise the alert path against it, or (b) defer this verification to the next deploy that ships against a Neon DB with realistic Live-stage fixture data (the dev DATABASE_URL fixture used during 09-01 execution did satisfy this — see 09-01-SUMMARY.md). The phase-9 unit tests + Playwright spec cover the dispatch logic deterministically; the gap here is integration-level evidence in this specific Vercel preview, not a code defect.

## Sign-off

- 5 of 6 manual / E2E items closed against the preview deploy.
- 1 item (#10 Inngest E2E email-send) closed only at the audit-log level; full email-send path needs a preview DB with Live-stage fixture data (or a manual post-merge validation against the prod DB after the next cron firing on Mondays 09:00 Europe/London — first such firing 2026-05-11).
- Test-side fix in `tests/kiosks/silence.spec.ts` to align with shadcn `CardTitle` semantics is committed alongside this UAT artifact set.

## Summary

total: 10
passed: 9
partial: 1 (#10 — see above)
issues-introduced: 0
test-fix-applied: 1 (silence.spec.ts heading lookup)

## Artifacts

- `.planning/phases/09-poc-underperformance-alerts/uat-artifacts/uat-perf-alerts-dashboard.png`
- `.planning/phases/09-poc-underperformance-alerts/uat-artifacts/uat-perf-alerts-rate-limit-toast.png`
- `.planning/phases/09-poc-underperformance-alerts/uat-artifacts/uat-kiosk-silenced-state.png`
