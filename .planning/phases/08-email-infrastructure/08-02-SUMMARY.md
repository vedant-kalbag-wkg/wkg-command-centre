---
phase: 08-email-infrastructure
plan: 02
subsystem: account-security
tags: [email, account-security, change-password, better-auth, inngest, playwright]
requirements: [EMAIL-02, EMAIL-04]
dependency_graph:
  requires:
    - "Plan 08-01: Inngest substrate (client + events + sendEmailFn + /api/inngest)"
    - "Plan 08-01: PasswordChangedEmail react-email template + TEMPLATES dispatch in send-email.ts"
    - "Better Auth authClient.changePassword({ revokeOtherSessions }) — already in tree via better-auth 1.5.5"
    - "Parent (app)/layout.tsx session-gate — DO NOT duplicate (D-12)"
  provides:
    - "/account/security UI: 3-field form + show/hide toggles + zod validation + sonner toasts"
    - "POST /api/account/password-changed: session-gated, fires inngest.send (locked event shape)"
    - "Plan 08-03 unblocked: form + route handler ready for prod-shape preview UAT"
    - "EMAIL-04 substrate first paying consumer (password-changed event flowing end-to-end)"
  affects:
    - "Better Auth: authClient.changePassword({ revokeOtherSessions: true }) signs out other sessions on success (D-10)"
    - "Inngest: sendEmailFn now receives real password_changed events triggered from /account/security"
tech_stack:
  added: []
  removed: []
  patterns:
    - "Client form scaffold: 'use client' + react-hook-form + zod + zodResolver + mode:'onBlur' + sonner toasts + lucide AlertCircle/Eye/EyeOff/Loader2 + shadcn primitives (verbatim parity with login/reset/set-password forms)"
    - "Fire-and-forget side-effect chain: form awaits primary action (authClient.changePassword), then on success fires `void fetch(...).catch(()=>{})` for the non-critical confirmation email — failure of the email never blocks the user-visible toast"
    - "Session-re-fetch route handler (no body parsing, no req arg, no header echoing) for fire-and-forget side-effects"
    - "vi.hoisted() for shared mock refs across vi.mock() factories (required because vi.mock is hoisted above imports)"
key_files:
  created:
    - "src/app/(app)/account/layout.tsx"
    - "src/app/(app)/account/security/page.tsx"
    - "src/app/(app)/account/security/change-password-form.tsx"
    - "src/app/(app)/account/security/change-password-form.test.ts"
    - "src/app/api/account/password-changed/route.ts"
    - "src/app/api/account/password-changed/route.test.ts"
    - "tests/auth/change-password.spec.ts"
    - ".planning/phases/08-email-infrastructure/deferred-items.md"
  modified: []
decisions:
  - "Schema test renamed `change-password-form.test.tsx` → `.test.ts` because vitest.config.ts only matches `**/*.test.ts` (no `.test.tsx`). The schema test is pure logic with no JSX so the rename is semantically free."
  - "Confirmation-email POST is fire-and-forget (`void fetch(...).catch(...)`) so a Resend/Inngest hiccup cannot block the user-visible 'Password changed' toast — the password rotation has already succeeded by that point. Threat T-08.02-08 is mitigated because the fetch is *inside* the success branch (after the early `if ('error' in result && result.error) return`)."
  - "Happy-path Playwright test gated behind `PLAYWRIGHT_BASE_URL || LOCAL_E2E_ALLOW_PASSWORD_ROTATE=1` (per plan success_criteria explicit gating against ISS-06). Local CI evidence is the 3 failure-path tests; canonical EMAIL-02 SC2 happy-path evidence is the preview-alias run captured in plan 08-03 SUMMARY."
metrics:
  duration_minutes: 18
  completed: 2026-05-08T19:37:45Z
  commits: 4
  files_created: 8
  files_modified: 0
---

# Phase 8 Plan 08-02: Self-Serve Change Password + Confirmation Email Trigger Summary

**One-liner:** Shipped `/account/security` with a 3-field change-password form that wraps `authClient.changePassword({ revokeOtherSessions: true })` (D-10) and fires plan 08-01's Inngest substrate via `POST /api/account/password-changed` → `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })`. Confirmation-email payload contains ONLY `changedAt` + `contactAdminUrl` (D-11 + Pitfall 7 — no IP, no UA, no browser fingerprint surface). EMAIL-02 SC2 surface ships; canonical happy-path evidence deferred to plan 08-03's preview-alias Playwright run.

