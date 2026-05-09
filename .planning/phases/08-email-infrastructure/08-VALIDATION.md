---
phase: 8
slug: email-infrastructure
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-08
updated: 2026-05-09
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 08-RESEARCH.md § Validation Architecture (line 757). Cross-checked
> against the per-task `<verify>` blocks in 08-01-PLAN.md, 08-02-PLAN.md,
> and 08-03-PLAN.md after iteration-1 plan-checker reconciliation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (unit + integration) + Playwright 1.x (E2E) — already wired in this repo |
| **Config file** | `vitest.config.ts` (root) + `playwright.config.ts` (root) |
| **Quick run command** | `npx vitest run --no-coverage` (unit + integration only) |
| **Full suite command** | `npx vitest run && npx playwright test` (Playwright runs against local dev server unless `PLAYWRIGHT_BASE_URL` is set) |
| **Estimated runtime** | ~30s vitest, ~90s Playwright local, ~120s Playwright preview |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage` (or scope to changed file: `npx vitest run path/to/file.test.ts`)
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit && npx eslint .`
- **Before `/gsd-verify-work`:** Full suite must be green AND Playwright E2E `tests/auth/password-reset.spec.ts` (extended in 08-03) + `tests/auth/change-password.spec.ts` (created in 08-02) must run against the preview alias (`PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-phase-08-email-infrastructure-vedant-kalbag-wkgs-projects.vercel.app`)
- **Max feedback latency:** 30 seconds for unit, 120 seconds for E2E preview

---

## Per-Task Verification Map

