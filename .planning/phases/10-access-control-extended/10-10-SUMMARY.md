---
phase: 10
plan: 10
subsystem: test-fixtures
tags: [seeder, test-fixtures, gap-closure, auth, refactor]
one_liner: "Canonicalised scripts/seed-test-users.ts to the working direct-DB-insert pattern (auth.$context.password.hash + Drizzle inserts) and deleted the parallel scripts/seed-test-users-direct.ts workaround; updated 10-HUMAN-UAT.md Step 5 to document the disableSignUp:true rationale and the canonical seeder's idempotent output."
dependency_graph:
  requires:
    - "src/lib/auth.ts: auth.$context.password.hash primitive"
    - "src/db/schema: user + account tables"
    - "Plan 10-08 (origin of the seed-test-users-direct.ts workaround during autonomous UAT)"
  provides:
    - "scripts/seed-test-users.ts (single canonical seeder for test + preview DBs)"
    - "10-HUMAN-UAT.md Step 5 runbook reflecting the canonical seeder's actual output + safety gates + disableSignUp rationale"
  affects:
    - "Plan 10-13 verification (its acceptance checks that '...-direct.ts does NOT exist' — satisfied)"
tech-stack:
  added: []
  patterns:
    - "Direct-DB-insert pattern for seeding Better Auth credential rows (mirror of scripts/reset-admin-password.ts) — preferred over auth.api.signUpEmail when disableSignUp:true blocks the sign-up endpoint"
key-files:
  created: []
  modified:
    - "scripts/seed-test-users.ts (replaced with the working direct-DB pattern)"
    - ".planning/phases/10-access-control-extended/10-HUMAN-UAT.md (Step 5 — disableSignUp rationale, updated expected output, both prod hints in safety-gate description)"
  deleted:
    - "scripts/seed-test-users-direct.ts (workaround folded into the canonical script)"
decisions:
  - "Keep both safety gates verbatim (NODE_ENV='production' refusal AND DATABASE_URL prod-hint refusal): redundancy is intentional; either alone is enough to prevent prod writes."
  - "Do NOT add a `seed:test-users` npm script wrapper in package.json — per plan, ad-hoc `npx tsx scripts/seed-test-users.ts` invocation is explicit about the DATABASE_URL context."
  - "Do NOT touch scripts/reset-admin-password.ts — it is a separate prod-rotation script with its own threat model."
  - "Do NOT modify tests/auth/setup.ts or tests/helpers/auth.ts — both already reference the canonical 'seed-test-users.ts' filename in their top-of-file comments; verified, no change needed (this matches the plan's <action> Step 2 + Step 3 expectations)."
metrics:
  duration: "~10 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 2
  files_modified: 2
  files_deleted: 1
---

# Phase 10 Plan 10: Canonical seed-test-users seeder Summary

## What changed

`scripts/seed-test-users.ts` is now the working seeder. The script writes user
+ credential-account rows directly via Drizzle and hashes passwords with
`auth.$context.password.hash()` — the same primitive `scripts/reset-admin-password.ts`
uses. The earlier broken implementation called `auth.api.signUpEmail()` which fails
with `EMAIL_PASSWORD_SIGN_UP_DISABLED` because `src/lib/auth.ts:12` sets
`emailAndPassword.disableSignUp: true`.

`scripts/seed-test-users-direct.ts` (the workaround created during the autonomous UAT
in Plan 10-08 / 10-UAT-AUTONOMOUS.md Step 5) is deleted. Operators no longer have to
choose between two scripts. The canonical script's body is identical to the previous
`-direct.ts` content; only the header comment block was updated to drop the
"Temporary UAT" wording and explain the `disableSignUp:true` rationale.

## Canonical seeder behaviour

Location: `scripts/seed-test-users.ts`

Invocation:
```bash
DATABASE_URL='<test-or-preview-url>' npx tsx scripts/seed-test-users.ts
```

Fixtures seeded (env-overridable):
- `TEST_OPS_IT_EMAIL` (default `ops-it.test@weknowgroup.com`) → role `member`
- `TEST_VIEWER_EMAIL` (default `viewer.test@weknowgroup.com`) → role `viewer`

Safety gates (both must pass — redundant by design):
1. Refuses if `NODE_ENV === "production"`
2. Refuses if `DATABASE_URL` contains any of: `"wkg-command-centre"`, `"wkg-kiosk-tool"`
   (current + historical Vercel project aliases)

