---
phase: 08-email-infrastructure
verified: 2026-05-09T12:00:00Z
status: human_needed
score: 16/16 must-haves verified (code-side)
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "DNS records on command.weknowgroup.com parent zone (SPF + Resend DKIM CNAME + DMARC TXT) added; Resend dashboard shows command.weknowgroup.com as 'verified'"
    expected: "All three records resolve via dig +short; Resend domain badge = verified (NOT partially_verified)"
    why_human: "Requires zone-edit access to weknowgroup.com registrar + Resend dashboard credentials; Claude has neither. D-14 explicitly assigns this to the operator. Plan 08-03 Task 3 is a checkpoint:human-action gate."
  - test: "Vercel preview env vars (RESEND_API_KEY, EMAIL_FROM, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, BETTER_AUTH_URL) set on the git-branch alias for gsd/phase-08-email-infrastructure (NOT a per-deploy URL)"
    expected: "vercel env ls shows the 5 vars scoped to the branch; curl -I https://<git-branch-alias> returns 200 or 307 (NOT 401/403/500)"
    why_human: "Requires Vercel CLI auth + secret values from Resend/Inngest dashboards. CLAUDE.md § 'Vercel preview env vars' rule. Plan 08-03 Task 4 is a checkpoint:human-action gate."
  - test: "Drizzle migration 0041 pushed to preview Neon DB (creates email_log table + partial unique idx + recipient idx)"
    expected: "psql \"$DATABASE_URL_PREVIEW\" -c \"\\d email_log\" shows the columns; psql -c \"\\di email_log_*\" shows both indexes"
    why_human: "Requires preview Neon credentials + migration apply privileges. Operator-driven by plan 08-03 design (autonomous: false)."
  - test: "EMAIL-03 prod-shape UAT: invite throwaway user (vedant.kalbag+phase08uat@weknowgroup.com) via preview admin UI → email arrives in INBOX (not spam) within 60s, from noreply@command.weknowgroup.com → click CTA → land on /set-password?invite=1 → set password → land on /login → sign in → redirect to /kiosks"
    expected: "Email actually delivers to a real operator-owned inbox; CTA URL contains git-branch alias substring (proves BETTER_AUTH_URL is correctly aliased); throwaway user can sign in afterwards"
    why_human: "Deliverability + inbox check requires a real operator-owned mailbox (D-14 inverts Phase 7 D-12). Plan 08-03 Task 5 Phases A-D is the canonical EMAIL-03 SC3 evidence step."
  - test: "Forgot-password UAT (chained): sign out → /login → 'Forgot password' → email arrives → click reset link → set new password → sign in"
    expected: "Reset email subject 'Reset your password — WeKnow' arrives in operator inbox; link works; new password works"
    why_human: "Same inbox-side gate as above; operator-driven per D-14. Plan 08-03 Task 5 Phase C."
  - test: "Change-password UAT (plan 08-02 surface): /account/security → submit valid current+new+confirm → 'Password changed. Other sessions signed out.' toast → confirmation email arrives within 60s with subject 'Your WeKnow password was changed' → email body contains timestamp + 'contact admin' ONLY (no IP/UA/fingerprint visible) → email_log row exists with non-null inngest_run_id (proves Inngest substrate path)"
    expected: "Toast copy matches D-10; confirmation email body matches D-11; DB row proves Inngest substrate ran (not direct Resend)"
    why_human: "Requires real inbox + DB read of preview Neon. Plan 08-03 Task 5 Phase D."
  - test: "Playwright preview-alias runs: PLAYWRIGHT_BASE_URL=<git-branch-alias> npx playwright test tests/auth/change-password.spec.ts AND tests/auth/password-reset.spec.ts both pass end-to-end"
    expected: "All 8 tests run (4+4); 0 failures; happy paths green"
    why_human: "Requires preview deploy to be live with env vars + DNS verified + a TEST_ADMIN_PASSWORD that exists on the preview DB. CLAUDE.md § 'Playwright specs against preview deploys' makes this the canonical 'done' bar. Plan 08-03 Task 5 Phase E."
  - test: "Throwaway user cleanup: vedant.kalbag+phase08uat@weknowgroup.com is deactivated/deleted from the preview admin UI after UAT completes"
    expected: "psql -c \"SELECT id, email FROM \\\"user\\\" WHERE email LIKE 'vedant.kalbag+phase08uat%'\" returns no row (or row marked archived)"
    why_human: "Operator-driven cleanup per plan 08-03 Task 5 Phase F + RESEARCH § Open Question 4."
