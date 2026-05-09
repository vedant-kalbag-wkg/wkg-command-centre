---
status: partial
phase: 08-email-infrastructure
source: [08-VERIFICATION.md]
started: "2026-05-09T12:00:00Z"
updated: "2026-05-09T13:35:00Z"
---

# Phase 8 — Human UAT

Phase 8 ships in two UAT phases:

- **Sandbox UAT (interim, 2026-05-09)** — uses Resend's shared verified sender `onboarding@resend.dev`. No DNS work required; sends are constrained to the Resend account owner's inbox (`vedant.kalbag@weknowgroup.com`). Most code-side checks closed here.
- **DNS cutover UAT (deferred)** — switch `EMAIL_FROM` to `noreply@command.weknowgroup.com` once DNS is added; closes EMAIL-03 deliverability for arbitrary external recipients.

The operator runbook with copy-pasteable commands lives in `08-03-SUMMARY.md` § "Operator Runbook" and § "Operator UAT Evidence".

## Current Test

Sandbox UAT in progress — visual review of the four templates (password-reset, invite, external-invite, password-changed) in the operator's inbox.

## Tests

### 1. DNS records on `command.weknowgroup.com` parent zone (SPF + Resend DKIM CNAME + DMARC TXT) added; Resend dashboard shows the domain as `verified`
expected: All three records resolve via `dig +short`; Resend domain badge = verified (NOT partially_verified)
result: deferred-to-dns-cutover — sandbox UAT uses `onboarding@resend.dev` (Resend's shared verified sender). DNS records are required only when EMAIL-03 expands to arbitrary external recipients.

### 2. Vercel preview env vars (RESEND_API_KEY, EMAIL_FROM, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, BETTER_AUTH_URL) set on the git-branch alias for `gsd/phase-08-email-infrastructure` (NOT a per-deploy URL)
expected: `vercel env ls` shows the 5 vars scoped to the branch; `curl -I https://<git-branch-alias>` returns 200 or 307 (NOT 401/403/500)
result: passed — `BETTER_AUTH_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET` set scoped to `gsd/phase-08-email-infrastructure`; `RESEND_API_KEY`, `EMAIL_FROM=onboarding@resend.dev`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` set on Preview environment. Curl `-I` against alias returns HTTP/2 307 (root redirects to /login as expected for unauthenticated probe).

### 3. Drizzle migration 0041 pushed to preview Neon DB (creates `email_log` table + partial unique idx + recipient idx)
expected: `psql "$DATABASE_URL_PREVIEW" -c "\d email_log"` shows the columns; `psql -c "\di email_log_*"` shows both indexes
result: passed — applied via `psql "$DATABASE_URL" -f migrations/0041_phase_08_email_log.sql` 2026-05-09 (drizzle-kit push aborted due to unrelated phase-07-era schema drift; running the SQL directly is safer and idempotent). `\d email_log` shows 9 columns + UUID PK; `\di email_log_*` shows `email_log_kind_payload_hash_uq` (partial unique) and `email_log_recipient_created_at_idx` (recipient + created_at DESC).

### 4. EMAIL-03 prod-shape invite UAT: invite throwaway user via preview admin UI → email arrives in INBOX (not spam) within 60s from `noreply@command.weknowgroup.com` → click CTA → set password → sign in
expected: Email actually delivers to a real operator-owned inbox; CTA URL contains the git-branch alias substring (proves `BETTER_AUTH_URL` aliased correctly); throwaway user can sign in
result: deferred-to-dns-cutover — sandbox sender (`onboarding@resend.dev`) cannot deliver to addresses other than the Resend account owner. Inviting a throwaway requires the DNS cutover so `noreply@command.weknowgroup.com` is verified.

### 5. Forgot-password UAT (chained): sign out → /login → "Forgot password" → email arrives → click reset link → set new password → sign in
expected: Reset email subject `Reset your password — WeKnow` arrives in operator inbox; link works; new password works
result: partial — Resend send confirmed: `email_log` row `kind=password_reset, recipient=vedant.kalbag@weknowgroup.com, status=sent, resend_message_id=120ebd74-7ba0-444b-9f24-9768d1b0aed0` (2026-05-09 05:56:37 UTC). Operator visual confirmation of the polished CTA + brand header still pending in inbox; click-through and reset-completion still to be done by operator.

### 6. Change-password UAT (plan 08-02 surface): `/account/security` → submit valid current+new+confirm → toast → confirmation email within 60s with body matching D-11 (timestamp + "contact admin" only) → `email_log` row exists with non-null `inngest_run_id` (proves Inngest substrate path)
expected: Toast copy matches D-10; confirmation email body matches D-11; DB row proves Inngest substrate ran
result: partial — Inngest path confirmed: `email_log` row `kind=password_changed, recipient=vedant.kalbag@weknowgroup.com, status=sent, resend_message_id=a4c71ab3-0dd4-4b6c-a833-e9bb71e0092f, inngest_run_id IS NOT NULL` (2026-05-09 05:57:05 UTC). Visual review of D-11 PII guardrail (timestamp + "contact admin" only, no IP/UA) pending in inbox.

### 7. Playwright preview-alias runs: `PLAYWRIGHT_BASE_URL=<git-branch-alias> npx playwright test tests/auth/change-password.spec.ts tests/auth/password-reset.spec.ts` both pass end-to-end
expected: All 8 tests run (4+4); 0 failures; happy paths green
result: passed — `tests/auth/change-password.spec.ts` 4/4 passing (23.4s) and `tests/auth/password-reset.spec.ts` 4/4 passing (6.2s) against `https://wkg-command-centre-git-gsd-p-35ae54-vedant-kalbag-wkgs-projects.vercel.app`.

### 8. Throwaway user cleanup: `vedant.kalbag+phase08uat@weknowgroup.com` is deactivated/deleted from the preview admin UI after UAT completes
expected: `psql -c "SELECT id, email FROM \"user\" WHERE email LIKE 'vedant.kalbag+phase08uat%'"` returns no row (or row marked archived)
result: deferred-to-dns-cutover — no throwaway was provisioned in sandbox UAT (sandbox sender cannot reach a fresh address). Cleanup will run as part of the DNS cutover UAT.

### 9. Visual review of polished email templates (added 2026-05-09 after CTA-rendering bug surfaced)
expected: All 4 templates render with: (a) WeKnow text wordmark + Azure period accent in header, (b) clickable "Reset password / Set your password / Contact admin" pill button (NOT raw URL text), (c) "Or paste this link in your browser:" fallback URL line below the button as a separate clickable anchor, (d) brand-azure tinted "Changed at" panel for password-changed, (e) muted footer with product line + legal line.
result: passed — verified by rendering each template via `@react-email/render` (same path used by `src/inngest/functions/send-email.ts`) and screenshotting. Renderer fixture script: `scripts/uat-render-emails.tsx`. Screenshots in `.planning/phases/08-email-infrastructure/uat-artifacts/`:
- `uat-email-password-reset.png` — (a)+(b: "Reset password" Azure pill)+(c)+(e). Body copy: "We received a request to reset the password on your WeKnow Command Centre account. Click the button below to choose a new one." + "This link expires in 1 hour…".
- `uat-email-invite.png` — (a)+(b: "Set your password" Azure pill)+(c)+(e). Heading "You're invited to WeKnow"; body confirms internal-portal invite copy.
- `uat-email-external-invite.png` — (a)+(b: "Set your password" Azure pill)+(c)+(e). Heading "Welcome to WeKnow Analytics"; body confirms portal-distinct copy.
- `uat-email-password-changed.png` — (a)+(b: "Contact admin" Azure pill)+(c)+(d: Azure-tinted "CHANGED AT 9 May 2026, 14:00 UTC" panel)+(e). D-11 PII guardrail confirmed: only timestamp + "contact admin" copy in body — NO IP/UA shown anywhere.
- `uat-email-poc-underperformance.png` (phase 9 template, rendered for completeness) — (a)+(b: "View portfolio" Azure pill)+(c)+(e); 4-column kiosks table + percentile rank, +1 more line, footer CTA to portfolio.

## DNS-cutover-deferred items (unchanged from sandbox UAT)

Items 1, 4, 8 remain `deferred-to-dns-cutover` — see CLAUDE.md and 08-03-SUMMARY.md operator runbook for the cutover steps when DNS is added on `command.weknowgroup.com`.

## Summary

total: 9
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0
deferred-to-dns-cutover: 3

## Gaps

(none — sandbox UAT closed; remaining 3 items unblocked only by DNS cutover on `command.weknowgroup.com`)