Idempotent on email. On a re-run the script re-hashes the password (so a known
credential is always settable) and corrects the role if it drifted, while preserving
the `user.id` and `account.id`.

## File-by-file diff

| File | Action | Net change |
|------|--------|-----------|
| `scripts/seed-test-users.ts` | replaced | +112 / -86 (body now identical to former `-direct.ts`; header docs updated) |
| `scripts/seed-test-users-direct.ts` | deleted | -143 |
| `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md` | edited (Step 5) | +13 / -4 (disableSignUp rationale; corrected expected-output to match the canonical script's `Created ...` / `Updated existing ...` / `Added credential account ...` logs; both prod hints in safety-gate description) |

`tests/auth/setup.ts` and `tests/helpers/auth.ts` were inspected — both already
reference `scripts/seed-test-users.ts` (not `-direct`) in their top-of-file
comments. No edits needed; this matches the plan's <action> Step 2/3 expectations.

## Verification (plan's <verification> block)

| Check | Result |
|-------|--------|
| `scripts/seed-test-users.ts` exists and uses `auth.$context.password.hash` | PASS |
| `scripts/seed-test-users-direct.ts` does NOT exist | PASS |
| `NODE_ENV === "production"` gate present | PASS |
| Both prod-hint strings `wkg-command-centre`, `wkg-kiosk-tool` present | PASS |
| `auth.api.signUpEmail` absent from canonical seeder | PASS |
| `npx tsc --noEmit -p tsconfig.json` — no new errors | PASS (zero `error TS` lines project-wide) |
| `tests/auth/setup.ts` mentions `seed-test-users.ts` | PASS |
| `tests/helpers/auth.ts` mentions `seed-test-users.ts` | PASS |
| `10-HUMAN-UAT.md` mentions `seed-test-users.ts` and `disableSignUp` rationale | PASS |
| `grep "seed-test-users-direct"` confined to audit/planning artefacts | PARTIAL — see below |

### Stale-reference grep result

Plan's verify regex excludes hits in `10-UAT-AUTONOMOUS.md`, `10-10-PLAN.md`,
`10-10-SUMMARY.md`, `10-VERIFICATION.md`. After this plan:

- `10-UAT-AUTONOMOUS.md` — excluded by allow-list (audit trail; historical state correctly described).
- `10-10-PLAN.md`, `10-10-SUMMARY.md` — allow-listed (the plan itself + this summary).
- `10-VERIFICATION.md` — does not currently exist in the phase directory; the allow-list slot is forward-looking.
- `10-13-PLAN.md:285` — references `scripts/seed-test-users-direct.ts does NOT exist` as a forward-looking acceptance criterion for Plan 10-13. The assertion is correct after this plan; the reference must remain or Plan 10-13's check loses its anchor. **Not modified.**
- `.planning/ROADMAP.md:143` — describes this plan's intent in the phase roadmap. Orchestrator-owned artefact (parallel-execution rules forbid worktree agents from writing ROADMAP.md). **Not modified.** The orchestrator will rewrite this row when it tallies wave 7.

Both remaining hits are planning artefacts (not live runbooks or live code) and either correctly describe the post-plan state or are owned by the orchestrator. Spirit of the verification check is satisfied: no live reference to the deleted script remains.

## Decisions made

1. **Folded `-direct.ts` into the canonical script byte-for-byte** (only the header comment was rewritten). Preserved the working body verbatim so behaviour is identical to the script the operator validated during the autonomous UAT.
2. **Kept both safety gates redundant.** Either gate alone is sufficient; both together cover the failure modes where one was bypassed (e.g. NODE_ENV not set when targeting prod, or DATABASE_URL pointing at the historical `wkg-kiosk-tool` alias).
3. **Did not introduce a `seed:test-users` npm wrapper.** Per the plan, ad-hoc `npx tsx` invocation is explicit about the DATABASE_URL context and harder to invoke in the wrong environment by accident.
4. **Reworded the comment in the new header to drop the literal `auth.api.signUpEmail()` call** so the plan's `! grep -q "auth.api.signUpEmail"` acceptance check passes strictly; replaced with "Better Auth sign-up endpoint" prose that preserves the meaning.
5. **Updated 10-HUMAN-UAT.md Step 5 beyond the plan's minimum** to (a) document the `disableSignUp:true` rationale (plan's intent), (b) correct the expected-output line that was stale relative to the canonical script's logs, and (c) describe both prod hints in the safety-gate paragraph (previously only mentioned `wkg-command-centre`). These are Rule 1 / Rule 2 deviations — see below.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] 10-HUMAN-UAT.md Step 5 had stale "expected output" line**
- **Found during:** Task 2
- **Issue:** The runbook said operators should expect `Seeded <email> (userId=..., role=member)`, but the canonical seeder (formerly `-direct.ts`) prints `Created ...` on first run, `Updated existing ...` on re-run, or `Added credential account for existing ...` if the user row pre-existed without a credential. The old expected-output line described the deleted broken script's logs.
- **Fix:** Replaced with accurate output describing all three idempotent code paths.
- **Files modified:** `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md`
- **Commit:** `9b78e22`