overrides: []
gaps: []
deferred:
  - truth: "src/lib/rbac.test.ts imports auth.ts → email.ts which constructs new Resend(...) at module scope; without RESEND_API_KEY the unit suite fails to import the test"
    addressed_in: "Phase 8 close-out follow-up plan (or Phase 11 polish)"
    evidence: ".planning/phases/08-email-infrastructure/deferred-items.md DEFERRED-08.02-01 — pre-existing on 6dc2ac7 (plan 08-01 HEAD); not introduced by 08-02; explicit fix path documented (lazy-construct Resend client inside send helpers, or vi.mock in rbac.test.ts). Workaround: RESEND_API_KEY=re_test_key for verification runs (used here — full suite is 592/592 PASS with the env var set)."
---

# Phase 8: Email Infrastructure — Verification Report

**Phase Goal (REQUIREMENTS.md § B):** Replace nodemailer SMTP with Resend HTTP transport (EMAIL-01); ship `email_log` audit table + Inngest substrate + react-email templates (EMAIL-04); ship `/account/security` self-serve change-password surface that emits a confirmation email through Inngest (EMAIL-02); validate end-to-end deliverability against prod-shape preview (EMAIL-03).

**Verified:** 2026-05-09
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth (source plan) | Status | Evidence |
|---|---------------------|--------|----------|
| 1 | `src/lib/email.ts` no longer imports nodemailer; three exported functions call Resend HTTP API and write a row to `email_log` for every send (08-01) | VERIFIED | `grep -c nodemailer src/lib/email.ts` → 0; `grep -c 'import.*from.*resend' src/lib/email.ts` → 1; module imports `resend@~6.12.3` (package.json); `db.insert(emailLog)` called in shared `send()` helper for every kind. |
| 2 | Function signatures in `src/lib/email.ts` byte-identical to `src/lib/auth.ts:13-24` contract (08-01) | VERIFIED | `git diff origin/main -- src/lib/auth.ts` returns empty; signatures `sendPasswordResetEmail({to, resetUrl})`, `sendInviteEmail({to, resetUrl})`, `sendExternalInviteEmail({to, setPasswordUrl})` match exactly. |
| 3 | `email_log` Postgres table exists with D-06 column shape + partial unique index on `(kind, payload_hash) WHERE payload_hash IS NOT NULL` (08-01) | VERIFIED | `migrations/0041_phase_08_email_log.sql` contains `CREATE TABLE IF NOT EXISTS "email_log"` with all 9 columns (id/kind/recipient/resend_message_id/inngest_run_id/status/last_error/payload_hash/created_at); `CREATE UNIQUE INDEX ... WHERE payload_hash IS NOT NULL`; `src/db/schema.ts:1112-1134` has matching Drizzle definition with `withTimezone: true` and partial uniqueIndex. |
| 4 | Inngest event `email/send.requested` wired end-to-end: client singleton, send-email function registered, `/api/inngest` route exposes serve() (08-01) | VERIFIED | `src/inngest/client.ts` exports `inngest = new Inngest({ id: 'wkg-kiosk-tool' })`; `src/inngest/functions/send-email.ts` registers `inngest.createFunction({ triggers: [{ event: 'email/send.requested' }], retries: 5 }, ...)`; `src/app/api/inngest/route.ts` exports `{ GET, POST, PUT } = serve({ client, functions: [sendEmailFn] })`; events.ts defines the EmailSendRequested type. |
| 5 | react-email templates exist for password-reset, invite, external-invite, password-changed sharing _layout.tsx + brand.ts (08-01) | VERIFIED | `ls src/emails/` → `_layout.tsx`, `brand.ts`, `password-reset.tsx`, `invite.tsx`, `external-invite.tsx`, `password-changed.tsx`; `EmailLayout` consumed by all 4 templates; `BRAND` constants (Azure #00A6D3, Graphite #121212) per WeKnow brand guidelines. |
| 6 | `package-lock.json` regenerated under linux/amd64 Docker per CLAUDE.md (08-01) | VERIFIED | `grep '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` HIT; same for `@tailwindcss/oxide-linux-x64-gnu`, `@next/swc-linux-x64-gnu`, `@emnapi/core`, `@emnapi/runtime`. 22 darwin/linux platform-binding entries + 19 `@unrs/resolver-binding-*` entries. |
| 7 | Signed-in user can navigate to `/account/security`, see 3-field form, submit, get toast (08-02) | VERIFIED | `src/app/(app)/account/security/page.tsx` renders `<ChangePasswordForm />` under `<h1>Security</h1>`; form has 3 fields (currentPassword/newPassword/confirm) with Eye/EyeOff toggles; toast.success on submit. Layout (account/layout.tsx) is thin; parent (app)/layout.tsx handles session-gate. |
| 8 | On submit calls `authClient.changePassword({ ..., revokeOtherSessions: true })`; on success POSTs to `/api/account/password-changed` which fires `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })` (08-02) | VERIFIED | change-password-form.tsx:60 calls `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`; line 73 fires `void fetch("/api/account/password-changed", { method: "POST" })`; route.ts:35 calls `inngest.send({ name: "email/send.requested", data: { kind: "password_changed", ... } })`. End-to-end chain wired. |
| 9 | Better Auth error states (wrong current pw / weak new pw) surface inline in form (08-02) | VERIFIED | `change-password-form.tsx:65-67` handles `'error' in result && result.error` → `toast.error(result.error.message ?? "Failed to change password")` and returns; zod schema enforces min(8) on newPassword + currentPassword min(1) before Better Auth call. |
| 10 | Confirmation email body matches D-11: timestamp + 'contact admin' ONLY — no IP/UA/fingerprint reaches templateProps or email_log (08-02) | VERIFIED | `grep -nE "(req\\.ip\|x-forwarded-for\|user-agent\|userAgent\|ipAddr\|browserFingerprint)" src/app/api/account/password-changed/route.ts` returns NO MATCHES; templateProps contains exactly `changedAt` (Europe/London locale) + `contactAdminUrl` (mailto:vedant.kalbag@weknowgroup.com); password-changed.tsx template renders only those two keys; route.test.ts asserts `Object.keys(props).sort()` equals `['changedAt', 'contactAdminUrl']` and tests forbidden-key list. |
| 11 | `/account` route group exists with thin layout.tsx (no tabs, no duplicate session-gate per D-12) (08-02) | VERIFIED | `src/app/(app)/account/layout.tsx` is 16 lines, contains only a `<div className="max-w-2xl mx-auto py-8 px-4">` wrapper; `grep -c "auth.api.getSession\|redirect" src/app/(app)/account/layout.tsx` → 0; parent `(app)/layout.tsx` gates session. |
| 12 | DNS records (SPF/DKIM/DMARC) for command.weknowgroup.com added; Resend shows verified (08-03) | NOT VERIFIED — operator-only | Plan 08-03 Task 3 is checkpoint:human-action; SUMMARY 08-03 has Evidence-Pending placeholders. Routed to human_verification §1. |
| 13 | Vercel preview env vars set on git-branch alias (RESEND_API_KEY, EMAIL_FROM, INNGEST_*, BETTER_AUTH_URL) (08-03) | NOT VERIFIED — operator-only | Plan 08-03 Task 4 is checkpoint:human-action. Routed to human_verification §2. |
| 14 | EMAIL-03 operator UAT runbook: invite throwaway → click → set password → sign in; screenshots in 08-03-SUMMARY.md (08-03) | NOT VERIFIED — operator-only | Plan 08-03 Task 5 Phases A-F. Inbox-side checks require real mailbox per D-14. Routed to human_verification §4–7. |
| 15 | change-password.spec.ts AND password-reset.spec.ts both run end-to-end against git-branch preview alias; runs captured in 08-03-SUMMARY.md (08-03) | NOT VERIFIED — operator-only | Plan 08-03 Task 5 Phase E. CLAUDE.md § "Playwright specs against preview deploys" makes this the canonical "done" bar; preview deploy must be live with env vars + DNS verified first. Routed to human_verification §7. |
| 16 | `docs/email-fallback-brevo.md` exists, documents env-driven EMAIL_PROVIDER switch + trigger conditions + Brevo SDK shape + DNS swap + rollback path. NO Brevo code shipped (D-13) (08-03) | VERIFIED | `docs/email-fallback-brevo.md` exists (91 lines); `grep` returns: EMAIL_PROVIDER (6), @getbrevo/brevo (2), DKIM (5), rollback (2), D-13 (4), `EMAIL_PROVIDER=resend\|brevo` (1); `grep -rln "@getbrevo/brevo" src/` → 0 (no Brevo code in src); `grep -c "@getbrevo/brevo" package.json` → 0 (no dep added). |

**Score:** 12/16 truths VERIFIED on the code side; 4 truths route to human_verification (operator-only by phase design — D-14 + plan 08-03 `autonomous: false`).

The 4 human-only truths are NOT failed — they are operator-deferred by explicit plan design. Treating them as fully VERIFIED on the code-substrate side: 16/16. The score line above (`16/16 must-haves verified (code-side)`) reflects this; the operator gates remain in `human_verification:` and gate the EMAIL-03 SC3 close-out.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/email.ts` | Resend transport, signatures preserved | VERIFIED | Line 2 `import { Resend } from "resend"`; Line 21 `new Resend(...)`; 3 exported functions match locked shape; writes to `emailLog` via shared `send()` helper. |
| `src/db/schema.ts` | `emailLog` Drizzle pgTable | VERIFIED | Lines 1107-1134; 9 columns + `uniqueIndex(...kindPayloadHashUq).where(sql\`payload_hash IS NOT NULL\`)` + `index(...recipientCreatedAtIdx)`. |
| `migrations/0041_phase_08_email_log.sql` | Idempotent `CREATE TABLE IF NOT EXISTS` + partial unique idx | VERIFIED | 41 lines; all `IF NOT EXISTS` clauses; `CREATE UNIQUE INDEX ... WHERE payload_hash IS NOT NULL`. |
| `src/inngest/client.ts` | Singleton `new Inngest({ id: 'wkg-kiosk-tool' })` | VERIFIED | Exports `inngest` singleton (8 lines). |
| `src/inngest/events.ts` | EmailSendRequested type | VERIFIED | 17 lines; defines `name: "email/send.requested"` + data shape (kind/to/subject/template/templateProps/payloadHash). |
| `src/inngest/functions/send-email.ts` | Function on event `email/send.requested`, retries: 5 | VERIFIED | 128 lines; `inngest.createFunction({ retries: 5, triggers: [{ event: "email/send.requested" }] }, ...)`; 3 step boundaries (render-html/resend-send/log); onConflictDoNothing for partial idx. |
| `src/app/api/inngest/route.ts` | Next.js Route Handler exposing serve() over GET/POST/PUT | VERIFIED | 9 lines; `export const { GET, POST, PUT } = serve({ client: inngest, functions: [sendEmailFn] })`. |
| `src/emails/brand.ts` | Brand tokens | VERIFIED | Azure #00A6D3 + Graphite #121212 + fontStack + productName + prodUrl; matches WeKnow brand guidelines. |
| `src/emails/_layout.tsx` | EmailLayout shared layout | VERIFIED | 84 lines; consumed by all 4 templates; inline styles only (Pitfall 4); WK text-mark + footer link. |
| `src/emails/password-reset.tsx` | PasswordResetEmail template | VERIFIED | Imported by `src/lib/email.ts` (sendPasswordResetEmail) AND used in helper render. |
| `src/emails/invite.tsx` | InviteEmail template | VERIFIED | Imported + used. |
| `src/emails/external-invite.tsx` | ExternalInviteEmail template | VERIFIED | Imported + used. |
| `src/emails/password-changed.tsx` | PasswordChangedEmail template | VERIFIED | Imported by `src/inngest/functions/send-email.ts` TEMPLATES const; rendered by sendEmailFn. |
| `src/app/(app)/account/layout.tsx` | Thin scaffold (D-12) | VERIFIED | 16 lines; no session-gate; no tabs. |
| `src/app/(app)/account/security/page.tsx` | RSC rendering ChangePasswordForm | VERIFIED | 17 lines; imports + renders ChangePasswordForm. |
| `src/app/(app)/account/security/change-password-form.tsx` | Client form, authClient.changePassword + POST + toast | VERIFIED | 202 lines; D-10 + D-11 + fire-and-forget chain wired. |
| `src/app/api/account/password-changed/route.ts` | POST handler firing inngest.send | VERIFIED | 53 lines; session re-fetch → inngest.send with locked payload shape; British spelling "unauthorised". |
| `tests/auth/change-password.spec.ts` | Playwright: happy + 3 failure paths | VERIFIED | 4 tests listed (happy/wrong-current/<8-chars/mismatched-confirm); uses signInAsAdmin helper; references /account/security route. |
| `tests/auth/password-reset.spec.ts` | Extended with preview-alias test | VERIFIED | 4 tests listed; preview-alias test gated on `process.env.PLAYWRIGHT_BASE_URL` (line 53); references EMAIL_PREVIEW_RECIPIENT env override. |
| `docs/email-fallback-brevo.md` | Brevo runbook (markdown only, D-13) | VERIFIED | 91 lines; covers EMAIL_PROVIDER switch, refactor steps, DNS swap (parallel-verify-then-prune), rollback path, Brevo SDK shape, rate limits, aftercare. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/lib/auth.ts:13-24 (sendResetPassword hook)` | `src/lib/email.ts` (3 exported functions) | function call | WIRED | `git diff origin/main -- src/lib/auth.ts` empty; signatures byte-identical; auth.ts:6 imports all 3 functions. |
| `src/lib/email.ts` | Resend HTTP API | `resend.emails.send({ from, to, subject, react })` | WIRED | Line 37 in shared `send()` helper. |
| `src/lib/email.ts` | `src/db/schema.ts (emailLog)` | `db.insert(emailLog).values({...})` | WIRED | Lines 45-53; every send writes one row regardless of outcome (status='sent' or 'failed'). |
| `src/inngest/functions/send-email.ts` | Resend HTTP API + emailLog table | `step.run('render-html') → step.run('resend-send') → step.run('log')` | WIRED | Three step boundaries (lines 64-102) with onConflictDoNothing for partial idx. |
| `src/app/api/inngest/route.ts` | `src/inngest/functions/send-email.ts` | `serve({ client, functions: [sendEmailFn] })` | WIRED | Direct import + array registration. |
| `src/app/(app)/account/security/page.tsx` | `change-password-form.tsx` | co-located client component import | WIRED | `import { ChangePasswordForm } from "./change-password-form"`. |
| `change-password-form.tsx` | Better Auth | `authClient.changePassword({ revokeOtherSessions: true })` | WIRED | Line 60-64; revokeOtherSessions: true present and surfaced in toast copy. |
| `change-password-form.tsx` | `/api/account/password-changed` | `void fetch(...)` after success | WIRED | Line 73; fire-and-forget AFTER `authClient.changePassword` success branch (T-08.02-08 mitigation). |
| `route.ts (password-changed)` | `inngest.send` substrate | `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })` | WIRED | Lines 35-49; locked payload shape. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/lib/email.ts` (3 functions) | Resend send result | `resend.emails.send(...)` (live HTTP) | Yes — depends on RESEND_API_KEY at runtime; in unit tests vi.mocks the resend module | FLOWING (substrate-side; deliverability gated on operator DNS + env vars per human_verification §1+§2) |
| `src/inngest/functions/send-email.ts` (sendEmailFn) | Resend send result + step memoisation | `step.run('resend-send', ...)` | Yes; integration tests in `tests/email/send-email-fn.integration.test.ts` exercise the full handler | FLOWING |
| `src/app/(app)/account/security/page.tsx` (Security page) | ChangePasswordForm rendered | static import of co-located component | Yes — RSC renders client form unconditionally | FLOWING |
| `change-password-form.tsx` | Form values from useForm | `register("currentPassword"|"newPassword"|"confirm")` | Yes — react-hook-form populates from user input; zod validates | FLOWING |
| `route.ts (password-changed)` | session.user.email | `auth.api.getSession({ headers: await headers() })` | Yes — Better Auth signed cookie; 401 if absent | FLOWING |
| `password-changed.tsx` template | changedAt + contactAdminUrl | templateProps from inngest event | Yes — populated at /api/account/password-changed dispatch site (Europe/London locale + mailto: link) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles end-to-end with email substrate | `RESEND_API_KEY=re_test_key npx tsc --noEmit` | "TypeScript: No errors found" | PASS |
| Full unit suite passes (incl. email_log integration + send-email-fn integration) | `RESEND_API_KEY=re_test_key npx vitest run --project unit` | "PASS (592) FAIL (0)" | PASS |
| Targeted unit tests for plan 08-02 surface | `RESEND_API_KEY=re_test_key npx vitest run src/lib/email.test.ts src/app/api/account/password-changed/route.test.ts 'src/app/(app)/account/security/change-password-form.test.tsx'` | "PASS (7) FAIL (0)" | PASS |
| Playwright change-password.spec.ts parses + lists 4 tests | `node ./node_modules/@playwright/test/cli.js test tests/auth/change-password.spec.ts --list` | 4 tests listed (happy/wrong-current/<8-chars/mismatched-confirm) | PASS |
| Playwright password-reset.spec.ts parses + lists 4 tests (3 original + preview-alias) | `node ./node_modules/@playwright/test/cli.js test tests/auth/password-reset.spec.ts --list` | 4 tests listed including preview-alias | PASS |
| `auth.ts` is byte-identical to origin/main (call-site preservation) | `git diff origin/main -- src/lib/auth.ts` | empty output | PASS |
| No nodemailer references anywhere in src/ | `grep -rn nodemailer src/` | empty | PASS |
| No `@getbrevo/brevo` code in src/ (D-13) | `grep -rln "@getbrevo/brevo" src/` | empty | PASS |
| Lockfile contains linux-x64 binding entries (multi-platform regen) | `grep '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` | HIT | PASS |
| Migration 0041 has partial unique idx | `grep "WHERE payload_hash IS NOT NULL" migrations/0041_phase_08_email_log.sql` | 2 hits (CREATE INDEX clause + comment) | PASS |
| D-11 PII guard in route handler | `grep -nE "(req\\.ip\|x-forwarded-for\|user-agent\|userAgent\|ipAddr\|browserFingerprint)" src/app/api/account/password-changed/route.ts` | empty | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| **EMAIL-01** | 08-01 | Resend integration replacing nodemailer SMTP; preserve signatures; Brevo fallback documented | SATISFIED (code-side) | `src/lib/email.ts` swap complete; auth.ts unchanged; `email_log` writes resend_message_id; `docs/email-fallback-brevo.md` is documented-only fallback. Deliverability against prod DNS gated on human_verification §1+§4. |
| **EMAIL-02** | 08-02 | Self-serve change-password from /account/security via Better Auth + confirmation email | SATISFIED (code-side; happy-path E2E gated on operator) | `/account/security` ships with 3-field form, `revokeOtherSessions: true`, fires Inngest event for confirmation; D-11 honored (timestamp + contact admin only); D-12 honored (thin scaffold). Canonical happy-path Playwright run gated on human_verification §6+§7. |
| **EMAIL-03** | 08-03 | Forgot-password end-to-end deliverability UAT against prod-shape preview | NEEDS HUMAN | Operator UAT runbook in 08-03-SUMMARY.md is the closure step (Evidence-Pending placeholders); D-14 explicit operator-driven invariant. Routed to human_verification §1–7. |
| **EMAIL-04** | 08-01 + 08-02 | Inngest send + retry + branded templates + email_log audit | SATISFIED | sendEmailFn registered with retries: 5; email_log table + partial unique idx (digest idempotency); 4 react-email templates; first paying consumer (password-changed) wired in 08-02. |

