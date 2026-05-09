---
phase: 6
slug: post-audit-operational-follow-ups-consolidated-v1-0-backlog
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 6 mixes destructive ops (06-01), test infra (06-02), text wiring (06-03), docs (06-04), pure-function refactors (06-05), greenfield admin UI (06-06), and pure-function hardening (06-07). Each plan's validation surface differs — see Per-Task Verification Map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (unit)** | vitest 4.1.x — `vitest.config.ts:13–65` |
| **Framework (e2e)** | @playwright/test 1.58.x — `playwright.config.ts` |
| **Config file** | `vitest.config.ts` (two projects: `unit`, `integration`) + `playwright.config.ts` |
| **Quick run command** | `npx vitest run --project unit <path>` (single file) |
| **Full unit suite** | `npx vitest run --project unit` |
| **Full e2e suite** | `npx playwright test` |
| **Lint + typecheck** | `npm run lint && npm run typecheck` |
| **Estimated runtime (unit only)** | ~30–60 s |
| **Estimated runtime (e2e suite)** | ~3–5 min |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit <changed test file>` (target the touched file).
- **After every plan wave:** Run `npx vitest run --project unit` + `npm run lint && npm run typecheck`.
- **Before `/gsd:verify-work` for any plan:** Full unit suite must be green.
- **Before `/gsd:verify-work` for plans 06-02 / 06-05 / 06-06:** Full e2e suite must be green.
- **Max feedback latency:** unit run < 60 s. Tasks that depend on Playwright e2e accept up to 5 min.

---

## Per-Task Verification Map

> Task IDs follow the pattern `06-{plan}-{task}` and will be finalised by the planner. The rows below are the validation skeleton — every plan task MUST land in one of these buckets or have its own `<automated>` block in the plan.

| Plan | Surface | Validation Type | Automated Command | Manual Required |
|------|---------|-----------------|-------------------|-----------------|
| 06-01 | merge_proposals migration | typecheck + drizzle generate | `npm run db:generate && npm run typecheck` | — |
| 06-01 | Pre-merge dedup probe script | unit (vitest) | `npx vitest run src/scripts/__tests__/probe-multi-pos-merge.test.ts` | — |
| 06-01 | `/settings/duplicates/merge-review` UI | playwright | `npx playwright test tests/settings-duplicates/merge-review.spec.ts` | Real-data review of the 22 clusters by an admin (UAT) |
| 06-01 | Apply path (`scripts/multi-pos-merge.ts`) | dry-run + integration | `npx tsx scripts/multi-pos-merge.ts` (no `--apply`) prints expected stats; integration test `npx vitest run --project integration src/scripts/__tests__/multi-pos-merge.test.ts` against testcontainer DB | Manual `--apply` on staging branch DB before prod |
| 06-01 | Audit-log row count after apply | integration | Test asserts `audit_logs` rows for `metadata->>'script' = 'scripts/multi-pos-merge.ts'` ≥ `2 × 7531 + 29 archive entries` | — |
| 06-01 | Rollback SQL | manual on staging | — | Run rollback SQL on staging; assert `sales_records.location_id` returns to defunct values; re-running rollback is a no-op |
| 06-01 | Idempotency | unit + manual | Re-running `--apply` after `--apply` writes 0 new audit_logs rows | — |
| 06-02 | Monday client extraction | unit (vitest) | `npx vitest run src/lib/__tests__/monday-client.test.ts` exits 0; all 14 `it.todo` are now `it(...)` and pass | — |
| 06-02 | Monday client coverage | unit | `npx vitest run --coverage src/lib/__tests__/monday-client.test.ts`; coverage of `monday-client.ts` ≥ 80% | — |
| 06-02 | Existing `import-location-products` regression | unit | `npx vitest run src/lib/monday/__tests__/import-location-products.test.ts` (if exists, else add) — extracted client must not change behaviour | — |
| 06-02 | kiosk-config-groups multi-location seed | playwright | `npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` exits 0 | — |
| 06-02 | Regression catches PR #29 bug | manual verification | Revert commit `fbcce77` locally; re-run the new spec; assert it now FAILS. Restore. | — (one-time manual verification) |
| 06-03 | Every KpiCard has `tooltip=` prop | grep verification | `grep -L "tooltip=" $(grep -rl "<KpiCard" src/app)` returns empty (every file with KpiCard also has `tooltip=`) | — |
| 06-03 | Tooltip text matches D-decisions | manual | — | Reviewer cross-references each tooltip against `tasks/todo.md` D-decisions during code review |
| 06-04 | Phase 7.11 deferral note in REQUIREMENTS.md | grep | `grep -E "REPORT-V2-0[0-9]\|freeTrialEndDate" .planning/REQUIREMENTS.md` returns ≥1 hit (planner finalised the next free ID — currently REPORT-V2-03; verify against REQUIREMENTS.md before running) | — |
| 06-04 | tasks/todo.md 7.11 line tagged DEFERRED | grep | `grep "7.11.*DEFERRED\|7.11.*deferred" tasks/todo.md` returns ≥1 hit | — |
| 06-05 | `classifyOutletTier(percentile, config)` unit | unit (vitest) | `npx vitest run src/lib/analytics/__tests__/metrics.test.ts` — boundary tests at 0/19/20/49/50/79/80/100 | — |
| 06-05 | `getOutletTierThresholdsCached()` reader | unit | `npx vitest run src/lib/analytics/__tests__/thresholds-server.test.ts` — defaults + override paths | — |
| 06-05 | `/settings/thresholds` page saves new keys | playwright | `npx playwright test tests/settings-thresholds/outlet-tier.spec.ts` — fill form, save, reload, assert persisted | — |
| 06-05 | URL-param override on heat-map | playwright | `npx playwright test tests/analytics-heat-map/url-overrides.spec.ts` — `?redMax=200` etc. shifts colours | — |
| 06-05 | Audit-log row on threshold save | integration | Test asserts new `audit_logs` row with `field` containing `tierTop` after `saveThresholds` action | — |
| 06-06 | Geocoding pipeline (stubbed Google) | unit | `npx vitest run src/lib/geocoding/__tests__/pipeline.test.ts` — idempotency, skip-existing, force-rerun, error path | — |
| 06-06 | `/settings/geocoding` admin UI flow | playwright | `npx playwright test tests/settings-geocoding/full-flow.spec.ts` (with stubbed geocoder) | — |
| 06-06 | Lockfile drift after dep add | bash | `docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc 'cp /src/package.json /tmp/p.json && cd /tmp && npm install --package-lock-only && npm ci --dry-run'` | — |
| 06-06 | Real geocoding run | manual on staging | — | Manual run against staging DB with real `GOOGLE_MAPS_API_KEY`; assert ≥390 of 392 NULL rows populated; spot-check 5 rows against Google Maps web UI |
| 06-06 | Audit-log per row | integration | Test asserts one `audit_logs` row per populated location after stubbed pipeline run | — |
| 06-07 | ORDER BY tiebreaker determinism | unit (vitest) | `npx vitest run src/lib/sales/reversal-matcher.test.ts` — new test runs 100 random input permutations, asserts identical match output | — |
| 06-07 | Orphan-rate measurement script | manual on staging | `npx tsx scripts/measure-reversal-orphan-rate.ts` against staging DB; record rate in test file comment | One-time manual baseline capture |
| 06-07 | 2% orphan analysis | docs | Comment block in `reversal-matcher.test.ts` explains the gap source + baseline rate | — |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

The planner will translate each row above into a concrete task with `<automated>` block in the relevant `06-NN-*-PLAN.md` file.

---

## Wave 0 Requirements

> Wave 0 = test infrastructure stubs that must exist before any task in later waves can be marked `green`. The planner adds these as the first wave in each plan that needs new test files.

- [ ] `src/lib/__tests__/monday-client.test.ts` — already exists (placeholder); plan 06-02 fills it
- [ ] `src/scripts/__tests__/probe-multi-pos-merge.test.ts` — new (plan 06-01)
- [ ] `src/scripts/__tests__/multi-pos-merge.test.ts` — new, integration project (plan 06-01)
- [ ] `tests/settings-duplicates/merge-review.spec.ts` — new (plan 06-01)
- [ ] `tests/kiosk-config-groups/multi-location.spec.ts` — new (plan 06-02)
- [ ] `src/lib/analytics/__tests__/metrics.test.ts` — new (plan 06-05; tests `classifyOutletTier`)
- [ ] `src/lib/analytics/__tests__/thresholds-server.test.ts` — new (plan 06-05; tests cached reader for tier keys)
- [ ] `tests/settings-thresholds/outlet-tier.spec.ts` — new (plan 06-05)
- [ ] `tests/analytics-heat-map/url-overrides.spec.ts` — new (plan 06-05)
- [ ] `src/lib/geocoding/__tests__/pipeline.test.ts` — new (plan 06-06)
- [ ] `tests/settings-geocoding/full-flow.spec.ts` — new (plan 06-06)
- [ ] `scripts/measure-reversal-orphan-rate.ts` — new (plan 06-07)
- [ ] `src/db/seed.ts` (or wherever `npm run db:seed` lives) — extended with multi-location config-group fixture (plan 06-02)

---

## Manual-Only Verifications

| Behavior | Plan | Why Manual | Test Instructions |
|----------|------|------------|-------------------|
| Admin reviews 22 merge clusters and approves/rejects/swaps each | 06-01 | Per-cluster business judgement (some "duplicates" are not actually duplicates — address-data-quality fix decisions ride along) | After deploying merge-review UI to staging, an admin walks through every cluster row in the proposal CSV and records decision in the UI. Final state captured in `merge_proposals` table. |
| `--apply` on staging DB | 06-01 | Destructive op; needs human sign-off and timing | Run on staging branch DB only; observe row counts before/after; verify audit-log; run rollback once to confirm reversibility; run `--apply` again to confirm idempotency |
| Address-data-quality (5.7) per-row corrections | 06-01 | Some rows need Monday re-pull, some need hand-edit; per-row decision | Reviewer marks each in the merge-review UI; re-pull rows trigger Monday re-import; hand-edit rows go through standard `/settings/locations/[id]` form |
| Real Google Maps geocoding run on staging | 06-06 | Validates API key wiring + real provider response shape; rate-limit safety | After Vercel env var added: trigger admin UI on staging; observe ≥390/392 populated; spot-check 5 random rows against Google Maps web UI |
| KPI tooltip text accuracy | 06-03 | Wording is human judgement | Code review compares each tooltip against `tasks/todo.md` D-decisions for the matching metric |
| Reversal-matcher orphan-rate baseline | 06-07 | Production data sample | One-time manual run of `scripts/measure-reversal-orphan-rate.ts` on staging; record output in test file comment |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (manual-only sequences are flagged in the table above and are gated behind a Wave 0 dependency)
- [ ] Wave 0 covers all MISSING references in the Per-Task Verification Map
- [ ] No watch-mode flags (every command above uses `vitest run` not `vitest`)
- [ ] Feedback latency < 60 s for unit; < 5 min for e2e
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — set to `approved YYYY-MM-DD` when planner finalises every task in 06-01..06-07 with a Per-Task entry above.