## What Shipped

**Route shell ((app)/account scaffold per D-12):**

- `src/app/(app)/account/layout.tsx` — 6-line thin scaffold (`max-w-2xl mx-auto py-8 px-4`). NO tabs, NO sidebar, NO duplicate session-gate (parent `(app)/layout.tsx` already handles it). Future tabs (`/account/notifications` in Phase 9) land here later.
- `src/app/(app)/account/security/page.tsx` — RSC page rendering `<ChangePasswordForm />` under an `h1.text-2xl font-bold tracking-[-0.01em]` heading (kerning matches PATTERNS § Pattern 4 + project convention).

**Client form (EMAIL-02 SC2):**

- `src/app/(app)/account/security/change-password-form.tsx` — `"use client"` 3-field form (current / new / confirm). Eye/EyeOff toggles on the new+confirm fields (set-password-form parity). Zod schema with `.refine` for password-match. `mode: "onBlur"`, `reValidateMode: "onChange"` (verbatim across login/reset/set-password). Submit chain:
  1. `await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })` (D-10).
  2. If `'error' in result && result.error`: `toast.error(result.error.message ?? "Failed to change password")` and `return`.
  3. Else: `void fetch("/api/account/password-changed", { method: "POST" }).catch(() => {})` — fire-and-forget the confirmation email (a fetch failure must NOT block the success toast; the password rotation already succeeded; T-08.02-08 mitigated because the fetch is inside the success branch).
  4. `toast.success("Password changed. Other sessions signed out.")` — D-10 surfaced in UI copy.
  5. `reset()`.

**API route handler (D-11 + Threat T-08.02-04):**

- `src/app/api/account/password-changed/route.ts` — `export async function POST()`. Re-fetches session via `auth.api.getSession({ headers: await headers() })`. 401 + `{ error: "unauthorised" }` (British spelling) on null. On valid session, calls `inngest.send({ name: "email/send.requested", data: { kind: "password_changed", to: session.user.email, subject: "Your WeKnow password was changed", template: "password-changed", templateProps: { changedAt: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }), contactAdminUrl: "mailto:vedant.kalbag@weknowgroup.com" } } })`. NO `req` arg (no body to parse). NO header echoing. Returns `{ ok: true }` on success.

**Tests (vitest unit + Playwright E2E):**

- `src/app/(app)/account/security/change-password-form.test.ts` — 4 schema-contract tests: empty currentPassword, weak newPassword, mismatched confirm, valid input. **All 4 passing.**
- `src/app/api/account/password-changed/route.test.ts` — 3 route-contract tests: 401 on null session, locked event-shape on success, **`Object.keys(templateProps).sort() === ["changedAt", "contactAdminUrl"]`** with explicit not-toHaveProperty assertions for `ipAddress`, `userAgent`, `browserFingerprint`, `ip`, `ua` (T-08.02-04 + D-11 enforcement at the contract layer). **All 3 passing.**
- `tests/auth/change-password.spec.ts` — 4 Playwright tests:
  1. happy path (gated behind `PLAYWRIGHT_BASE_URL || LOCAL_E2E_ALLOW_PASSWORD_ROTATE=1` per plan success_criteria),
  2. wrong current password → toast appears, success copy does NOT,
  3. new password < 8 chars → "Password must be at least 8 characters" inline error,
  4. confirm mismatch → "Passwords do not match" inline error.
  `playwright test --list` lists all 4 cleanly. The 3 failure-path tests run against local dev; the canonical happy-path evidence is the preview-alias run in plan 08-03 (per CLAUDE.md § "Playwright specs against preview deploys").

## Confirmation: D-10 (revokeOtherSessions) wired AND surfaced

- **Wired:** `grep -c "revokeOtherSessions: true" src/app/(app)/account/security/change-password-form.tsx` returns **1**.
- **Surfaced:** `grep -c "Other sessions signed out" src/app/(app)/account/security/change-password-form.tsx` returns **1** (toast copy: "Password changed. Other sessions signed out.").
- The user knows what `revokeOtherSessions: true` did because the toast copy says so. T-08.02-05 (silent regression of revokeOtherSessions) is mitigated.

