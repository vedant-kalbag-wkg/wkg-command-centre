---
phase: 4
slug: data-migration
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E) + Vitest (unit) |
| **Config file** | `playwright.config.ts` / `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx playwright test && npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx playwright test && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Wave 0 Plan

Plan `04-00-PLAN.md` (Wave 0) creates:
- [x] `vitest.config.ts` — Vitest configuration with path aliases
- [x] `src/lib/__tests__/monday-client.test.ts` — Unit test stubs for pagination and retry (6 cases)
- [x] `tests/admin/data-import.spec.ts` — Playwright E2E test stubs (3 cases)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-00-01 | 00 | 0 | MIGR-03 | unit | `npx vitest run src/lib/__tests__/monday-client.test.ts` | Created by 04-00 | ⬜ pending |
| 04-00-02 | 00 | 0 | MIGR-01 | e2e | `npx playwright test tests/admin/data-import.spec.ts` | Created by 04-00 | ⬜ pending |
| 04-01-01 | 01 | 1 | MIGR-01, MIGR-03 | unit+build | `npx vitest run src/lib/__tests__/monday-client.test.ts && npx next build 2>&1 \| tail -5` | Depends on 04-00 | ⬜ pending |
| 04-01-02 | 01 | 1 | MIGR-01 | build | `npx next build 2>&1 \| tail -5` | N/A | ⬜ pending |
| 04-02-1a | 02 | 2 | MIGR-01 | build | `npx next build 2>&1 \| tail -5` | N/A | ⬜ pending |
| 04-02-1b | 02 | 2 | MIGR-01, MIGR-02 | build | `npx next build 2>&1 \| tail -5` | N/A | ⬜ pending |
| 04-02-02 | 02 | 2 | MIGR-01, MIGR-02, MIGR-03 | e2e+build | `npx playwright test tests/admin/data-import.spec.ts && npx next build 2>&1 \| tail -5` | Depends on 04-00 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dry-run preview shows accurate field mapping | MIGR-01 | Requires visual inspection of mapped data preview | 1. Navigate to migration page 2. Click "Dry Run" 3. Verify column headers match schema fields 4. Check sample data accuracy |
| Rate limit recovery mid-import | MIGR-03 | Requires actual API rate limiting conditions | 1. Start large import 2. Monitor logs for rate limit responses 3. Verify retry/backoff behavior 4. Confirm import completes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
