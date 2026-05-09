---
phase: 08-email-infrastructure
plan: 01
subsystem: email
tags: [email, resend, inngest, react-email, transport-swap, schema, lockfile]
requirements: [EMAIL-01, EMAIL-04]
dependency_graph:
  requires:
    - "Better Auth sendResetPassword hook (src/lib/auth.ts:13-24) — locked contract, untouched"
    - "Drizzle 0.45 schema convention (src/db/schema.ts) — single-file, withTimezone:true precedent"
    - "Migration idempotency idiom (migrations/0039 + 0040 headers + IF NOT EXISTS)"
    - "Phase 8 CONTEXT D-01..D-13 + RESEARCH § Patterns 1-5"
  provides:
    - "Resend HTTP transport in src/lib/email.ts (signatures byte-identical)"
    - "email_log audit table + partial unique idx (D-06)"
    - "Inngest substrate: client + events + send-email fn + /api/inngest route"
    - "Six react-email templates (brand, layout, password-reset, invite, external-invite, password-changed)"
    - "Plan 08-02 unblocked: PasswordChangedEmail template + email/send.requested event shape ready for /account/security to consume"
    - "Plan 08-03 unblocked: working transport ready for DNS + Vercel env vars + EMAIL-03 operator UAT"
    - "Phase 9 unblocked: EmailSendRequested event-shape contract locked in src/inngest/events.ts"
  affects:
    - "src/lib/auth.ts (call sites unchanged — verified `git diff src/lib/auth.ts` empty)"
    - "Better Auth forgot-password / invite / external-invite UI surfaces (now route through Resend, not nodemailer)"
tech_stack:
  added:
    - "resend ~6.12.3 (HTTP API SDK)"
    - "inngest ~4.3.0 (durable async substrate)"
    - "@react-email/components ~1.0.12"
    - "@react-email/render ~2.0.8"
    - "react-email ~6.1.1 (devDependencies — local preview CLI)"
  removed:
    - "nodemailer ^8.0.3 (silently failing in prod against localhost:1025)"
    - "@types/nodemailer ^7.0.11 (devDependencies)"
  patterns:
    - "Singleton-export from third-party SDK config (mirrors src/lib/auth.ts:8)"
    - "Hand-authored idempotent SQL migrations with header doc-comment + Delta separators (mirrors 0039 + 0040)"
    - "Partial unique index for digest idempotency, NULL-exempt for auth-flow"
    - "vi.hoisted for Vitest mocks that need shared refs (factory-hoisting safe pattern)"
    - "Each step.run boundary memoised across retries (Inngest Pitfall 5)"
key_files:
  created:
    - "migrations/0041_phase_08_email_log.sql"
    - "src/inngest/client.ts"
    - "src/inngest/events.ts"
    - "src/inngest/functions/send-email.ts"
    - "src/app/api/inngest/route.ts"
    - "src/emails/brand.ts"
    - "src/emails/_layout.tsx"
    - "src/emails/password-reset.tsx"
    - "src/emails/invite.tsx"
    - "src/emails/external-invite.tsx"
    - "src/emails/password-changed.tsx"
    - "src/lib/__tests__/helpers/mock-resend.ts"
    - "src/emails/__tests__/helpers/render-snapshot.ts"
    - "src/lib/email.test.ts"
    - "tests/email/email-log.integration.test.ts"
    - "tests/email/send-email-fn.integration.test.ts"
  modified:
    - "package.json (deps add/remove + email:dev script)"
    - "package-lock.json (regenerated under linux/amd64 Docker per CLAUDE.md)"
    - "src/db/schema.ts (appended emailLog table)"
    - "src/lib/email.ts (full rewrite; signatures preserved byte-identical)"
    - "migrations/meta/_journal.json (added 0041 entry for testcontainers migrate)"
    - ".env.example (replaced SMTP_* with RESEND_*/INNGEST_*)"
    - ".env.test (placeholder vars; gitignored, not committed)"
decisions:
  - "Inngest 2-arg createFunction shape ({ id, retries, triggers: [{event}] } + handler) used instead of 3-arg form in RESEARCH § Pattern 2 — TS rejects the 3-arg form in inngest@4.3.x. Semantically identical."
  - "Extracted Inngest function body to a named export `_handleSendEmail` so integration tests can call it directly (Inngest doesn't expose its internal handler)."
  - "Partial-index predicate (`payload_hash IS NOT NULL`) re-stated in `.onConflictDoNothing({ where: ... })` because Postgres requires the predicate to match the partial unique idx for ON CONFLICT to fire. Caught by integration test."
