# Phase 8 — Deferred items

Items discovered during plan execution that are out of scope for the
current plan. Each entry names the discovering plan, the file/symbol,
and the reason for deferral.

---

## DEFERRED-08.02-01 — `src/lib/rbac.test.ts` fails when `RESEND_API_KEY` unset

- **Discovered during:** plan 08-02 verification sweep (`vitest run --project unit`).
- **Symptom:** `src/lib/rbac.test.ts` fails to import with
  `Error: Missing API key. Pass it to the constructor 'new Resend("re_123")'`.
  Stack trace: `src/lib/rbac.test.ts → src/lib/auth.ts → src/lib/email.ts:21
  (new Resend(process.env.RESEND_API_KEY))`.
- **Root cause:** Plan 08-01's `src/lib/email.ts` rewrite calls `new Resend(...)`
  at module scope. When the env var is unset, the constructor throws on import.
  Tests that don't directly use email.ts (e.g. rbac.test.ts) still trip this
  because they import auth.ts, which imports email.ts.
- **Pre-existing:** Verified by stashing all 08-02 changes and running the test
  against `6dc2ac7` (plan 08-01 HEAD) — same failure. Not introduced by 08-02.
- **Out of scope for 08-02:** Plan 08-02 does not touch `src/lib/email.ts`,
  `src/lib/auth.ts`, or `src/lib/rbac.ts`. Fixing this requires either
  (a) lazy `new Resend(...)` inside the send helpers, (b) injecting a fallback
  test-mode API key in `src/lib/email.ts`, or (c) `vi.mock("resend", ...)`
  in `rbac.test.ts` — all of which belong to a follow-up plan owned by
  the email substrate.
- **Workaround for 08-02 verification:** Run vitest with
  `RESEND_API_KEY=re_test_key` set in the environment, or scope to the new
  test files only (`vitest run 'src/app/(app)/account/security/...' 'src/app/api/account/password-changed/...'`).
- **Suggested fix plan:** 08-03 owner can address by lazily constructing the
  Resend client inside each send helper (deferred construction is the
  conventional fix for SDK-clients-with-env-deps in test environments).
