# Session handoff — Phase 6 code-complete + UAT fixes pushed; held for operator destructive-apply

**Date authored**: 2026-04-28
**Branch**: `gsd/phase-06-post-audit-operational-follow-ups-consolidated-v1-0-backlog`
**Latest commit**: `f6338ae` — `fix(06-05): preserve non-filter URL params in analytics filter-bar`
**Preview alias** (use this — survives redeploys, satisfies Better Auth origin check): `https://wkg-command-centre-git-gsd-p-9b688b-vedant-kalbag-wkgs-projects.vercel.app`
**Per-deploy URL** (latest): `https://wkg-command-centre-5fuz65hgn-vedant-kalbag-wkgs-projects.vercel.app` — do **not** point Better Auth at this; the `<hash>` rotates every redeploy.
**PR**: not opened yet (intentional — see §6).

This session ran a broad UAT pass on Phase 6 against a real Vercel preview, caught and fixed a 06-05 regression, applied missing migration 0038 to prod, freed Neon space, and established a preview-deploy UAT pattern. Phase 6 stays `In Progress` in `.planning/STATE.md` until the operator finishes the destructive 06-01/06-06 manual steps.

---

## 1. Current state at a glance

### Done this session
- **All 7 Phase 6 plans code-complete on the branch** (commits `ea9250d` → `f6338ae`, 23 commits ahead of `main`):
  - 06-01 D8 multi-POS merge — migration 0038, probe + apply scripts, `/settings/duplicates/merge-review` UI, integration + Playwright specs.
  - 06-02 test-infrastructure — Monday GraphQL client extracted (14/14 unit tests filled), kiosk-config-groups multi-location regression spec.
  - 06-03 KPI tooltip sweep — 27/27 `<KpiCard>` call sites carry `tooltip=`. Verified live: 4 buttons render on `/settings/data-quality`.
  - 06-04 Phase 7.11 deferral note — `REPORT-V2-03` in REQUIREMENTS.md, `[DEFERRED to v2…]` in `tasks/todo.md`.
  - 06-05 thresholds-as-settings — outlet-tier cutoffs form on `/settings/thresholds`, URL-param overrides on heat-map + portfolio.
  - 06-06 geocoding — `/settings/geocoding` admin UI + Google-Maps pipeline (stubbed in tests).
  - 06-07 reversal-matcher hardening — id tiebreaker on both matchers, orphan-rate measurement script.
