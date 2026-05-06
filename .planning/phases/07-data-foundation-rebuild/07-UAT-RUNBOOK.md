# Phase 7 — UAT Runbook (Claude-driven)

**Replaces:** `milestones/v1.0-phases/06/06-HUMAN-UAT.md` pattern (per D-14).
**Driver:** Claude executes the loop; operator decides go/no-go in conversation.
**Bar:** All `fail` invariants resolved on UAT before prod cutover; `warn` invariants surfaced + acknowledged.

## Pre-conditions

- [ ] Plan A signed off; `07-PREFLIGHT-REPORT.md` exists with golden constants
- [ ] Plan B + C + D plans completed; `gsd/phase-07-data-foundation-rebuild` branch builds + tests green
- [ ] Neon UAT branch from prod provisioned (Plan A Task 3 sign-off)
- [ ] Vercel preview env vars on the phase branch:
  - `DATABASE_URL` = Neon UAT branch connection string
  - `BETTER_AUTH_URL` = `https://wkg-command-centre-git-gsd-phase-07-data-foundation-rebuild-vedant-kalbag-wkgs-projects.vercel.app` (git-branch alias per CLAUDE.md — NOT a per-deploy hash)
- [ ] Vercel preview redeployed; sign-in works against the alias
- [ ] `MONDAY_API_TOKEN` valid; `.env.test` has TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD per CLAUDE.md "Prod admin password rotation" — for UAT use a non-prod admin if possible, else use prod admin against the UAT branch (since the branch is a read-only fork-of-prod, prod admin login still works)

## UAT Loop

### Step 1 — Dry-run runbook against UAT branch

```bash
DATABASE_URL=<neon-uat-branch-url> \
MONDAY_API_TOKEN=<token> \
  npx tsx scripts/v2-wipe-and-reseed.ts
```

Expected: prints `Dry-run — no changes committed.` and exits 0. If errors surface, fix in plan code before proceeding.

### Step 2 — Apply runbook against UAT branch

```bash
DATABASE_URL=<neon-uat-branch-url> \
MONDAY_API_TOKEN=<token> \
  npx tsx scripts/v2-wipe-and-reseed.ts --apply
```

Expected: prints `Wipe + reseed COMMITTED.` then runs `scripts/backfill-kiosk-install-dates.ts --apply` automatically (DATA-05 second pass).

### Step 3 — Verify against UAT branch

```bash
DATABASE_URL=<neon-uat-branch-url> \
  npx tsx scripts/verify-data-reset.ts \
    --out=.planning/phases/07-data-foundation-rebuild/07-VERIFY-REPORT-uat.json \
  2>.planning/phases/07-data-foundation-rebuild/07-VERIFY-REPORT-uat.md
```

Captures JSON to a tracked report file + Markdown summary. Exit 0 on all-pass-or-warn; exit 1 if any invariant fails.

### Step 4 — Live Playwright specs against UAT preview

Per CLAUDE.md "Playwright specs against preview deploys (not just `--list`)":

```bash
PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-phase-07-data-foundation-rebuild-vedant-kalbag-wkgs-projects.vercel.app \
TEST_ADMIN_EMAIL=<admin> TEST_ADMIN_PASSWORD=<pwd> \
  npx playwright test tests/locations/sentinel.spec.ts tests/locations/merge.spec.ts tests/locations/same-name-banner.spec.ts
```

For dupe-existence specs, set `PLAYWRIGHT_EXPECT_DUPES=1` if the UAT branch has same-name groups (per Plan D Task 4 sign-off note).

For destructive merge confirmation, opt in with `PLAYWRIGHT_DESTRUCTIVE=1` only if the operator wants to dry-run a real merge against the UAT branch.

### Step 5 — Synthesise summary + present go/no-go

Claude reads `07-VERIFY-REPORT-uat.md` and the Playwright run logs, then presents to the operator:

> **UAT report summary:**
> - Invariants: <pass>/<warn>/<fail>
> - Notable failures: <list>
> - Notable warnings: <list — incl. sentinel orphan count, assigned_at NULL count>
> - Playwright: <pass>/<fail>; live preview alias confirmed working
>
> **Recommendation:** <go / hold> — <one-line reason>
>
> **Question:** Approve prod cutover? (go / no-go / re-investigate)

Operator responds in-conversation. On `no-go` or `re-investigate`, Claude does NOT proceed to Step 6.

### Step 6 — Prod cutover (only on operator "go")

```bash
DATABASE_URL=<prod-url> \
MONDAY_API_TOKEN=<token> \
  npx tsx scripts/v2-wipe-and-reseed.ts --apply
```

THEN:

```bash
DATABASE_URL=<prod-url> \
  npx tsx scripts/verify-data-reset.ts \
    --out=.planning/phases/07-data-foundation-rebuild/07-VERIFY-REPORT-prod.json \
  2>.planning/phases/07-data-foundation-rebuild/07-VERIFY-REPORT-prod.md
```

Claude presents the prod verify report to the operator as the final phase artifact. On any `fail` invariant in the prod report, Claude flags it and the operator decides whether to roll back via Neon PITR + re-attempt UAT, or accept the partial state and follow up in Plan 11 / a hotfix.

### Step 7 — Tear-down

- Delete the Neon UAT branch (`neon branch delete uat-phase-7-runbook`).
- Remove the UAT-branch DATABASE_URL + BETTER_AUTH_URL preview env vars (or leave them pointing back at prod / a permanent staging URL).
- Commit `07-VERIFY-REPORT-uat.json` + `07-VERIFY-REPORT-prod.json` + `07-VERIFY-REPORT-uat.md` + `07-VERIFY-REPORT-prod.md` to the phase branch as evidence.

## Hard "no-go" conditions (Claude WILL NOT proceed past Step 5 without explicit override)

- Any `fail` invariant in the UAT verify report.
- Playwright spec failures against the UAT preview alias.
- BETTER_AUTH_URL on the preview is pinned to a per-deploy hash (CLAUDE.md violation — Step 4 will fail with 403s).
- Any `npm install` was run on macOS between Plan B's Docker lockfile regen (if any) and this UAT cycle (CLAUDE.md "npm ci lockfile must stay in sync").
- DATABASE_URL is pointing at prod when the operator believes it's pointing at the UAT branch (sanity-check: `psql $DATABASE_URL -c "SELECT inet_server_addr(), current_database()"` and confirm with operator).

## Rollback

The wipe-and-reseed transaction is atomic per the advisory-lock-wrapped `BEGIN/COMMIT` in `scripts/v2-wipe-and-reseed.ts`. Mid-run errors auto-rollback. Post-COMMIT rollback options:

1. **Neon PITR** — fastest; restore the database to a point seconds before the runbook started. Operator triggers via Neon dashboard.
2. **Re-run runbook against a fresh Neon branch from the pre-runbook PITR point** — slower but lossless.
3. **Manual repair** — only if (1) and (2) are not viable; reuses Plan C merge UI + sentinel triage to re-cluster mis-merged data.