> One row per auto/tdd task across the three plans. Checkpoint tasks
> (operator-driven Docker regen, migration apply, dev-server smoke, DNS,
> env vars, UAT) are intentionally excluded — their evidence lives in
> the plan SUMMARY operator runbooks per CLAUDE.md, not in vitest/Playwright.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T-08.01-01 | 01 | 1 | EMAIL-01 / EMAIL-04 | T-08.01-09 | package.json declares Resend + Inngest + react-email pinned versions; nodemailer + @types/nodemailer removed; `email:dev` script wired | unit (node -e) | `node -e "const p=require('./package.json'); const need=['resend','inngest','@react-email/components','@react-email/render']; const dev=['react-email']; for (const k of need) if(!p.dependencies[k]) throw new Error('missing dep '+k); for (const k of dev) if(!p.devDependencies[k]) throw new Error('missing devDep '+k); if(p.dependencies.nodemailer) throw new Error('nodemailer still present'); if(p.devDependencies['@types/nodemailer']) throw new Error('@types/nodemailer still present'); if(p.scripts['email:dev']!=='react-email dev') throw new Error('email:dev script wrong'); console.log('ok');"` | ❌ W0 | ⬜ pending |
| T-08.01-03 | 01 | 1 | EMAIL-04 | T-08.01-06 | emailLog table compiles; partial unique idx `email_log_kind_payload_hash_uq` declared; no `withTimezone: false` regression | unit (tsc + grep) | `npx tsc --noEmit; test "$(grep -c 'export const emailLog' src/db/schema.ts)" = "1" && grep -q "email_log_kind_payload_hash_uq" src/db/schema.ts && ! grep -q "withTimezone: false" src/db/schema.ts` | ❌ W0 | ⬜ pending |
| T-08.01-04 | 01 | 1 | EMAIL-04 | T-08.01-06 | Migration is idempotent (3 × `IF NOT EXISTS`); partial unique idx scope `WHERE payload_hash IS NOT NULL` present; phase/plan attribution in header | unit (file + grep) | `test -f migrations/0041_phase_08_email_log.sql && test "$(grep -cE 'CREATE (TABLE\|UNIQUE INDEX\|INDEX) IF NOT EXISTS' migrations/0041_phase_08_email_log.sql)" = "3" && grep -q 'WHERE payload_hash IS NOT NULL' migrations/0041_phase_08_email_log.sql && grep -q "Phase 8 Plan 08-01" migrations/0041_phase_08_email_log.sql` | ❌ W0 | ⬜ pending |
| T-08.01-06 | 01 | 1 | EMAIL-01 | T-08.01-07 | Brand tokens module + 4 react-email templates compile; password-changed body has NO IP/UA/fingerprint reference (D-11 + Pitfall 7) | unit (tsc + grep) | `npx tsc --noEmit; test "$(grep -c 'export const BRAND' src/emails/brand.ts)" = "1" && grep -q 'azure: "#00A6D3"' src/emails/brand.ts && grep -q "PasswordResetEmail" src/emails/password-reset.tsx && grep -q "InviteEmail" src/emails/invite.tsx && grep -q "ExternalInviteEmail" src/emails/external-invite.tsx && grep -q "PasswordChangedEmail" src/emails/password-changed.tsx && ! grep -qiE "(ipAddress\|userAgent\|browserFingerprint)" src/emails/password-changed.tsx` | ❌ W0 | ⬜ pending |
| T-08.01-07 | 01 | 1 | EMAIL-04 | T-08.01-02 / T-08.01-06 | Inngest function declares retries: 5 with exponential backoff; 3 distinct `step.run` boundaries; `onConflictDoNothing` enforces `(kind, payload_hash)` idempotency | unit (tsc + grep) | `npx tsc --noEmit; test "$(grep -cE 'step\.run\(' src/inngest/functions/send-email.ts)" -ge "3" && grep -q "retries: 5" src/inngest/functions/send-email.ts && grep -q "onConflictDoNothing" src/inngest/functions/send-email.ts && grep -q '"wkg-kiosk-tool"' src/inngest/client.ts` | ❌ W0 | ⬜ pending |
| T-08.01-08 | 01 | 1 | EMAIL-04 | T-08.01-02 | `/api/inngest` route exposes GET/POST/PUT via `serve()` from `inngest/next`; signing-key validation auto-applied | unit (file + grep) | `test -f src/app/api/inngest/route.ts && grep -q 'export const { GET, POST, PUT } = serve' src/app/api/inngest/route.ts && grep -q 'from "inngest/next"' src/app/api/inngest/route.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| T-08.01-09 | 01 | 1 | EMAIL-01 | T-08.01-05 / T-08.01-10 | nodemailer fully removed from `src/lib/email.ts`; the three locked exports preserved byte-identical; `git diff src/lib/auth.ts` is empty | unit (tsc + grep + git) | `npx tsc --noEmit; test "$(grep -c 'nodemailer' src/lib/email.ts)" = "0" && test "$(grep -c 'export async function sendPasswordResetEmail' src/lib/email.ts)" = "1" && test "$(grep -c 'export async function sendInviteEmail' src/lib/email.ts)" = "1" && test "$(grep -c 'export async function sendExternalInviteEmail' src/lib/email.ts)" = "1" && test -z "$(git diff --name-only src/lib/auth.ts)"` | ❌ W0 | ⬜ pending |
| T-08.01-10 | 01 | 1 | EMAIL-01 | T-08.01-10 | `.env.example` declares the 5 new vars; SMTP_* removed; `EMAIL_FROM` is exactly `noreply@command.weknowgroup.com` (D-02 lock) | unit (grep) | `test "$(grep -cE '^(RESEND_API_KEY\|EMAIL_FROM\|EMAIL_REPLY_TO\|INNGEST_EVENT_KEY\|INNGEST_SIGNING_KEY)' .env.example)" = "5" && test "$(grep -c SMTP_ .env.example)" = "0" && test "$(grep -c TEST_ADMIN_EMAIL .env.test)" -ge "1" && grep -q "EMAIL_FROM=noreply@command.weknowgroup.com" .env.example` | ❌ W0 | ⬜ pending |
| T-08.01-11 | 01 | 1 | EMAIL-01 | T-08.01-03 / T-08.01-05 | `src/lib/email.test.ts` covers the EMAIL-01 contract (Resend send shape + email_log row written) | unit (vitest, mocked Resend) | `npx vitest run src/lib/email.test.ts --no-coverage` | ❌ W0 | ⬜ pending |
| T-08.01-12 | 01 | 1 | EMAIL-04 | T-08.01-04 / T-08.01-06 | Two integration tests cover (a) `tests/email/email-log.integration.test.ts` — duplicate `(kind, payload_hash)` insert is no-op via partial unique idx, and (b) `tests/email/send-email-fn.integration.test.ts` — Inngest function inserts an `email_log` row with the right shape on success/failure | integration (vitest) | `npx vitest run tests/email/ --no-coverage` | ❌ W0 | ⬜ pending |
| T-08.02-01 | 02 | 2 | EMAIL-02 | — | `(app)/account` route shell + `/account/security` page render under the existing session gate; no tabs / sidebar (D-12) | unit (tsc + grep) | `npx tsc --noEmit; test -f 'src/app/(app)/account/layout.tsx' && test -f 'src/app/(app)/account/security/page.tsx' && grep -q 'ChangePasswordForm' 'src/app/(app)/account/security/page.tsx'` | ❌ W0 | ⬜ pending |
| T-08.02-02 | 02 | 2 | EMAIL-02 | T-08.02-04 | Form calls `authClient.changePassword({ revokeOtherSessions: true })`; surfaces error-state messages inline; uses shadcn primitives + zod + react-hook-form + sonner per the (auth)/login-form precedent | unit (tsc + grep) | `npx tsc --noEmit; grep -q 'authClient.changePassword' 'src/app/(app)/account/security/change-password-form.tsx' && grep -q 'revokeOtherSessions: true' 'src/app/(app)/account/security/change-password-form.tsx'` | ❌ W0 | ⬜ pending |
| T-08.02-03 | 02 | 2 | EMAIL-02 / EMAIL-04 | T-08.02-02 / T-08.02-05 | `POST /api/account/password-changed` re-fetches the session, fires `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })`; rejects unauthenticated callers; D-11 confirmation body content (timestamp + contact-admin only — no IP/UA) | unit (tsc + grep) | `npx tsc --noEmit; test -f 'src/app/api/account/password-changed/route.ts' && grep -q "inngest.send" 'src/app/api/account/password-changed/route.ts' && grep -q "kind: 'password_changed'" 'src/app/api/account/password-changed/route.ts'` | ❌ W0 | ⬜ pending |
| T-08.02-04 | 02 | 2 | EMAIL-02 | T-08.02-04 / T-08.02-05 | Unit tests cover form error-state rendering (wrong current pw / weak new pw) and the password-changed route (auth required + Inngest payload shape) | unit (vitest) | `npx vitest run 'src/app/(app)/account/security/change-password-form.test.tsx' 'src/app/api/account/password-changed/route.test.ts' --no-coverage` | ❌ W0 | ⬜ pending |
| T-08.02-05 | 02 | 2 | EMAIL-02 | T-08.02-01 / T-08.02-03 | Playwright spec covers wrong-current-password, short-new-password, mismatched-confirm in local CI; happy path is gated on `PLAYWRIGHT_BASE_URL` (preview) and runs in 08-03 Phase E (CLAUDE.md preview-deploy rule) | E2E (Playwright) | `npx playwright test tests/auth/change-password.spec.ts` (local CI: 3 paths) and `PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/auth/change-password.spec.ts` (08-03 Task 5 Phase E: full 4 paths) | ❌ W0 | ⬜ pending |
| T-08.03-01 | 03 | 3 | EMAIL-03 | T-08.03-09 | `docs/email-fallback-brevo.md` documents env-driven `EMAIL_PROVIDER=resend\|brevo` switch + trigger conditions + Brevo SDK shape + DNS-records-to-swap + rollback path; no Brevo code (D-13 deferred) | unit (file + grep) | `test -f docs/email-fallback-brevo.md && grep -q "EMAIL_PROVIDER" docs/email-fallback-brevo.md && grep -q "EMAIL_PROVIDER=resend\|brevo" docs/email-fallback-brevo.md` | ❌ W0 | ⬜ pending |
| T-08.03-02 | 03 | 3 | EMAIL-03 | T-08.03-04 | `tests/auth/password-reset.spec.ts` extended with a preview-alias-only happy-path test (`test.skip(!process.env.PLAYWRIGHT_BASE_URL, ...)`); does NOT create a duplicate `tests/auth/forgot-password.spec.ts` (per pattern-mapper correction #2) | E2E (Playwright) | `! test -f tests/auth/forgot-password.spec.ts && grep -q "PLAYWRIGHT_BASE_URL" tests/auth/password-reset.spec.ts && grep -q "test.skip" tests/auth/password-reset.spec.ts` | ❌ W0 | ⬜ pending |
| T-08.03-06 | 03 | 3 | EMAIL-03 | — | `08-03-SUMMARY.md` consolidates DNS verification log, Vercel env-var run output, EMAIL-03 inbox UAT screenshots, and the preview-alias Playwright run logs | doc (file + grep) | `test -f .planning/phases/08-email-infrastructure/08-03-SUMMARY.md && grep -q "EMAIL-03" .planning/phases/08-email-infrastructure/08-03-SUMMARY.md && grep -q "DNS" .planning/phases/08-email-infrastructure/08-03-SUMMARY.md && grep -q "Playwright" .planning/phases/08-email-infrastructure/08-03-SUMMARY.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Per-requirement validation shape (cross-reference)

