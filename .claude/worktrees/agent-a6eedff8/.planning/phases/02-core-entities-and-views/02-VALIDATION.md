---
phase: 02
slug: core-entities-and-views
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.58.2 |
| **Config file** | `playwright.config.ts` |
| **Quick run command** | `npx playwright test tests/smoke.spec.ts` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test tests/smoke.spec.ts`
- **After every plan wave:** Run `npx playwright test tests/kiosks/ tests/locations/`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | KIOSK-01 | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | KIOSK-02 | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | KIOSK-03 | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 2 | KIOSK-04 | E2E | `npx playwright test tests/kiosks/pipeline-stages.spec.ts` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 2 | KIOSK-05, KIOSK-06 | E2E | `npx playwright test tests/kiosks/kiosk-assignment.spec.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | LOC-01, LOC-02 | E2E | `npx playwright test tests/locations/location-crud.spec.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | LOC-03 | E2E | `npx playwright test tests/locations/location-contract.spec.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | LOC-04 | E2E | `npx playwright test tests/locations/location-rbac.spec.ts` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 2 | LOC-05 | E2E | `npx playwright test tests/locations/location-kiosks-tab.spec.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | VIEW-01, VIEW-02, VIEW-03 | E2E | `npx playwright test tests/kiosks/table-view.spec.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 2 | VIEW-04, VIEW-05 | E2E | `npx playwright test tests/kiosks/saved-views.spec.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 1 | KANBAN-01, KANBAN-02 | E2E | `npx playwright test tests/kiosks/kanban.spec.ts` | ❌ W0 | ⬜ pending |
| 02-04-02 | 04 | 1 | KANBAN-03 | E2E | `npx playwright test tests/kiosks/kanban.spec.ts` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 1 | BULK-01 | E2E | `npx playwright test tests/kiosks/bulk-operations.spec.ts` | ❌ W0 | ⬜ pending |
| 02-05-02 | 05 | 1 | BULK-02 | E2E | `npx playwright test tests/kiosks/bulk-operations.spec.ts` | ❌ W0 | ⬜ pending |
| 02-05-03 | 05 | 2 | AUDIT-01, AUDIT-02 | E2E | `npx playwright test tests/audit/audit-log.spec.ts` | ❌ W0 | ⬜ pending |
| 02-05-04 | 05 | 2 | AUDIT-03 | E2E | `npx playwright test tests/audit/audit-log.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/kiosks/kiosk-crud.spec.ts` — stubs for KIOSK-01, KIOSK-02, KIOSK-03
- [ ] `tests/kiosks/pipeline-stages.spec.ts` — stubs for KIOSK-04
- [ ] `tests/kiosks/kiosk-assignment.spec.ts` — stubs for KIOSK-05, KIOSK-06
- [ ] `tests/locations/location-crud.spec.ts` — stubs for LOC-01, LOC-02
- [ ] `tests/locations/location-contract.spec.ts` — stubs for LOC-03 (may mock S3 in CI)
- [ ] `tests/locations/location-rbac.spec.ts` — stubs for LOC-04
- [ ] `tests/locations/location-kiosks-tab.spec.ts` — stubs for LOC-05
- [ ] `tests/kiosks/table-view.spec.ts` — stubs for VIEW-01, VIEW-02, VIEW-03
- [ ] `tests/kiosks/saved-views.spec.ts` — stubs for VIEW-04, VIEW-05
- [ ] `tests/kiosks/kanban.spec.ts` — stubs for KANBAN-01, KANBAN-02, KANBAN-03
- [ ] `tests/kiosks/bulk-operations.spec.ts` — stubs for BULK-01, BULK-02
- [ ] `tests/audit/audit-log.spec.ts` — stubs for AUDIT-01, AUDIT-02, AUDIT-03
- [ ] `tests/helpers/auth.ts` — shared fixture: login as admin/member/viewer
- [ ] `tests/helpers/db.ts` — shared fixture: create test kiosk/location records

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag-and-drop feel/smoothness | KANBAN-02 | Visual UX quality cannot be asserted programmatically | Drag a card between columns; verify smooth animation, no jank |
| File upload progress indicator | LOC-03 | Progress bar timing is visual | Upload a contract PDF; verify progress indicator appears and completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
