---
phase: 03
slug: advanced-views
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.58.x |
| **Config file** | `playwright.config.ts` (exists) |
| **Quick run command** | `npx playwright test tests/installations/ --workers=1` |
| **Full suite command** | `npx playwright test --workers=1` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test tests/installations/ --workers=1`
- **After every plan wave:** Run `npx playwright test --workers=1`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | GANTT-01 | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | GANTT-02 | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | GANTT-03 | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | GANTT-04 | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | CAL-01 | E2E | `npx playwright test tests/installations/calendar.spec.ts -x` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | CAL-02 | E2E | `npx playwright test tests/installations/calendar.spec.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/installations/crud.spec.ts` — Installation CRUD happy path + validation
- [ ] `tests/installations/gantt.spec.ts` — covers GANTT-01 through GANTT-04, pending drag, milestone quick-add
- [ ] `tests/installations/calendar.spec.ts` — covers CAL-01, CAL-02, event popover
- [ ] `tests/installations/view-tabs.spec.ts` — URL ?view= param routing
- [ ] `tests/helpers/installation-helpers.ts` — DB seed helpers for installation test fixtures
- [ ] Framework already installed — no new install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gantt drag visual tracking (bar follows mouse during drag) | GANTT-01 | Playwright mouse events may not trigger library's internal pointer tracking | 1. Navigate to /kiosks?view=gantt 2. Mouse-down on bar end 3. Drag right 4. Verify bar visually extends |
| Pending bar visual indicator (lighter shade + dashed border) | GANTT-01 | CSS visual appearance cannot be reliably asserted via E2E | 1. Drag a Gantt bar 2. Drop it 3. Verify bar appears lighter with dashed Azure border |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