| Requirement | Validation type | Test file (canonical, post-iteration-1 reconciliation) | What it asserts |
|-------------|-----------------|--------------------------------------------------------|-----------------|
| **EMAIL-01** | Contract test (vitest, mocked Resend) | `src/lib/email.test.ts` (Task T-08.01-11) | `sendPasswordResetEmail(to, url)` calls `resend.emails.send({ from: process.env.EMAIL_FROM, to, subject: …, react: <PasswordResetEmail /> })` exactly once with the documented shape |
| **EMAIL-01** | Integration test (vitest, in-memory Inngest) | `tests/email/send-email-fn.integration.test.ts` (Task T-08.01-12) | The `send-email` function inserts an `email_log` row with `status='sent'`, `resend_message_id`, `inngest_run_id`; failure path inserts `status='failed'` with `last_error` populated |
| **EMAIL-02** | Playwright E2E (preview-aliased) | `tests/auth/change-password.spec.ts` (Task T-08.02-05) | Signed-in user navigates to `/account/security`, submits the form with current+new password, sees a success toast, is signed out (revokeOtherSessions), can sign back in with the new password. Local CI runs 3 error paths; happy path runs against preview alias under 08-03 Task 5 Phase E. Operator inspects inbox for confirmation email |
| **EMAIL-02** | Unit test (vitest, mocked authClient) | `src/app/(app)/account/security/change-password-form.test.tsx` (Task T-08.02-04) | Wrong-current-password and weak-new-password error states render the correct error message inline |
| **EMAIL-03** | Manual operator runbook (no automation) | `08-03-SUMMARY.md` (Task T-08.03-06) | Operator-driven UAT checklist: throwaway user invited via prod admin → operator clicks link in inbox → sets password → signs in. Screenshots filed. Per CLAUDE.md, destructive operator-driven flows live in plan SUMMARY checklists, not Playwright |
| **EMAIL-03** | Playwright (preview-aliased extension) | `tests/auth/password-reset.spec.ts` (Task T-08.03-02) | Preview-alias happy-path test (skipped locally); confirms forgot-password full loop works against the prod-shape preview before merge |
| **EMAIL-04** | Contract test (vitest, real DB) | `tests/email/email-log.integration.test.ts` (Task T-08.01-12) | Inserting two `email_log` rows with the same `(kind, payload_hash)` raises a unique-constraint violation on the second insert; partial unique idx scoped `WHERE payload_hash IS NOT NULL` so reset/invite rows (no payload_hash) are not constrained |
| **EMAIL-04** | Integration test (vitest, in-memory Inngest) | `tests/email/send-email-fn.integration.test.ts` (Task T-08.01-12) | Sending the same digest event twice results in one `email_log` row + one Resend send (the second `step.run('write-log', …)` is a no-op via the unique idx) |