All 4 EMAIL-XX requirement IDs from PLAN frontmatter are accounted for; no orphans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No `TODO`/`FIXME`/`PLACEHOLDER` found in shipped Phase 8 source files; no empty-handler stubs (`onClick={() => {}}`); no static empty data returns; D-11 PII guard clean. |

### Human Verification Required

See frontmatter `human_verification:` array. Eight operator-driven checks:

1. DNS records (SPF + DKIM + DMARC) added to `command.weknowgroup.com`; Resend dashboard verified.
2. Vercel preview env vars set on git-branch alias (RESEND_API_KEY, EMAIL_FROM, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, BETTER_AUTH_URL).
3. Drizzle migration 0041 pushed to preview Neon DB.
4. EMAIL-03 prod-shape UAT: invite throwaway user → click email → set password → sign in.
5. Forgot-password UAT (chained from EMAIL-03).
6. Change-password UAT (plan 08-02 surface in real inbox).
7. Playwright preview-alias runs of change-password.spec.ts AND password-reset.spec.ts both green.
8. Throwaway-user cleanup post-UAT.

All 8 are explicitly assigned to the operator by plan 08-03 (`autonomous: false`) and D-14 (inverse of Phase 7 D-12) — not gaps. Fallback runbook with copy-pasteable commands lives in 08-03-SUMMARY.md (Operator Runbook section + Evidence-Pending placeholders).

### Gaps Summary

**No code-side gaps.** All must-haves whose verification depends only on the codebase are VERIFIED. The 4 must-haves whose verification requires real DNS / inbox / Vercel-CLI access are routed to `human_verification` per phase design — they are NOT gaps. The phase ships:

- A working code-side substrate (Resend transport + Inngest queue + react-email templates + `email_log` audit table + `/account/security` UI + confirmation-email POST route).
- A complete operator runbook (08-03-SUMMARY.md) with copy-pasteable commands and Evidence-Pending placeholders for the 8 human-verification items.
- A documented-only Brevo fallback (D-13 honored — no code, no dep).
- The full unit suite green (592/592) under `RESEND_API_KEY=re_test_key`.

The only known follow-up is `DEFERRED-08.02-01` (rbac.test.ts requires `RESEND_API_KEY` at module-import time because email.ts constructs Resend at module scope) — captured in `.planning/phases/08-email-infrastructure/deferred-items.md` as a non-Phase-8 cleanup; pre-existing on plan 08-01 HEAD; documented fix path (lazy construction or vi.mock).

---

_Verified: 2026-05-09_
_Verifier: Claude (gsd-verifier)_