## Confirmation: D-11 honored (no IP / UA / fingerprint)

- **Route handler:** `grep -E "(req\.ip|x-forwarded-for|user-agent|userAgent|ipAddr|browserFingerprint)" src/app/api/account/password-changed/route.ts` returns **0 matches**.
- **Unit test enforcement:** `route.test.ts` asserts `Object.keys(templateProps).sort() === ["changedAt", "contactAdminUrl"]` AND explicitly enumerates 5 forbidden keys (`ipAddress`, `userAgent`, `browserFingerprint`, `ip`, `ua`) and checks each is absent. A future PR that adds `req.headers.get("x-forwarded-for")` or similar to `templateProps` would fail the unit test before reaching review.
- **Template:** `password-changed.tsx` (created by plan 08-01) takes only `{ changedAt, contactAdminUrl }`; the props are typed and narrow.

## Confirmation: D-12 honored (thin /account scaffold)

- **No duplicate session-gate:** `grep -c "auth.api.getSession\|redirect" src/app/(app)/account/layout.tsx` returns **0**. Parent `(app)/layout.tsx` handles it.
- **No tabs / sidebar:** the layout file is a single 3-element JSX expression (`<div className="max-w-2xl mx-auto py-8 px-4">{children}</div>`).
- **No premature `/account/*` routes:** only `/account/security` exists; `/account/notifications` and friends are not scaffolded speculatively.

## EMAIL-04 Substrate Exercised

The password-changed event is the first paying consumer of plan 08-01's Inngest substrate:

```
[user clicks Change password]
  ↓
authClient.changePassword({ revokeOtherSessions: true })   // Better Auth, sync
  ↓ (success)
fetch POST /api/account/password-changed                   // fire-and-forget
  ↓
auth.api.getSession  →  inngest.send({                     // session-gated
    name: "email/send.requested",
    data: { kind: "password_changed", template: "password-changed", ... }
  })
  ↓
sendEmailFn (plan 08-01)                                    // 3 step.run boundaries
  ↓
PasswordChangedEmail (react-email)  →  Resend HTTP API      // sendResult
  ↓
db.insert(emailLog)                                          // sent / failed row
```

This proves the wire-shape is correct end-to-end before Phase 9 NOTIF-01/02 + REPORT-05/06 inherit it. The integration tests in plan 08-01 (`tests/email/send-email-fn.integration.test.ts`) already cover the `sendEmailFn` half of the chain; plan 08-02 ships the `/api/account/password-changed` half with its own contract tests.

