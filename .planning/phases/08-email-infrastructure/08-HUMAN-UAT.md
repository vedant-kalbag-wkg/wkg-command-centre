---
status: partial
phase: 08-email-infrastructure
source: [08-VERIFICATION.md]
started: "2026-05-09T12:00:00Z"
updated: "2026-05-09T12:00:00Z"
---

# Phase 8 — Human UAT (operator-only items)

These items require a real operator (Vedant) on UAT day — they cannot be executed by Claude. They are intentionally deferred per plan 08-03 (`autonomous: false`) and decision D-14 in `08-CONTEXT.md`.

The operator runbook with copy-pasteable commands lives in `08-03-SUMMARY.md` § "Operator Runbook" and § "Operator UAT Evidence".

## Current Test

[awaiting human testing]

## Tests

### 1. DNS records on `command.weknowgroup.com` parent zone (SPF + Resend DKIM CNAME + DMARC TXT) added; Resend dashboard shows the domain as `verified`
expected: All three records resolve via `dig +short`; Resend domain badge = verified (NOT partially_verified)
result: [pending]

### 2. Vercel preview env vars (RESEND_API_KEY, EMAIL_FROM, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, BETTER_AUTH_URL) set on the git-branch alias for `gsd/phase-08-email-infrastructure` (NOT a per-deploy URL)
expected: `vercel env ls` shows the 5 vars scoped to the branch; `curl -I https://<git-branch-alias>` returns 200 or 307 (NOT 401/403/500)
result: [pending]

### 3. Drizzle migration 0041 pushed to preview Neon DB (creates `email_log` table + partial unique idx + recipient idx)
expected: `psql "$DATABASE_URL_PREVIEW" -c "\d email_log"` shows the columns; `psql -c "\di email_log_*"` shows both indexes
result: [pending]

### 4. EMAIL-03 prod-shape invite UAT: invite throwaway user via preview admin UI → email arrives in INBOX (not spam) within 60s from `noreply@command.weknowgroup.com` → click CTA → set password → sign in
expected: Email actually delivers to a real operator-owned inbox; CTA URL contains the git-branch alias substring (proves `BETTER_AUTH_URL` aliased correctly); throwaway user can sign in
result: [pending]

### 5. Forgot-password UAT (chained): sign out → /login → "Forgot password" → email arrives → click reset link → set new password → sign in
expected: Reset email subject `Reset your password — WeKnow` arrives in operator inbox; link works; new password works
result: [pending]

### 6. Change-password UAT (plan 08-02 surface): `/account/security` → submit valid current+new+confirm → toast → confirmation email within 60s with body matching D-11 (timestamp + "contact admin" only) → `email_log` row exists with non-null `inngest_run_id` (proves Inngest substrate path)
expected: Toast copy matches D-10; confirmation email body matches D-11; DB row proves Inngest substrate ran
result: [pending]

### 7. Playwright preview-alias runs: `PLAYWRIGHT_BASE_URL=<git-branch-alias> npx playwright test tests/auth/change-password.spec.ts tests/auth/password-reset.spec.ts` both pass end-to-end
expected: All 8 tests run (4+4); 0 failures; happy paths green
result: [pending]

### 8. Throwaway user cleanup: `vedant.kalbag+phase08uat@weknowgroup.com` is deactivated/deleted from the preview admin UI after UAT completes
expected: `psql -c "SELECT id, email FROM \"user\" WHERE email LIKE 'vedant.kalbag+phase08uat%'"` returns no row (or row marked archived)
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