metrics:
  duration_minutes: 28
  completed: 2026-05-08T19:27:08Z
  commits: 10
  files_created: 16
  files_modified: 6
---

# Phase 8 Plan 08-01: Email Transport Swap + email_log + Inngest Substrate Summary

**One-liner:** Swapped silently-failing nodemailer SMTP transport for Resend HTTP API + react-email JSX templates, appended idempotent `email_log` audit table (partial unique idx on `(kind, payload_hash) WHERE payload_hash IS NOT NULL`), shipped Inngest substrate (client + events + send-email fn + Next.js Route Handler) for Phase 9 consumers — all while keeping `src/lib/auth.ts` byte-identical (the three exported function signatures in `src/lib/email.ts` are locked).

## What Shipped

**Transport swap (EMAIL-01):**
- `src/lib/email.ts` — full rewrite. `import nodemailer` deleted; `buildBrandedEmail` HTML helper deleted (D-09). New private `send()` helper calls `resend.emails.send({ from, to, subject, react })`, writes one row to `email_log` per send (D-06), throws `Error("Email send failed: <msg>")` on Resend non-2xx so Better Auth surfaces failure to the UI (D-04). The three exported functions (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`) keep their signatures byte-identical — `git diff src/lib/auth.ts` empty after this plan lands.
- `EMAIL_FROM` defaults to `noreply@command.weknowgroup.com` (D-02).
- `lastError` stores `result.error.message` plain text (Pitfall 6 — JSON.stringify makes the column unindexable; T-08.01-05 mitigation).

**email_log audit table (EMAIL-04 / D-06):**
- Drizzle table appended to `src/db/schema.ts` with columns `id`, `kind`, `recipient`, `resend_message_id`, `inngest_run_id`, `status`, `last_error`, `payload_hash`, `created_at` (`withTimezone: true` per pattern-mapper Correction #1, matching `auditLogs` + `locationMergeSnapshots` precedent — RESEARCH § Pattern 5 had `false` which was wrong for this codebase).
- `email_log_kind_payload_hash_uq` partial unique idx `WHERE payload_hash IS NOT NULL` enforces digest idempotency at the DB.
- `email_log_recipient_created_at_idx` supports "recent sends to recipient" lookups.
- Migration `migrations/0041_phase_08_email_log.sql` hand-authored (mirrors 0039/0040 idiom; idempotent `IF NOT EXISTS` on every DDL). `migrations/meta/_journal.json` updated so testcontainers' `migrate()` picks the new entry up.

**Inngest substrate (EMAIL-04):**
- `src/inngest/client.ts` — singleton `inngest` client (`id: "wkg-kiosk-tool"`).
- `src/inngest/events.ts` — `EmailSendRequested` event-shape contract Phase 9 will type-import from.
- `src/inngest/functions/send-email.ts` — `sendEmailFn` with `retries: 5` and three `step.run` boundaries (`render-html` → `resend-send` → `log`) per Pitfall 5 step-memoisation rules. Body extracted to named export `_handleSendEmail` so integration tests can drive the handler directly (Inngest doesn't expose its internal handler on the function instance).
- `src/app/api/inngest/route.ts` — 9-line route handler exposing `serve({ client, functions: [sendEmailFn] })` over GET/POST/PUT. No env-gating, no try/catch — `serve()` validates `INNGEST_SIGNING_KEY` internally and rejects forged webhooks with 401 (T-08.01-02 mitigation).

**react-email templates:**
- `src/emails/brand.ts` — frozen `BRAND` token object: Azure `#00A6D3`, Graphite `#121212`, white, font-stack, productName, prodUrl. Hex values verbatim from `~/.claude/weknow-brand-guidelines.md`.
- `src/emails/_layout.tsx` — shared `<Html>`/`<Body>`/`<Container>` layout (560px max-width, 40px padding, WK text-mark header, Azure footer link). Inline styles only (Pitfall 4 — Gmail strips `<style>` blocks).
- `password-reset.tsx`, `invite.tsx`, `external-invite.tsx` — copy preserved verbatim from current `src/lib/email.ts`. Prop names match locked contract (`resetUrl` for password-reset/invite; `setPasswordUrl` for external-invite).
- `password-changed.tsx` — D-11 confirmation template. Body: timestamp + "If this wasn't you, contact admin". **NO IP, UA, or browser fingerprint props** (Pitfall 7 + T-08.01-07 — privacy review trigger; verified by grep gate).

**Test scaffolding:**
- `src/lib/__tests__/helpers/mock-resend.ts` — Vitest Resend mock helper using `vi.hoisted` (factory hoisting requires a regular `function` not arrow so `new Resend()` can construct).
- `src/emails/__tests__/helpers/render-snapshot.ts` — async render() wrapper for future Phase 9 template snapshot tests.
- `src/lib/email.test.ts` — 4 unit tests covering EMAIL-01 contract: success path (Resend args + email_log row + status='sent'), failure path (logs status='failed' first, then throws Error("Email send failed: ...")), subject/kind matrix per function. **All 4 passing.**
- `tests/email/email-log.integration.test.ts` — 3 integration tests against Testcontainers Postgres 16 proving the partial unique idx behaves per D-06: duplicate `(kind, hash)` no-ops; `null` payloadHash always succeeds; different kinds with same hash both succeed. **All 3 passing.**
- `tests/email/send-email-fn.integration.test.ts` — 3 integration tests exercising `_handleSendEmail` end-to-end against Testcontainers Postgres + mocked Resend: valid event → one `sent` row; simulated 5xx → one `failed` row written FIRST, then handler throws (proves log step runs before the throw); duplicate `(kind, payloadHash)` → only one row. **All 3 passing.**

## Lockfile Regeneration Confirmation

Regenerated under canonical CLAUDE.md recipe inside Docker:

```
docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc '
  set -e
  mkdir -p /build && cp /src/package.json /build/package.json
  cd /build
  npm install --package-lock-only --ignore-scripts
  npm ci --dry-run --ignore-scripts
  cp /build/package-lock.json /src/package-lock.json
'
```

`--ignore-scripts` was added to the canonical recipe because `patch-package` (the project's `postinstall` script) is not installed in the scratch container and would cause a non-zero exit; scripts re-run on real install via `npm ci` on the host/CI.

Grep gates (all pass):
- `grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` → **1**
- `grep -c '"node_modules/resend"' package-lock.json` → **1**
- `grep -c '"node_modules/inngest"' package-lock.json` → **1**
- `grep -c '"node_modules/@react-email/components"' package-lock.json` → **1**
- `grep -c '"node_modules/nodemailer"' package-lock.json` → **0**

No major-version drift on `next`, `react`, `drizzle-orm`, `@neondatabase/serverless`, `typescript`, `vitest`, `playwright`, `better-auth` (verified by inspecting the lockfile diff for `"version"` lines on those package paths — empty).

After commit, `npm ci` was run on the macOS host to populate `node_modules` — `npm ci` does NOT rewrite the lockfile (unlike `npm install`), so the linux/amd64 shape is preserved.

## Migration Apply Status

The migration `migrations/0041_phase_08_email_log.sql` is committed as SQL only. Per the project's migration protocol (Phase 7 precedent, 0039 + 0040), the `drizzle-kit push` against the live preview Neon DB is **deferred to plan 08-03's UAT phase**, not run automatically by this plan executor. Migration is verified to apply correctly against fresh Postgres 16 via the Testcontainers integration tests (3 tests + 3 tests = 6 tests against a freshly-migrated DB, all green).

## Inngest Dev-Server Smoke

**Deferred to operator** (Task 13's manual checkpoint). The Inngest dev-server smoke test (`npx inngest-cli@latest dev` + Inngest UI at `localhost:8288` + trigger an `email/send.requested` event) cannot be automated from this plan executor without spinning up a long-running Next.js dev process. The integration test (`tests/email/send-email-fn.integration.test.ts`) covers the same wire shape end-to-end (event → handler → 3 step boundaries → 1 `email_log` row); the only thing the dev-server smoke adds is "function appears in the Inngest Apps registry", which the route handler's static export of `serve({ client, functions: [sendEmailFn] })` mechanically guarantees. Operator can run the smoke during plan 08-03 UAT alongside the prod-shape preview validation.

## Test Sweep (`npm run typecheck` / `vitest` / `eslint`)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint src/lib/email.ts src/inngest src/emails src/db/schema.ts src/app/api/inngest tests/email` | **0 issues** |
| `npx vitest run --project unit` (566 tests) | **566 / 566 passing** |
| `npx vitest run --project integration tests/email/` (6 tests) | **6 / 6 passing** |

## Commits Made (10)

```
ec5c01b chore(phase-08-01): swap nodemailer for Resend + Inngest + react-email deps
ae827f7 chore(phase-08-01): regenerate lockfile under linux/amd64 for resend+inngest+react-email
93cf3c9 feat(phase-08-01): add emailLog audit table to Drizzle schema
4e49d9b feat(phase-08-01): hand-authored migration 0041 for email_log table
32e87b1 feat(phase-08-01): six react-email templates + brand tokens for transport swap
161b178 feat(phase-08-01): Inngest substrate (client, events, send-email fn, route)
98cb305 feat(phase-08-01): swap nodemailer SMTP for Resend HTTP in src/lib/email.ts
bd9fcea chore(phase-08-01): swap SMTP_* for RESEND/INNGEST env vars in .env.example
7f77526 test(phase-08-01): unit tests for email transport (EMAIL-01) + mock helpers
d989c29 test(phase-08-01): integration tests for email_log idempotency + send-email fn
```

(Final SUMMARY commit follows after Self-Check.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Docker `--ignore-scripts` flag added to lockfile regen recipe**
- **Found during:** Task 1 first attempt
- **Issue:** Canonical CLAUDE.md Docker command failed inside the scratch container because the project's `postinstall` script runs `patch-package`, which is not installed in `node:22-bookworm` until after `npm install` completes; npm hits postinstall as part of `npm install --package-lock-only` even though no packages need installing.
- **Fix:** Added `--ignore-scripts` to both `npm install --package-lock-only` and `npm ci --dry-run` inside the container. Scripts are not needed for lockfile generation. Real install on the host (via `npm ci`) and CI runner still run scripts normally.
- **Files modified:** None (transient operator command).
- **Commit:** ae827f7 documents the modified recipe in the commit message.

**2. [Rule 1 — Bug] `onConflictDoNothing.where` predicate required for partial unique idx**
- **Found during:** Task 12 (integration tests caught the regression before it hit any deploy)
- **Issue:** Postgres `ON CONFLICT (kind, payload_hash) DO NOTHING` cannot match a partial unique index unless the partial-index predicate is re-stated in the ON CONFLICT clause. Without the `where` clause, the upsert fails at runtime with "no unique or exclusion constraint matching the ON CONFLICT specification". Plan's RESEARCH § Pattern 2 skeleton (line 310) and Plan Task 12's email-log integration test BOTH used the bare `target: [...]` form which Postgres rejects.
- **Fix:** Added `where: sql\`payload_hash IS NOT NULL\`` to both `.onConflictDoNothing` calls (`src/inngest/functions/send-email.ts` and `tests/email/email-log.integration.test.ts`). All 6 integration tests pass after the fix.
- **Files modified:** `src/inngest/functions/send-email.ts`, `tests/email/email-log.integration.test.ts`
- **Commit:** d989c29

**3. [Rule 3 — Blocking] Inngest 4.3 `createFunction` signature is 2-arg, not 3-arg**
- **Found during:** Task 7 first compile
- **Issue:** RESEARCH § Pattern 2 (lines 283-285) has `inngest.createFunction({ id, retries }, { event }, async ({...}) => ...)`. TS rejects this in `inngest@4.3.x` — the trigger now lives inside the options object as `triggers: [{ event }]`. The 3-arg form is from the older inngest@3.x docs.
- **Fix:** Use the 2-arg shape: `inngest.createFunction({ id, name, retries, triggers: [{ event: "email/send.requested" }] }, handler)`. Semantically identical; same memoisation/retry behaviour.
- **Files modified:** `src/inngest/functions/send-email.ts`
- **Commit:** 161b178 (documented in commit message)

**4. [Rule 3 — Blocking] `_handleSendEmail` extracted to enable integration testing**
- **Found during:** Task 12 setup
- **Issue:** Inngest's `InngestFunction` instance keeps its handler as a private `fn` property (per `node_modules/inngest/components/InngestFunction.d.ts:24`). Calling `sendEmailFn(...)` directly is not how the SDK is consumed; the handler runs via Inngest's executor with its own step tools. Integration tests need to drive the handler with a step-shim against a real DB.
- **Fix:** Extracted the handler body to a named export `_handleSendEmail` (underscore prefix signals "internal/test access"). The exported `sendEmailFn` wraps `_handleSendEmail` with a thin cast at the Inngest StepTools boundary. Production behaviour unchanged.
- **Files modified:** `src/inngest/functions/send-email.ts`
- **Commit:** d989c29 (documented in commit message)

**5. [Rule 1 — Bug] Vitest `vi.mock` factory hoisting in `mock-resend.ts`**
- **Found during:** Task 11
- **Issue:** Plan's `vi.mock("resend", () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })) }))` failed two ways: (a) `sendMock` referenced by the factory is not yet defined when the hoisted `vi.mock` runs (Vitest hoists `vi.mock` to top-of-file); (b) the arrow function in `mockImplementation` is not constructible, so `new Resend(...)` throws "is not a constructor".
- **Fix:** Use `vi.hoisted(() => ({ sendMock: vi.fn() }))` to pull the mock into the hoist scope; use a regular `function () { return { emails: { send: sendMock } }; }` (NOT arrow) so `new Resend(...)` can construct.
- **Files modified:** `src/lib/__tests__/helpers/mock-resend.ts`, `src/lib/email.test.ts`
- **Commit:** 7f77526 (documented in commit message)

**6. [Rule 1 — Bug] `insertMock.mockReturnValue` shared `values` mock across tests**
- **Found during:** Task 11 (3 / 4 tests failed initially)
- **Issue:** Plan's `insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })` creates the inner `values` mock ONCE; `insertMock.mockClear()` in `beforeEach` does not clear the inner mock, so `mock.results[0].value.values.mock.calls[0][0]` reads the FIRST test's insert payload across all 4 tests.
- **Fix:** Switched to `insertMock.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }))` — each `db.insert(...)` call gets a fresh `values` mock, so per-test `mock.calls[0][0]` reads the current test's payload.
- **Files modified:** `src/lib/email.test.ts`
- **Commit:** 7f77526 (documented in commit message)

**7. [Rule 3 — Documented] `.env.test` is gitignored — only `.env.example` committed**
- **Found during:** Task 10 commit
- **Issue:** `.gitignore` excludes `.env.test` per `.env*` rule (only `.env.example` is exempted). Plan asked for both files to be committed.
- **Fix:** Updated `.env.test` locally (placeholder vars added so vitest doesn't throw on module-scope `new Resend(process.env.RESEND_API_KEY)`) but only `.env.example` committed. Documented in commit message and operator can re-create `.env.test` placeholders locally.
- **Files modified:** `.env.example` (committed); `.env.test` (local-only).
- **Commit:** bd9fcea (documented in commit message)

### Auth Gates

None — this plan does not touch any user-facing auth flow that would require an operator to provide credentials. The `RESEND_API_KEY` and `INNGEST_*` env vars are placeholder values in `.env.example` / `.env.test` (tests mock the SDKs); real values land in plan 08-03 via Vercel preview env-var setup.

### Architectural Decisions Auto-Applied

None — no Rule 4 architectural escalations. All deviations were Rule 1 (bug) or Rule 3 (blocking) fixes.

## Threat-Model Disposition

| Threat ID | Disposition this plan | Evidence |
|-----------|----------------------|----------|
| T-08.01-01 | **deferred to plan 08-03** (DNS records) | `EMAIL_FROM=noreply@command.weknowgroup.com` is set in `.env.example`; SPF/DKIM/DMARC for the subdomain ship in 08-03. |
| T-08.01-02 | **mitigated** | `serve()` from `inngest/next` validates `INNGEST_SIGNING_KEY` automatically; route handler is 9 lines with no env-gating bypass. |
| T-08.01-03 | **mitigated** | `RESEND_API_KEY` has no `NEXT_PUBLIC_` prefix; `grep -rln "RESEND_API_KEY" src/app` returns 0 client-component files. |
| T-08.01-04 | **accepted (Phase 8) / deferred (Phase 11)** | D-06 explicitly logs recipient. 1-year retention purge will land in Phase 11. |
| T-08.01-05 | **mitigated** | `lastError` stores `error.message` plain text; `grep -c "JSON.stringify" src/lib/email.ts` returns 0. |
| T-08.01-06 | **mitigated** | Three `step.run` boundaries (render-html / resend-send / log) — `grep -cE 'step\.run\("(render-html\|resend-send\|log)"'` returns 3. |
| T-08.01-07 | **mitigated** | `password-changed.tsx` has no IP / UA / browserFingerprint props; `grep -ciE "(ipAddress\|userAgent\|browserFingerprint\|browser:\|userIp)"` returns 0. |
| T-08.01-08 | **accepted** | Resend free tier 3k/mo > internal volume. |
| T-08.01-09 | **mitigated** | Lockfile regen via linux/amd64 Docker; tilde version pins; `grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returns 1. |
| T-08.01-10 | **mitigated this plan, locked in 08-03** | `EMAIL_FROM=noreply@command.weknowgroup.com` in `.env.example` (D-02); Vercel preview env-var binding lands in 08-03. |

## Open Items Handed Off

**To plan 08-02 (Change-password UI + confirmation):**
- The `PasswordChangedEmail` template (`src/emails/password-changed.tsx`) is ready to consume.
- The `email/send.requested` event-shape contract (`src/inngest/events.ts`) is locked. The `/account/security` form's POST handler will call `inngest.send({ name: "email/send.requested", data: { kind: "password_changed", to: session.user.email, subject: "Your WeKnow password was changed", template: "password-changed", templateProps: { changedAt, contactAdminUrl } } })`.
- The Inngest function (`sendEmailFn`) is already registered at `/api/inngest`; Phase 9 templates can be added via the `TEMPLATES` const dispatch in `src/inngest/functions/send-email.ts`.

**To plan 08-03 (DNS + UAT):**
- Vercel preview env vars (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) need to be set against the git-branch alias per CLAUDE.md "Vercel preview env vars" rule.
- DNS records (SPF, DKIM CNAME from Resend, DMARC `p=quarantine`) need to be added to the `command.weknowgroup.com` zone (T-08.01-01 mitigation).
- Migration `0041_phase_08_email_log.sql` needs to be applied to the preview Neon DB (the Testcontainers integration tests prove it applies cleanly against a fresh Postgres 16; preview-DB apply is the canonical Phase 7 / Phase 8 protocol).
- Inngest dev-server smoke (Task 13) — operator runs once locally to confirm the `send-email` function appears in the Inngest UI registry.
- EMAIL-03 operator UAT (invite throwaway user → click link → set password → sign in) runs against the preview alias per CLAUDE.md "Playwright specs against preview deploys".

## Known Stubs

None. All four templates render real copy preserved verbatim from the pre-Phase-8 `email.ts`; the Inngest function dispatches one real template (`password-changed`) and Phase 9 will extend the dispatch map; the email_log table writes real data on every send.

## Threat Flags

None — no new security-relevant surface introduced beyond what the threat model already covers (handler at `/api/inngest` is the only new public endpoint, and its STRIDE row T-08.01-02 is mitigated by Inngest's signing-key check).

## Self-Check: PASSED

Verified before writing this section:

- ✅ All 18 artifacts from `must_haves.artifacts` exist on disk (verified by per-file `test -f`).
- ✅ `truths.0` — `grep -c nodemailer src/lib/email.ts` returns **0**.
- ✅ `truths.1` — `git diff --name-only origin/main..HEAD src/lib/auth.ts` returns **empty** (auth.ts byte-identical).
- ✅ `truths.2` — `email_log` table exists in `src/db/schema.ts` with all 9 columns + 2 indexes per the locked column shape.
- ✅ `truths.3` — Inngest `email/send.requested` event wired end-to-end (client → events type → function with retries:5 → route handler).
- ✅ `truths.4` — Five react-email templates exist sharing `_layout.tsx` + `brand.ts` tokens.
- ✅ `truths.5` — `grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returns **1** (linux-x64 binding present, `npm ci --dry-run` clean inside the Docker container — no `Missing: @emnapi/...` recurrence possible).
- ✅ All 4 unit tests in `src/lib/email.test.ts` pass; all 6 integration tests in `tests/email/` pass; full unit suite (566 tests) green; eslint + tsc clean.
- ✅ All 10 commits exist on `gsd/phase-08-email-infrastructure` and not on `origin/main`.