---

## Wave 0 Requirements

- [x] `src/emails/__tests__/helpers/render-snapshot.ts` — helper that renders a react-email JSX template to HTML for snapshot tests (shared by template tests in plan 08-01 / 08-02). Created in 08-01 Task T-08.01-11.
- [x] `src/lib/__tests__/helpers/mock-resend.ts` — vitest mock for `resend.emails.send` returning `{ data: { id: 'mock-id' }, error: null }` by default; configurable per test. Created in 08-01 Task T-08.01-11.
- [x] Vitest projects already cover `src/**/*.test.ts(x)` and `tests/**/*.test.ts`; no new config needed.
- [x] Playwright fixtures already define `tests/auth/setup.ts` (test admin login). `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` env vars carry to preview-aliased runs (per CLAUDE.md preview-deploy rule).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `command.weknowgroup.com` DKIM/SPF/DMARC records resolve | EMAIL-01 / EMAIL-03 | DNS at registrar, not in repo | Operator (Task T-08.03-03) adds records per Resend dashboard; `dig TXT command.weknowgroup.com`, `dig TXT _dmarc.command.weknowgroup.com`, `dig CNAME resend._domainkey.command.weknowgroup.com` all return Resend's expected values; Resend dashboard shows "Verified" |
| Real-inbox delivery for forgot-password and invite | EMAIL-03 | Inbox-side observation | Operator (Task T-08.03-05) runs the runbook in `08-03-SUMMARY.md` against the preview alias; verifies email arrives in target inbox (not spam) within 60s; clicks link; lands on `/auth/reset-password?token=…`; resets; signs in. Screenshots filed |
| Confirmation email arrives after change-password | EMAIL-02 | Inbox-side observation | Operator runs UAT change-password flow; opens inbox; verifies "Your password was changed" email arrives within 60s; verifies email matches WeKnow brand (Graphite header, Azure CTA-color, Circular Pro fallback) |
| Brevo fallback runbook is reproducible | EMAIL-04 (deferred) | Documentation review only | Reviewer reads `docs/email-fallback-brevo.md` and confirms the env-var switch + trigger conditions are unambiguous. No automated check |
| Docker linux/amd64 lockfile regen succeeds | EMAIL-01 / EMAIL-04 | Cannot be run from Bash inside Claude Code | Operator (Task T-08.01-02) runs the Docker recipe in CLAUDE.md § "npm ci lockfile must stay in sync" and pastes the grep gate output into 08-01-SUMMARY.md |
| Migration 0041 applied to preview Neon DB | EMAIL-04 | Requires preview `DATABASE_URL` operator only has | Operator (Task T-08.01-05) applies migration via the project's runner; confirms `\d email_log` shows the partial unique idx |
| Inngest dev-server smoke test | EMAIL-04 | Local interactive process | Operator (Task T-08.01-13) runs `npx inngest-cli dev` against `localhost:3000/api/inngest`, fires a manual `email/send.requested` event, observes the function executes 3 step.run boundaries and inserts an `email_log` row |
| Vercel preview env vars set against git-branch alias | EMAIL-01 / EMAIL-03 | `vercel env add` is a credentialed CLI op | Operator (Task T-08.03-04) runs `vercel env add` for each var against `wkg-command-centre-git-gsd-phase-08-email-infrastructure-vedant-kalbag-wkgs-projects.vercel.app`; logs (with secret values redacted) filed in 08-03-SUMMARY.md |

---

## Validation Sign-Off

- [x] All auto/tdd tasks have `<automated>` verify; all checkpoint tasks have a manual-only verification row above
- [x] Sampling continuity: no 3 consecutive auto/tdd tasks without automated verify (08-01 has 10 consecutive auto/tdd with verify; 08-02 has 5; 08-03 has 3)
- [x] Wave 0 covers all MISSING references (mock-resend helper, render-snapshot helper) — both created in 08-01 Task T-08.01-11
- [x] No watch-mode flags (`vitest run`, `playwright test`, never `vitest watch`)
- [x] Feedback latency < 30s for unit/integration; < 120s for Playwright preview
- [x] `nyquist_compliant: true` set in frontmatter (per-task verification map populated 2026-05-09 after iteration-1 reconciliation)

**Approval:** approved 2026-05-09 (post iteration-1 plan-checker reconciliation; ISS-01 + ISS-02 + ISS-05 closed)
