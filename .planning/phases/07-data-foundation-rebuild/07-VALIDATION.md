---
phase: 7
slug: data-foundation-rebuild
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-04
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `07-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E) + tsx scripts (integration / DB invariants) |
| **Config file** | `playwright.config.ts` (24 lines; `workers: 1`, `retries: 0`, `fullyParallel: false`, screenshot on failure, base URL from `PLAYWRIGHT_BASE_URL` or `http://localhost:3003`) |
| **Quick run command** | `npx playwright test tests/locations/ --reporter=dot` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~90s quick, ~6 min full (extrapolated from existing 90+ spec baseline at workers=1) |

---

## Sampling Rate

- **After every task commit:** `npx playwright test tests/locations/ --reporter=dot` (locations-scoped)
- **After every plan wave:** `npx playwright test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green AND `npx tsx scripts/verify-data-reset.ts` invariant suite green on Neon UAT branch before prod cutover
- **Max feedback latency:** 90 seconds (locations-scoped run)

---

## Per-Task Verification Map

> Plan IDs (07-01..07-05) and task IDs are placeholders until plans are written. Plan-checker / executor will fill exact task IDs once plans are produced.

| Plan | Wave | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|----------|-----------|-------------------|-------------|--------|
| 07-01 (Pre-flight) | 1 | DATA-01 | Snapshot + env audit produces deterministic readout | Integration | `npx tsx scripts/preflight-data-reset.ts` | ❌ W0 (Plan A) | ⬜ pending |
| 07-02 (Wipe + reseed) | 2 | DATA-01 | Idempotent runbook re-run on fresh DB matches golden snapshot | Integration | `npx tsx scripts/verify-data-reset.ts` | ❌ W0 (Plan E) | ⬜ pending |
| 07-02 | 2 | DATA-04 | LOCATION_NEEDED sentinel visible in locations list; kiosk count updates post-triage | E2E | `npx playwright test tests/locations/sentinel.spec.ts` | ❌ W0 (Plan B) | ⬜ pending |
| 07-03 (Merge UI) | 3 | DATA-02 | N→1 merge: select N locations → 1 canonical, N-1 archived (`archived_at` set), audit_log row written | E2E | `npx playwright test tests/locations/merge.spec.ts` | ❌ W0 (Plan C) | ⬜ pending |
| 07-03 | 3 | DATA-02 | Undo merge: button active pre-mutation, greys out post-mutation | E2E | `npx playwright test tests/locations/merge.spec.ts -g "undo"` | ❌ W0 (Plan C) | ⬜ pending |
| 07-04 (Guardrails) | 3 | DATA-03 | Unique partial index rejects 2nd active row with same `normalised_name`; `runDryImport` warns on same-name candidate | Integration | `npx tsx scripts/verify-same-name-guard.ts` | ❌ W0 (Plan D) | ⬜ pending |
| 07-04 | 3 | DATA-03 | Same-name banner appears when duplicate exists, hides when resolved | E2E | `npx playwright test tests/locations/same-name-banner.spec.ts` | ❌ W0 (Plan D) | ⬜ pending |
| 07-04 | 3 | DATA-04 | Unknown outlet code → kiosk created and assigned to LOCATION_NEEDED sentinel | Integration | `npx tsx scripts/verify-data-reset.ts --check sentinel` | ❌ W0 (Plan E) | ⬜ pending |
| 07-05 (Verify + UAT) | 4 | DATA-05 | Two-pass `assigned_at`: NULL count before vs after `--apply` (re-runnable) | Integration | `npx tsx scripts/verify-data-reset.ts --check assigned_at` | ❌ W0 (Plan E) | ⬜ pending |
| 07-05 | 4 | All | Operator UAT cleared on Vercel preview pointed at prod-clone post-runbook | Manual UAT | `07-UAT-RUNBOOK.md` checklist | ❌ W0 (Plan E) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/locations/merge.spec.ts` — covers DATA-02 (N→1 merge happy path + undo path)
- [ ] `tests/locations/same-name-banner.spec.ts` — covers DATA-03 (banner appears/hides)
- [ ] `tests/locations/sentinel.spec.ts` — covers DATA-04 (sentinel visible, triage flow)
- [ ] `scripts/preflight-data-reset.ts` — covers DATA-01 pre-flight readout (Plan A)
- [ ] `scripts/verify-data-reset.ts` — covers DATA-01 invariant suite + DATA-05 backfill check (Plan E)
- [ ] `scripts/verify-same-name-guard.ts` — covers DATA-03 partial-index + dry-run guardrail (Plan D)

Existing infrastructure (`playwright.config.ts` + 90+ existing specs) covers all other requirements. No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator UAT on Vercel preview against prod-clone (full runbook + merge UI dogfood) | All (acceptance gate per success criterion #6) | Destructive against real preview DB; confirms operator mental model, not just code; bar set by v1.0 Phase 6 `06-HUMAN-UAT.md` pattern | Sign off `07-UAT-RUNBOOK.md` against the preview alias (`https://wkg-command-centre-git-<branch>-...vercel.app`) per CLAUDE.md preview-env rules. Reset prod-clone Neon branch before each pass. |
| Confirm Monday.com import row counts vs Monday board (sanity vs source) | DATA-01 | Source-of-truth diff requires reading Monday board UI in parallel with DB | After `runHotelLocationImport()`, compare `SELECT COUNT(*) FROM locations WHERE archived_at IS NULL` to Monday board item count; difference must equal known archived/sentinel rows |
| Visual review of location-merge UI sheet against `07-UI-SPEC.md` | DATA-02 | Pixel/typography fidelity is human-judged | Walk the sheet visually pre-merge confirm + post-merge confirmation; verify it matches UI-SPEC tokens |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 files listed above)
- [ ] No watch-mode flags (Playwright `workers: 1` already serial)
- [ ] Feedback latency < 90s for locations-scoped quick run
- [ ] `nyquist_compliant: true` set in frontmatter after planner + checker pass

**Approval:** pending
