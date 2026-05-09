# Phase 9: Human UAT Punch List

All 15 code-verifiable must-haves are VERIFIED. The items below require operator action against a live preview deploy before the phase can be considered fully accepted.

## Pre-conditions (must be done in order)

1. **Push branch to origin**
   ```bash
   git push origin gsd/phase-09-poc-underperformance-alerts
   ```

2. **Wait for Vercel preview deploy** — confirm green in Vercel dashboard.

3. **Set BETTER_AUTH_URL to git-branch alias** (required for auth to work in preview)
   ```bash
   echo "https://wkg-command-centre-git-<sanitized-branch>-vedant-kalbag-wkgs-projects.vercel.app" | \
     vercel env add BETTER_AUTH_URL preview gsd/phase-09-poc-underperformance-alerts
   ```
   Redeploy after setting.

4. **Apply migrations to preview DB**
   ```bash
   DATABASE_URL='<preview-db-url>' npx drizzle-kit migrate
   ```
   Confirm:
   - `kiosk_performance_alert_state` table exists
   - `kiosks.alert_silenced_at` column exists
   - `email_log.status` CHECK constraint accepts 'queued' and 'skipped'

## Playwright Specs (automated first layer)

5. **Run performance-alerts.spec.ts**
   ```bash
   PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-<sanitized-branch>-vedant-kalbag-wkgs-projects.vercel.app \
   TEST_ADMIN_EMAIL='vedant.kalbag@weknowgroup.com' \
   TEST_ADMIN_PASSWORD='<admin-password>' \
     npx playwright test tests/admin/performance-alerts.spec.ts
   ```
   Expected: all assertions pass

6. **Run silence.spec.ts**
   ```bash
   PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-<sanitized-branch>-vedant-kalbag-wkgs-projects.vercel.app \
   TEST_ADMIN_EMAIL='vedant.kalbag@weknowgroup.com' \
   TEST_ADMIN_PASSWORD='<admin-password>' \
     npx playwright test tests/kiosks/silence.spec.ts
   ```
   Expected: all assertions pass

## Manual Visual UAT

7. **Admin performance-alerts dashboard** — log in as admin, navigate to `/admin/performance-alerts`

   - [ ] 6 stat cards visible: Last run, Classified, Bottom tier, Emails sent (24h), Skipped — no POC (24h), Silenced kiosks
   - [ ] "Run now" button present
   - [ ] Click "Run now" → success toast "Run queued — refresh in ~30 seconds"
   - [ ] Click again within 5 min → rate-limit toast "Already queued — wait ~X more minutes"
   - [ ] Recent runs section updates after the run completes

8. **Kiosk silencing panel (admin)** — log in as admin, navigate to any kiosk detail page

   - [ ] "Alert silencing (admin only)" card visible below the kiosk form
   - [ ] Enter reason text (>= 3 chars), click "Silence alerts" → success toast, card flips to silenced state showing reason
   - [ ] Click "Unsilence alerts" → success toast, card reverts to silence form
   - [ ] Both actions produce audit_log rows (check via `/admin/audit-log` or DB query)

9. **Non-admin cannot see silencing panel** — log in as a non-admin user, navigate to `/kiosks/[id]`

   - [ ] No "Alert silencing" card visible

## End-to-End Inngest Flow

10. **Trigger cron function via Inngest dev UI**

    - Send event `performance-alerts/run.requested` (or use the "Run now" button on the admin page after step 4 above)
    - Confirm in Inngest dev UI / function logs:
      - [ ] Classifier step runs and produces tier classifications for Live kiosks
      - [ ] Dispatch loop step identifies flip-in and chronic bottom-tier kiosks
      - [ ] POC email step sends emails to matched POCs (check email_log table: `status='sent'`, `kind='underperforming_poc'`)
      - [ ] NULL-POC kiosks produce email_log rows with `status='skipped'`, `recipient='[skip:no-poc]'`
      - [ ] audit_logs row written with `entity_type='performance_alert_run'`
    - Run again for the same ISO week → confirm no duplicate emails (idempotency via payloadHash)

## Sign-off

Once all 10 items above are ticked, update `.planning/STATE.md` to reflect Phase 9 UAT-complete and proceed to merge the Phase 9 PR.