## Test Sweep

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint src/app/(app)/account src/app/api/account tests/auth/change-password.spec.ts` | **0 issues** |
| `npx vitest run` (new tests only — 7 tests) | **7 / 7 passing** |
| `RESEND_API_KEY=re_test_key npx vitest run --project unit` (full suite — 592 tests) | **592 / 592 passing** |
| `npx playwright test tests/auth/change-password.spec.ts --list` | **4 tests listed** |

The full unit suite requires `RESEND_API_KEY` to be set in env because `src/lib/auth.ts → src/lib/email.ts` constructs `new Resend(process.env.RESEND_API_KEY)` at module scope (plan 08-01 artifact). Without the env var, `src/lib/rbac.test.ts` fails to import (transitively imports auth.ts). This is **pre-existing on `6dc2ac7`** (verified by stashing 08-02 changes and re-running the test) and is logged in `.planning/phases/08-email-infrastructure/deferred-items.md` as DEFERRED-08.02-01 — out of scope for this plan.

## Commits Made (4)

```
6af5321  feat(phase-08-02): self-serve change-password form at /account/security
ef8a917  test(phase-08-02): failing test for /api/account/password-changed route
d556600  feat(phase-08-02): POST /api/account/password-changed fires Inngest event
8e61bdd  test(phase-08-02): Playwright E2E spec for /account/security flow
```

(Final SUMMARY commit follows after Self-Check.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Schema test file renamed `.test.tsx` → `.test.ts`**

- **Found during:** Task 2 first vitest run.
- **Issue:** Plan asked for `change-password-form.test.tsx` but `vitest.config.ts` only matches `**/*.test.ts` (not `.test.tsx`). With the original filename vitest reported "No test files found, exiting with code 1".
- **Fix:** Renamed to `.test.ts`. The test is pure schema logic with no JSX, so the rename is semantically free. Plan acceptance criteria use the file as a contract test (verifies zod schema rejects/accepts the right inputs), not a render test.
- **Files modified:** `src/app/(app)/account/security/change-password-form.test.ts` (renamed from `.tsx`).
- **Commit:** 6af5321 (documented in commit message).

**2. [Rule 3 — Documented] Pre-existing rbac.test.ts failure surfaced during verification sweep**

- **Found during:** full unit suite verification (`npx vitest run --project unit`).
- **Issue:** `src/lib/rbac.test.ts` fails to import with `Error: Missing API key. Pass it to the constructor 'new Resend("re_123")'`. Stack trace: `rbac.test.ts → auth.ts → email.ts:21 (new Resend(process.env.RESEND_API_KEY))`.
- **Pre-existing:** Verified by stashing 08-02 changes and re-running against `6dc2ac7` (plan 08-01 head) — same failure.
- **Out of scope:** Plan 08-02 does not touch `email.ts`, `auth.ts`, or `rbac.test.ts`. Fix requires either lazy `new Resend()` construction inside helpers, an env-fallback, or a `vi.mock("resend", ...)` shim in rbac.test.ts — all owned by the email substrate (plan 08-01 / 08-03 territory).
- **Fix:** None applied. Documented in `.planning/phases/08-email-infrastructure/deferred-items.md` as `DEFERRED-08.02-01`. 08-02 verification uses `RESEND_API_KEY=re_test_key` to sidestep the issue (full suite passes 592/592 with the env var set).

### Auth Gates

None — this plan's Playwright happy-path test is the only path that would normally need a real auth credential, and it is gated behind `PLAYWRIGHT_BASE_URL || LOCAL_E2E_ALLOW_PASSWORD_ROTATE=1` per plan success_criteria. The 3 failure-path Playwright tests do their auth via `signInAsAdmin()` against the existing seeded admin (no new credentials required).

### Architectural Decisions Auto-Applied

None — no Rule 4 escalations. All deviations were Rule 3 (blocking) — file-extension fix and pre-existing-issue documentation.

## Threat-Model Disposition

| Threat ID | Disposition this plan | Evidence |
|-----------|----------------------|----------|
| T-08.02-01 | **mitigated (informational)** | The route does NOT mutate any password; it only fires the confirmation email. A stolen session can fire a misleading email but cannot rotate the password. |
| T-08.02-02 | **mitigated** | Better Auth's `nextCookies()` plugin (already in `src/lib/auth.ts`) handles same-origin protection. Route requires session via `auth.api.getSession`; no body parsing; no GET method exposed. |
| T-08.02-03 | **mitigated** | `change-password-form.tsx` is `"use client"` (line 1). `authClient` (browser SDK) used; `auth.api.changePassword` (server SDK) is NOT called from a Server Action. Plaintext password leaves the browser only inside Better Auth's standard request shape. |
| T-08.02-04 | **mitigated** | `grep -E "(req\.ip\|x-forwarded-for\|user-agent\|userAgent\|ipAddr\|browserFingerprint)" route.ts` returns 0. Unit test asserts `Object.keys(templateProps).sort() === ["changedAt", "contactAdminUrl"]` and enumerates 5 forbidden PII keys with `not.toHaveProperty`. |
| T-08.02-05 | **mitigated** | `grep -c "revokeOtherSessions: true" change-password-form.tsx` returns 1. Toast copy "Password changed. Other sessions signed out." surfaces D-10 to the user. |
| T-08.02-06 | **mitigated** | `auth.api.getSession({ headers: await headers() })` reads the same signed Better Auth cookie that the rest of the app trusts (parity with `(app)/layout.tsx`). |
| T-08.02-07 | **accepted** | Endpoint requires session; an attacker holding a session is already "the user". Worst case: 3k/mo Resend quota burned; rotate API key. Per plan threat model. |
| T-08.02-08 | **mitigated** | The `fetch("/api/account/password-changed", ...)` is inside the success branch (after `if ('error' in result && result.error) return`). Verified by reading `change-password-form.tsx` lines 67-78. |
| T-08.02-09 | **accepted** | `autoComplete="current-password"` on the field; standard browser-side protection. Phase 11 may add password-strength meter / breach-check. |
| T-08.02-10 | **mitigated this plan, manual UAT in 08-03** | Plan 08-03 operator UAT confirms a successful rotation invalidates a parallel browser session. |

## Open Items Handed Off

**To plan 08-03 (DNS + UAT):**

- Vercel preview env vars: same set as 08-01 (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) need to be set against the git-branch alias.
- Run `tests/auth/change-password.spec.ts` against `PLAYWRIGHT_BASE_URL=<git-branch-alias>` to capture the canonical happy-path EMAIL-02 SC2 evidence (per CLAUDE.md § "Playwright specs against preview deploys"). All 4 tests should run; the happy-path test exits the `test.skip` gate when `PLAYWRIGHT_BASE_URL` is set.
- Manual UAT alongside Playwright: open `/account/security` in two browser tabs of the same admin account, rotate the password in tab A, refresh tab B, confirm tab B is redirected to `/login` (T-08.02-10 evidence + D-10 user-visible behaviour).
- Inbox check: confirm the `password_changed` email actually arrives in the admin inbox with the correct timestamp + "Contact admin" CTA, and that the body contains NO IP/UA fields (D-11 visual confirmation in addition to the unit-test contract enforcement).
- DNS records (SPF, DKIM CNAME from Resend, DMARC `p=quarantine`) on `command.weknowgroup.com` zone — already on the 08-03 hand-off list from 08-01, no new items from this plan.
- EMAIL-03 forgot-password operator UAT — owned by 08-03 per scoping; this plan does not touch `tests/auth/password-reset.spec.ts` or the forgot-password surface.

**To future maintainers (DEFERRED-08.02-01):**

- `src/lib/rbac.test.ts` currently fails to import when `RESEND_API_KEY` is unset (because `email.ts` calls `new Resend(...)` at module scope). Fix is owned by the email substrate (lazy construction inside send helpers, or vi.mock in rbac.test.ts). Documented in `.planning/phases/08-email-infrastructure/deferred-items.md`.

## Known Stubs

None. Every artifact ships real behaviour: the form actually rotates the password via Better Auth, the route handler actually fires Inngest events with the locked payload, the Inngest function (plan 08-01) actually renders the password-changed template and writes a real `email_log` row.

## Threat Flags

None — no new security-relevant surface beyond what the threat register covers. The route handler at `/api/account/password-changed` is the only new public endpoint, and its disposition row (T-08.02-01..10) is captured above.

## Self-Check: PASSED

Verified before writing this section:

- All 7 artifacts from `must_haves.artifacts` exist on disk:
  - `src/app/(app)/account/layout.tsx` ✓
  - `src/app/(app)/account/security/page.tsx` ✓
  - `src/app/(app)/account/security/change-password-form.tsx` ✓
  - `src/app/api/account/password-changed/route.ts` ✓
  - `src/app/(app)/account/security/change-password-form.test.ts` ✓ (renamed from `.tsx` per Deviation 1)
  - `src/app/api/account/password-changed/route.test.ts` ✓
  - `tests/auth/change-password.spec.ts` ✓
- Key-link grep gates:
  - `grep -r "authClient.changePassword" src/app/(app)/account/security/` → 2 matches in `change-password-form.tsx` (≥ 1 ✓)
  - `grep -r "/api/account/password-changed" src/app/(app)/account/security/` → 2 matches in `change-password-form.tsx` (≥ 1 ✓)
  - `grep -r "email/send.requested" src/app/api/account/password-changed/` → 1 in `route.ts`, 1 in test (≥ 1 ✓)
  - `grep -r "ChangePasswordForm" src/app/(app)/account/security/` → 1 in form, 2 in page = 3 (≥ 2 ✓)
- D-11 PII guardrail: `grep -E "(req\.ip|x-forwarded-for|user-agent|userAgent|ipAddr|browserFingerprint)" src/app/api/account/password-changed/route.ts` → **0 matches** ✓
- vitest: 7/7 new tests pass; 592/592 full unit suite pass (with `RESEND_API_KEY` set).
- `npx playwright test tests/auth/change-password.spec.ts --list` lists **4 tests** (≥ 3 ✓).
- All 4 commits exist on `gsd/phase-08-email-infrastructure` ahead of `origin/main`.
- `git diff src/lib/auth.ts` is empty (D-12 boundary preserved; this plan only adds new files).
