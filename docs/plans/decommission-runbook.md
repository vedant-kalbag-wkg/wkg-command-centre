# Decommission Runbook — Legacy Apps

**Date:** 2026-04-17
**Status:** Ready to execute post-deployment
**Replaces:** `data-dashboard` (analytics) + `kiosk-management` (ops)

## Overview

`wkg-kiosk-tool` consolidates both legacy apps into a single Next.js application.
All Phase 1 milestones (M0–M6) are merged. This runbook covers the shutdown of the
two legacy systems and their supporting infrastructure.

## Pre-Conditions (must be true before proceeding)

- [ ] `wkg-kiosk-tool` is deployed to production and accessible to all users
- [ ] M5 ETL migration has been run and verified (sales data, hotel metadata, providers)
- [ ] All internal users have been invited and can log in via Better Auth
- [ ] Analytics pages produce the same results as `data-dashboard` for a reference date range
- [ ] Kiosk/location/product CRUD is functional and matches `kiosk-management` capabilities
- [ ] External portal stub is live (Phase 2 — external users see "coming soon")

## Step 1: Freeze Legacy Access

1. Set `data-dashboard` to read-only (disable writes in Supabase RLS or app config)
2. Set `kiosk-management` to read-only (disable Monday.com write sync if still active)
3. Notify all users via email: legacy apps will be shut down on [DATE], use new URL

**Verification:** Users report they can access `wkg-kiosk-tool` at the new URL.

## Step 2: Final Data Reconciliation

1. Run the M5 ETL migration script one final time:
   ```bash
   npx tsx --env-file=.env.local scripts/migrate-from-supabase.ts
   ```
2. Compare row counts:
   - `salesRecords` in new DB vs `transaction_cache` in Supabase
   - `locations` (with `outletCode`) vs `hotel_metadata_cache` in Supabase
   - `products` vs distinct product names in old system
   - `providers` vs distinct provider names in old system
3. Spot-check 3–5 analytics queries (portfolio summary, heat map top 10, trend builder)
   against the same date range on `data-dashboard`

**Verification:** Row counts match. Analytics figures match within rounding tolerance.

## Step 3: Shut Down data-dashboard

1. Take down the `data-dashboard` deployment (Vercel/hosting provider)
2. Update DNS: redirect old `data-dashboard` domain to `wkg-kiosk-tool` or a notice page
3. **Do NOT delete the Supabase project yet** — keep for 30-day rollback window

**Verification:** Old URL redirects or shows decommission notice.

## Step 4: Shut Down kiosk-management

1. Take down the `kiosk-management` deployment
2. Update DNS: redirect old domain to `wkg-kiosk-tool` or a notice page
3. Revoke Monday.com API tokens (no longer needed — CSV import replaced the sync)

**Verification:** Old URL redirects. Monday.com tokens revoked.

## Step 5: Clean Up Environment

After 30-day rollback window:

1. **Supabase project:** Delete or downgrade to free tier (all data is in new Postgres)
2. **Monday.com integration:** Remove webhook subscriptions if any remain
3. **Environment variables:** Remove from `.env.local` / production config:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MONDAY_API_TOKEN`
   - `MONDAY_BOARD_ID`
4. **Migration script:** Archive `scripts/migrate-from-supabase.ts` (no longer needed)
5. **Legacy repos:** Archive `data-dashboard` and `kiosk-management` repos on GitHub
   (don't delete — keep for historical reference)

## Step 6: Post-Decommission Verification

1. Run full test suite on production:
   ```bash
   npx vitest run
   npx playwright test
   ```
2. Confirm all analytics pages load with production data
3. Confirm kiosk/location CRUD works end-to-end
4. Confirm auth flow (login, invite, password reset)
5. Monitor error logs for 72 hours post-cutover

## Rollback Plan

If critical issues are discovered within the 30-day window:

1. Re-deploy `data-dashboard` and/or `kiosk-management` from archived repos
2. Point DNS back to legacy apps
3. Supabase data should still be intact (not deleted until Step 5)
4. Notify users of temporary revert

## Timeline

| Step | Duration | Dependency |
|------|----------|------------|
| 1. Freeze legacy | 1 day | Production deployment live |
| 2. Data reconciliation | 2–4 hours | ETL script, analytics QA |
| 3. Shut down data-dashboard | 30 min | Step 2 verified |
| 4. Shut down kiosk-management | 30 min | Step 2 verified |
| 5. Clean up (30 days later) | 1 hour | Rollback window elapsed |
| 6. Post-decom verification | 72 hours monitoring | Steps 3–4 complete |

## Contacts

- **Data-dashboard owner:** [TBD — fill in before execution]
- **Kiosk-management owner:** [TBD — fill in before execution]
- **Supabase admin:** [TBD — fill in before execution]
- **DNS admin:** [TBD — fill in before execution]
