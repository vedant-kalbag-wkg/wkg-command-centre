---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (latest) |
| **Config file** | `playwright.config.ts` — Wave 0 creation required |
| **Quick run command** | `npx playwright test --grep @smoke` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --grep @smoke`
- **After every plan wave:** Run `npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | — | smoke | `npx playwright test --grep @smoke` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | AUTH-01 | E2E | `npx playwright test tests/auth/login.spec.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | AUTH-01 | E2E | `npx playwright test tests/auth/signup-blocked.spec.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | AUTH-02 | E2E | `npx playwright test tests/auth/session-persistence.spec.ts` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 2 | AUTH-03 | E2E | `npx playwright test tests/auth/password-reset.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | AUTH-04 | E2E | `npx playwright test tests/admin/invite-user.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | AUTH-04 | E2E | `npx playwright test tests/admin/change-role.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 3 | AUTH-04 | E2E | `npx playwright test tests/admin/deactivate-user.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 3 | AUTH-05 | E2E | `npx playwright test tests/rbac/sensitive-fields.spec.ts` | ❌ W0 | ⬜ pending |
| 01-03-05 | 03 | 3 | AUTH-05 | E2E | `npx playwright test tests/rbac/viewer-controls.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `playwright.config.ts` — configure baseURL, webServer, screenshot on failure, storageState for auth
- [ ] `tests/auth/login.spec.ts` — covers AUTH-01 (login + validation errors)
- [ ] `tests/auth/signup-blocked.spec.ts` — covers AUTH-01 (invite-only enforcement)
- [ ] `tests/auth/session-persistence.spec.ts` — covers AUTH-02
- [ ] `tests/auth/password-reset.spec.ts` — covers AUTH-03
- [ ] `tests/admin/invite-user.spec.ts` — covers AUTH-04
- [ ] `tests/admin/change-role.spec.ts` — covers AUTH-04
- [ ] `tests/admin/deactivate-user.spec.ts` — covers AUTH-04
- [ ] `tests/rbac/sensitive-fields.spec.ts` — covers AUTH-05
- [ ] `tests/rbac/viewer-controls.spec.ts` — covers AUTH-05
- [ ] `tests/auth/setup.ts` — shared auth state setup (save logged-in state for reuse)
- [ ] Framework install: `npm init playwright@latest` if not already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Password reset email delivery | AUTH-03 | Requires email provider integration | Trigger reset, check Mailtrap/Resend inbox |
| Circular Pro font rendering | — | Visual verification | Inspect login page in browser, confirm font-family |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
