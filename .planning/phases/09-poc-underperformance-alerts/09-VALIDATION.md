---
phase: 9
slug: poc-underperformance-alerts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `09-RESEARCH.md` § Validation Architecture (lines 701-775).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (two projects: `unit` + `integration`) + Playwright 1.x |
| **Config files** | `vitest.config.ts` (root), `playwright.config.ts` (root) |
| **Quick run command** | `npx vitest run --project unit src/lib/performance-alerts/ src/emails/__tests__/poc-underperformance.test.ts` |
| **Full unit suite** | `npx vitest run --project unit` |
| **Full integration suite** | `npx vitest run --project integration` |
| **Playwright preview** | `PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/admin/performance-alerts/ tests/kiosks/silence.spec.ts` |
| **Estimated full-suite runtime** | ~90s unit + ~120s integration + ~60s Playwright (preview alias) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project unit src/lib/performance-alerts/ src/emails/__tests__/poc-underperformance.test.ts`
- **After every plan wave:** Full unit + integration suites listed above
- **Before `/gsd-verify-work`:** Full suite green AND Playwright admin specs green against preview alias
- **Max feedback latency:** ~30s per task commit (subset run)

---

## Per-Task Verification Map

> Plan IDs are placeholders pending PLAN.md emission. Planner MUST update Wave / Plan / Task ID columns to match the final PLAN.md decomposition.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| POC-ALERT-01 (a) | Eligibility filter: only `Live` + `outlet_code IS NOT NULL` + `archived_at IS NULL` + `alert_silenced_at IS NULL` kiosks classify | integration | `npx vitest run --project integration tests/performance-alerts/eligibility.integration.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (b) | `decideAlert(prior, new, lastAlertedAt, now)` flip-in / chronic / no-alert pure logic | unit | `npx vitest run --project unit src/lib/performance-alerts/classify-dispatch.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (c) | Per-POC batching: N kiosks owned by one POC → 1 email; M kiosks across N POCs → N emails | unit | `npx vitest run --project unit src/lib/performance-alerts/poc-batching.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (d) | NULL POC → silent skip + `email_log` row with skip status | integration | `npx vitest run --project integration tests/performance-alerts/null-poc-skip.integration.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (e) | Idempotency: re-run within same ISO week → no duplicate emails (rides existing `email_log` partial unique idx) | integration | `npx vitest run --project integration tests/performance-alerts/idempotency.integration.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (f) | ISO week boundary: 2026-12-28 Mon, 2027-01-03 Sun, 2027-01-04 Mon | unit | `npx vitest run --project unit src/lib/performance-alerts/iso-week.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (g) | Email template renders to non-empty HTML + plain-text equivalent has all kiosk rows | unit | `npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (h) | Admin "Run now" server action — admin-only RBAC, posts inngest event, writes `audit_logs` row | integration | `npx vitest run --project integration tests/admin/performance-alerts.integration.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (i) | Admin per-kiosk silence toggle — admin-only RBAC, mutates `kiosks.alert_silenced_at` + `alert_silenced_reason`, writes audit | integration | `npx vitest run --project integration tests/kiosks/silence-toggle.integration.test.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (j) | E2E: admin signs in → `/admin/performance-alerts` → "Run now" → flash message + audit row visible | e2e | `PLAYWRIGHT_BASE_URL=<preview> npx playwright test tests/admin/performance-alerts.spec.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (k) | E2E: admin signs in → `/kiosks/[id]` → silence kiosk with reason → reload → silenced state visible | e2e | `PLAYWRIGHT_BASE_URL=<preview> npx playwright test tests/kiosks/silence.spec.ts` | ❌ W0 | ⬜ pending |
| POC-ALERT-01 (l) | Manual UAT: real cron fires Mondays 09:00 London (operator-driven; Inngest dashboard) | manual-only | (operator runbook in `09-SUMMARY.md`) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Test files that MUST exist before downstream waves can mark verify ✅. Planner emits these as Wave 0 tasks (failing-by-default test stubs).

- [ ] `tests/performance-alerts/eligibility.integration.test.ts` — covers (a)
- [ ] `tests/performance-alerts/null-poc-skip.integration.test.ts` — covers (d)
- [ ] `tests/performance-alerts/idempotency.integration.test.ts` — covers (e); SUPERSEDES the placeholder in `tests/email/send-email-fn.integration.test.ts` lines 119-158 (Phase 8 comment explicitly invites Phase 9 to swap it to `template: "poc-underperformance"`)
- [ ] `src/lib/performance-alerts/classify-dispatch.test.ts` — covers (b)
- [ ] `src/lib/performance-alerts/poc-batching.test.ts` — covers (c)
- [ ] `src/lib/performance-alerts/iso-week.test.ts` — covers (f)
- [ ] `src/emails/__tests__/poc-underperformance.test.ts` — covers (g); pattern: clone `src/emails/__tests__/helpers/render-snapshot.ts` usage
- [ ] `tests/admin/performance-alerts.integration.test.ts` — covers (h)
- [ ] `tests/kiosks/silence-toggle.integration.test.ts` — covers (i)
- [ ] `tests/admin/performance-alerts.spec.ts` (Playwright) — covers (j)
- [ ] `tests/kiosks/silence.spec.ts` (Playwright) — covers (k)

No new framework install required — Vitest + Playwright already in `package.json` and used by Phase 8.

---

## Synthetic Test Fixtures (seed in `beforeEach`)

The integration tests need a deterministic kiosk fleet. Seed via `setupTestDb()` (existing helper used by Phase 8 integration tests), then insert:

| Kiosk | Pipeline stage | outlet_code | archived_at | silenced_at | POC | Sales window | Expected tier | Expected decision |
|-------|---------------|-------------|-------------|-------------|-----|--------------|---------------|-------------------|
| K1 | `pipeline_stage_id_live` | "K001" | null | null | user_alpha | £100 (low) | bottom | flip-in (no prior state) |
| K2 | `pipeline_stage_id_live` | "K002" | null | null | user_alpha | £200 (low) | bottom | flip-in — batches with K1 in user_alpha email |
| K3 | `pipeline_stage_id_live` | "K003" | null | null | user_beta | £150 (low) | bottom | flip-in — separate email to user_beta |
| K4 | `pipeline_stage_id_live` | "K004" | null | null | null | £100 (low) | bottom | skip-no-poc (`email_log` row, no email) |
| K5 | `pipeline_stage_id_live` | "K005" | null | NOW() | user_alpha | £100 | EXCLUDED | excluded (silenced) |
| K6 | `pipeline_stage_id_live` | null | null | null | user_alpha | £100 | EXCLUDED | excluded (NULL outlet_code) |
| K7 | Prospect (any non-Live) | "K007" | null | null | user_alpha | £100 | EXCLUDED | excluded (not Live) |
| K8 | `pipeline_stage_id_live` | "K008" | NOW() | null | user_alpha | £100 | EXCLUDED | excluded (archived) |
| K9 | `pipeline_stage_id_live` | "K009" | null | null | user_alpha | £999 (high) | top | no-alert |
| K10 | `pipeline_stage_id_live` | "K010" | null | null | user_alpha | £200 | bottom (prior=bottom) | chronic if `last_alerted_at` ≥30d ago, else no-alert |

After `weeklyPocAlertsFn` runs:
- `email_log` has **2 sent rows** (user_alpha batches K1+K2+K10, user_beta gets K3) + **1 skip row** (K4) = **3 rows total**.
- Re-running within same ISO week → **0 new sent rows** (idempotency via `payloadHash` partial unique idx).
- `kiosk_performance_alert_state` has rows for K1, K2, K3, K4, K9, K10 (NOT K5/K6/K7/K8 — excluded entirely per Research § Pitfall 4).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Inngest cron fires Mondays 09:00 Europe/London | POC-ALERT-01 (l) | Tz-aware cron behavior + DST handling cannot be deterministically asserted in CI without time-travel; depends on Inngest's server-side scheduler | Operator runbook in `09-SUMMARY.md`: confirm Inngest dashboard shows next-run = Monday 09:00 London; confirm DST transitions don't double-fire |
| Real-inbox deliverability of `poc-underperformance` template via Resend | POC-ALERT-01 (l) | Resend dashboard + real inbox required to verify spam-folder placement, image rendering, deep-link integrity | Trigger "Run now" against preview alias with a throwaway `internal_poc_id` user; check inbox + Resend dashboard; clean up throwaway user after |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ W0` references in the verification map
- [ ] No watch-mode flags (CI-safe `npx vitest run` only)
- [ ] Feedback latency < 30s for the per-commit subset
- [ ] `nyquist_compliant: true` set in frontmatter once planner finalizes the per-task map

**Approval:** pending — planner to finalize task IDs and waves, then flip `nyquist_compliant: true`.