- **Migration 0038 applied to prod Neon** via `DATABASE_URL=<prod> npx drizzle-kit migrate`. Was blocking the merge-review UI (500 on `relation "merge_proposals" does not exist`).
- **Verifier scored Phase 6 `human_needed`** (10/10 SCs code-verified, 2 destructive UATs awaiting operator). Report at `06-VERIFICATION.md`; 3 items persisted in `06-HUMAN-UAT.md`.
- **Live UAT against the preview** — 7 Phase 6 Playwright specs now run green against the alias URL: heat-map url-overrides (2), merge-review (3), outlet-tier (2). The `--list` clean checks the executor agents did were not enough; running them live caught the F1 regression.
- **F1 / F2 / F3 fixed** in commit `f6338ae` — see §4.
- **06-07 prod orphan-rate baseline filled** in `src/lib/sales/reversal-matcher.test.ts` from `scripts/measure-reversal-orphan-rate.ts` against prod: **11/36 = 30.56%** on 2026-04-28 (substantially higher than the analytics-audit ~2% estimate; not a matcher bug — refunds for bookings outside the imported sales window have no matchable original).
- **Neon DB freed** from 441 MB → 62 MB by `TRUNCATE import_stagings` (95,103 `committed`-status scratch rows from prior Monday.com imports). Below the 0.4 GB target on the free tier. Neon dashboard logical size catches up to the live drop within ~24h. Followup worth filing: there's no scheduled cleanup of `import_stagings`; if imports resume it'll grow back.
- **Vercel preview env on the phase-06 branch scope** now has `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (set to the **git-branch alias**, not a per-deploy URL), and `DATABASE_URL` (= prod Neon). The previous "Preview env" had nothing because the project follows a per-branch-scoped env-var convention.

### Open / awaiting operator (destructive — Claude can't run these)
- **06-01 multi-POS merge `--apply`** against staging, then prod. Full runbook in `06-01-SUMMARY.md` "Operator runbook". Boils down to: probe → walk 22 clusters in `/settings/duplicates/merge-review` → save decisions → dry-run → `--apply` on staging → SQL verification → rollback drill (BEGIN/ROLLBACK) → idempotency check → `--apply` on prod → tick `tasks/todo.md` lines 96/97/98.
- **06-06 geocoding apply** — needs `GOOGLE_MAPS_API_KEY` set on Vercel `Production` AND `Preview` envs, Geocoding API enabled in Google Cloud Console (set $5 billing alert; one-off run is ~$2), then admin click-through against ~392 NULL-coord locations + 5-row spot-check against Google Maps web UI. Runbook in `06-06-SUMMARY.md`.
- **06-07 baseline cross-check on staging** — non-blocking. Already filled prod baseline; staging-side line in the test-file comment is still placeholder. Can wait until a future deploy.

### Side effects to clean up before walking the merge UI
- **One row already in prod `merge_proposals`**: `cluster_id = 1` saved as `decision = 'approved'` by `Vedant Kalbag` at `2026-04-28 10:47:46 UTC`. This was a side effect of running `tests/settings-duplicates/merge-review.spec.ts` test #2 ("save-decision per cluster persists") against the live preview backed by prod DB. The decision is sensible (Hotel Berlin, Berlin canonical/defunct have identical names, basis=address) — but you may want a clean slate before walking all 22 clusters. To reset:
  ```sql
  DELETE FROM merge_proposals WHERE cluster_id = 1;
  ```
  Future Playwright runs against prod-backed previews should either point at a separate DB, or the spec should clean up after itself.

---

## 2. Phase 6 plan status

| Plan | Status | Operator step | Notes |
|------|--------|---------------|-------|
| 06-01 multi-POS merge | code-complete | walk 22 clusters → `--apply` staging → rollback drill → `--apply` prod | autonomous: false. Probe surfaced 96 collision warnings across 19/22 clusters; `merge_proposals` table on prod (post-migration 0038). 1 stale test row (cluster_id=1). |
| 06-02 test-infra | done | — | 14 monday-client tests filled; multi-location config-group spec lists clean. |
| 06-03 KPI tooltips | done (verified live) | — | 27/27 cards have tooltips; spot-checked on `/settings/data-quality`. |
| 06-04 7.11 deferral | done | — | `REPORT-V2-03` in `.planning/REQUIREMENTS.md` (gitignored — disk only). |
| 06-05 thresholds-as-settings | done (regression caught + fixed) | — | F1 fix — see §4. Outlet-tier form + URL overrides verified live. |
| 06-06 geocoding | code-complete | set `GOOGLE_MAPS_API_KEY` + dry-run + apply + 5-row spot-check | autonomous: false. Cannot run programmatically (real API call, ~$2 of credit). |
| 06-07 reversal-matcher | done | optional staging baseline | Prod baseline filled (11/36 = 30.56%). |

---

## 3. Operator UAT runbook — what's left

Both runbooks live next to the plans for self-contained reference. Reproducing the headlines here so a fresh Claude doesn't have to dig.

### 06-01 multi-POS merge (~30 min on staging + ~10 min on prod)
1. `DELETE FROM merge_proposals WHERE cluster_id = 1;` if you want a clean slate.
2. Pull a fresh `DATABASE_URL` for staging (`vercel env pull --environment=preview` against the relevant branch — the per-branch convention puts it on the preview branch scope, not generic). For prod use `vercel env pull --environment=production` against `wkg-command-centre`.
3. `DATABASE_URL='<staging>' npx tsx scripts/probe-multi-pos-merge-collisions.ts` — confirm collision report shape (expect ~96 warnings across 19 clusters).
4. Open the staging preview at `/settings/duplicates/merge-review` and decide each of the 22 clusters: `approved` / `swapped` / `rejected` / `address_fix` (the last requires `notes`). Special attention: clusters 2, 3, 10, 15, 19 have "different normalised name across cluster" warnings — likely `address_fix` candidates per CONTEXT D-04.
5. `DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts` (no `--apply`) — confirm dry-run reports the expected counts (~7,531 sales rewrites + 29 archives + ~30 membership/product/assignment rewrites).
6. `DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts --apply` — apply against staging.
7. SQL verification on staging:
   ```sql
   SELECT count(*) FROM audit_logs WHERE metadata->>'script' = 'scripts/multi-pos-merge.ts';
   SELECT count(*) FROM locations WHERE archived_at IS NOT NULL AND id IN (<29 defunct ids>);
   SELECT count(*) FROM sales_records WHERE location_id IN (<29 defunct ids>); -- expect 0
   ```
8. Re-run `--apply` — must report "0 pending merge proposal(s) to apply"; audit-log row count must NOT change. Idempotency proven.
9. Rollback drill — open a transaction, run the rollback SQL from `06-01-SUMMARY.md`, verify counts return to pre-merge state, then `ROLLBACK` so staging stays merged for the prod apply.
10. `DATABASE_URL='<prod>' npx tsx scripts/multi-pos-merge.ts --apply`.
11. Same SQL verification on prod.
12. Tick `tasks/todo.md` lines 96/97/98 (5.5/5.6/5.7) with PR # + apply date.

### 06-06 geocoding (~5 min once env is set)
1. Set `GOOGLE_MAPS_API_KEY` in Vercel `wkg-command-centre` → Settings → Environment Variables → `Production` AND `Preview` (both — so prod apply doesn't need a second redeploy). Set $5 billing alert.
2. Enable Geocoding API in the linked Google Cloud Console project.
3. Trigger a fresh Vercel preview deploy of the phase-06 branch (or just push a no-op commit; the env var is read at build time).
4. Open `/settings/geocoding` on the preview alias — `Re-geocode all` UNCHECKED → click `Run Dry-Run` → wait ~40s.
5. Inspect the preview table: assert ~390 rows show `status=ok`; ≤5 `no_results`/`error`. Note error rows for follow-up.
6. Click **Apply** → confirm dialog.
7. SQL verification on staging then prod (same query shape):
   ```sql
   SELECT count(*) FROM locations WHERE archived_at IS NULL AND latitude IS NOT NULL;
   SELECT count(*) FROM audit_logs WHERE entity_type = 'location' AND field = 'latitude,longitude' AND metadata->>'script' = 'scripts/geocode-locations.ts';
   ```
   Two counts must match.
8. Spot-check 5 random rows against Google Maps web UI to ~3 decimals.
9. Idempotency: re-run dry-run with `Re-geocode all` UNCHECKED → expect 0 candidates.

---

## 4. UAT findings caught + fixed this session

These are written up in detail in CLAUDE.md (the F2 + F3 sections) and in the commit message of `f6338ae`. Quick reference:

### F1 — heat-map URL threshold overrides were silently dropped
- Plan 06-05 wired `?redMax=`, `?greenMin=`, `?tierTop|Mid|Bottom=` overrides on `/analytics/heat-map` and `/analytics/portfolio`. Unit tests passed.
- Bug: `src/components/analytics/filter-bar.tsx:95` called `router.replace(?${params.toString()})` 150ms after hydrate, where `params` only contained the canonical filter keys. Threshold params got clobbered.
- Fix: read `window.location.search`, strip only the canonical `FILTER_KEYS` (now exported from `src/lib/analytics/url-filters.ts`), then merge new filter values. Same change applied to `handleReset`.
- Verified live against the preview alias: both tests in `tests/analytics-heat-map/url-overrides.spec.ts` pass.

### F2 — Phase 6 Playwright specs only listed clean, never ran live
- The executor agents that ran 06-02/06-05/06-06 verified specs by `--list` (parses-clean check). F1 would have been caught immediately by running them against any live server.
- Fix: `playwright.config.ts` now honours `PLAYWRIGHT_BASE_URL` — when set, the dev-server `webServer` is skipped and tests run against the override URL. Workflow documented in CLAUDE.md.
- Proof: 7 Phase 6 specs ran live against the preview alias this session. All pass.

### F3 — `BETTER_AUTH_URL` must use the git-branch alias
- I initially set `BETTER_AUTH_URL` to the per-deploy URL (`<hash>.vercel.app`). Every redeploy minted a new `<hash>`, leaving `BETTER_AUTH_URL` stale → all `/api/auth/*` requests returned `403 Invalid origin`.
- Fix: use `wkg-command-centre-git-<sanitized-branch>-…vercel.app` (Vercel auto-generates and re-points it at the latest deploy). Documented in CLAUDE.md.

### Bonus — 06-07 baseline filled
- Ran `scripts/measure-reversal-orphan-rate.ts` against prod: 11/36 = 30.56%. Replaced the `<X>/<N> = <X.XX>%` placeholder in `src/lib/sales/reversal-matcher.test.ts` with the real number + a note that the imported sales window starts mid-2024, so refunds for older bookings have no matchable original (not a matcher bug).

---

## 5. Infrastructure side-quests this session

### Neon free-tier crisis → fixed in-place (no migration)
- DB hit ~0.54 GB on Neon free tier (~0.5 GB ceiling). User asked about migrating to Azure.
- Probed `wkgsalesdata` storage account → `WKGRG-DEV` in `eastus`. Tried provisioning Azure Database for PostgreSQL — namespace `Microsoft.DBforPostgreSQL` not registered on the subscription, user lacks Owner permission to register. Pivoted to self-host on an Azure VM (`Microsoft.Compute` IS registered). VM provisioning failed: `Standard_B1ms` capacity-restricted in `uksouth`, `eastus2`. Stopped before going deeper.
- User pivoted to "delete data instead". `pg_database_size` showed 441 MB total but `import_stagings` was 379 MB (86%) — all 95,103 rows in `committed` status, scratch from prior Monday.com imports. `TRUNCATE import_stagings` → 62 MB total. Well under 0.4 GB target. Followup: no scheduled cleanup of this table; should add a hook in the import pipeline if more imports are coming.
- `/tmp/wkg-neon-prod.dump` (19 MB) preserved as a pre-Phase-6 snapshot in case rollback is ever needed.

### Vercel project layout — `wkg-command-centre` vs `wkg-kiosk-tool`
- The same GitHub repo (`vedant-kalbag-wkg/wkg-command-centre`) is connected to **two** Vercel projects: `wkg-command-centre` (the user-facing one, with the prod alias `wkg-command-centre.vercel.app`) and `wkg-kiosk-tool` (older / dual). Pushes deploy to both. Use `wkg-command-centre` for everything; `wkg-kiosk-tool`'s previews are SSO-gated and have no env vars.

### Phase-06 preview env vars (per-branch scope)
- The project follows a per-branch convention for preview env vars (existing `Preview (perf/phase-1-measurement)`-style entries). Set on `gsd/phase-06-…`:
  - `BETTER_AUTH_SECRET` — copied from production scope
  - `BETTER_AUTH_URL` — set to the git-branch alias (see F3)
  - `DATABASE_URL` — copied from production scope (so preview reads/writes prod, same as how this session ran UAT)
- Reset/move these if the next session migrates to a non-prod DB.

---

## 6. Resume path

When the operator has finished the destructive UAT (06-01 prod-apply + 06-06 prod-apply):

1. Mark the items `passed` in `06-HUMAN-UAT.md` (or run `/gsd:verify-work 06` and answer the prompts). The verifier output will flip from `human_needed` to `passed`.
2. Re-invoke `/gsd:execute-phase 6` (or `/gsd:resume-work` from the .continue-here.md). The orchestrator detects no incomplete plans and proceeds to:
   - `regression_gate` — run prior phase test suites (already green this session: 552/552 unit + 7/7 Phase 6 e2e).
   - `verify_phase_goal` — re-runs verifier; should now pass.
   - `update_roadmap` — flips Phase 6 row to `[x] complete` in `.planning/ROADMAP.md`, advances `STATE.md`.
   - `update_project_md` — moves Phase 6's SCs from Active → Validated.
3. Open the PR. Suggested title: `feat(phase-06): post-audit operational follow-ups (D8 multi-POS merge, geocoding, thresholds, KPI tooltips, ...)`. PR body should pull from each `06-NN-SUMMARY.md`.
4. Before merging, double-check `tasks/todo.md` lines that the plans claimed to tick — most done in this session's commits, but the multi-POS lines (96/97/98) are still unchecked because the prod-apply hasn't run.

If you instead need to **abandon Phase 6** or **defer the destructive parts**: the code is fine to merge as-is (every page renders, every test passes, every script is idempotent). The destructive `--apply` paths simply stay un-invoked until the operator decides. `06-HUMAN-UAT.md` will continue to surface in `/gsd:progress` and `/gsd:audit-uat` until they're resolved.

---

## 7. Files of interest

- `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-VERIFICATION.md` — verifier report (`status: human_needed`, 10/10 SCs verified)
- `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-HUMAN-UAT.md` — 3 deferred operator items (06-01 destructive, 06-06 geocoding, 06-07 staging baseline)
- `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-NN-*-SUMMARY.md` (×7) — per-plan deliverables + operator runbooks
- `.planning/HANDOFF.json` — machine-readable state for `/gsd:resume-work`
- `.planning/phases/06-…/.continue-here.md` — human-readable continue-here for `/gsd:resume-work`
- `/tmp/wkg-neon-prod.dump` (19 MB, custom format) — pre-Phase-6 snapshot, safe to delete after the prod-apply lands and you've verified it
- `CLAUDE.md` — now documents the `BETTER_AUTH_URL` git-branch-alias requirement (§"Vercel preview env vars") and the Playwright-against-preview workflow (§"Playwright specs against preview deploys")

---

## 8. Things to watch for next session

- `tasks/todo.md` has unstaged changes from the Phase 6 plans' updates — committed via the per-plan commits, but **the working-tree change to `tasks/todo.md` was already there before this session** (line 96/97/98 multi-POS lines still unchecked because the prod-apply didn't run). Don't re-stage it accidentally.
- Watch for the Neon dashboard size: it may still show ~0.4–0.54 GB for up to 24h after the truncate while their storage compacts. `pg_database_size(current_database())` is the authoritative live number (62 MB at handoff time).
- The `import_stagings` truncate left `sales_imports` (1 row, 48 kB) intact — that's the parent summary table and is the right shape to keep. If imports resume, this table grows by 1 row per import; the staging table will grow by 1 row per Monday board row per import. Filing as a followup when more imports happen: add a post-commit hook in the import flow that deletes its own `import_stagings` rows.
- If the user runs `/gsd:execute-phase 6` *with* `--auto`, the chain flag handling will pick up where the verifier left off and try to push through phase completion. That's safe iff the operator has done the destructive steps. Otherwise it'll re-trigger `human_needed` and stall in the same place.