**2. [Rule 2 - Missing safety gate description] 10-HUMAN-UAT.md mentioned only one of two prod hints**
- **Found during:** Task 2
- **Issue:** Runbook said "Script REFUSES if NODE_ENV=production OR DATABASE_URL contains 'wkg-command-centre'". The canonical script also refuses on `wkg-kiosk-tool` (the historical Vercel project alias retained as a defensive gate). Operators reading the runbook would not realise the gate also catches the historical URL — a missed mitigation hint.
- **Fix:** Mentioned both hints + clarified "current + historical prod project aliases".
- **Files modified:** `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md`
- **Commit:** `9b78e22`

**3. [Rule 1 - Bug] Initial seeder header comment contained the literal `auth.api.signUpEmail()` call name**
- **Found during:** Task 1 verification (acceptance grep `! grep -q "auth.api.signUpEmail"`)
- **Issue:** First draft of the new header explained "This bypasses auth.api.signUpEmail()..." — accurate prose but fails the plan's strict acceptance grep that disallows the literal string anywhere in the file.
- **Fix:** Reworded to "This bypasses the Better Auth sign-up endpoint" — preserves the meaning, satisfies the grep.
- **Files modified:** `scripts/seed-test-users.ts` (header comment only, before the commit)
- **Commit:** folded into `29c1e99`

### Things not done (per plan instructions)

- **`scripts/reset-admin-password.ts` not modified** — separate prod-rotation script, out of scope.
- **No `seed:test-users` npm script added** — plan explicitly forbids.
- **`10-UAT-AUTONOMOUS.md` not modified** — plan explicitly forbids (audit trail must remain historically accurate).
- **`tests/auth/setup.ts` and `tests/helpers/auth.ts` not modified** — already reference the canonical name; verified, no edit needed.
- **`.planning/ROADMAP.md` not modified** — orchestrator-owned in worktree mode; the orchestrator will rewrite the row when wave 7 lands.
- **`.planning/phases/10-access-control-extended/10-13-PLAN.md` not modified** — its mention of `scripts/seed-test-users-direct.ts does NOT exist` is a correct forward-looking acceptance criterion for Plan 10-13.

## Threat surface scan

No new security surface introduced. The canonical seeder's threat model is identical
to the deleted `-direct.ts` script's: same safety gates, same fixture passwords, same
role surface (member + viewer; admin never touched). Plan's `<threat_model>` block
covers all four threats (T-10-10-01..04) and none required additional mitigation
beyond what the canonical script already implements.

## Known stubs

None. The seeder is functional end-to-end against any test/preview DB.

## Self-Check: PASSED

Created/modified files exist on disk:
- `scripts/seed-test-users.ts` — FOUND (active, contains `auth.$context.password.hash`)
- `scripts/seed-test-users-direct.ts` — CONFIRMED DELETED (`test ! -f` returns 0)
- `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md` — FOUND (Step 5 contains `disableSignUp` rationale)
- `.planning/phases/10-access-control-extended/10-10-SUMMARY.md` — this file

Commits exist on the worktree branch:
- `29c1e99` `refactor(10-10): canonicalize seed-test-users.ts to direct-DB-insert pattern` — FOUND in `git log --oneline -3`
- `9b78e22` `docs(10-10): document disableSignUp:true rationale in seeder runbook` — FOUND in `git log --oneline -3`

Plan-level verification block: all PASS or PARTIAL-with-justification (see above).
