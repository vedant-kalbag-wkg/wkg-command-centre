# Handoff — WKG Command Centre (Phase 2 Complete → Phase 3 Ready)

**Date:** 2026-04-17
**Status:** Phase 2 complete (M7-M9 merged). Phase 3 planned.
**Repo:** `WeKnowTechnology/wkg-command-centre`
**Current branch:** `main`
**Uncommitted state:** `docs/HANDOFF.md` (untracked, by convention) + updated `docs/plans/phase-3-analytics-roadmap.md`

## TL;DR

Phase 2 is **done**. External analytics portal live with 5 scoped pages, invite flow with scope capture, branded emails, impersonation UI, and audit enhancements. 3 PRs merged (#4, #5, #6). **Start Phase 3 (Analytics Enhancements) — fix bugs first (M10), then flagging + maturity (M11), experiments + comparison (M12), events + actions (M13).**

## Next Action

1. Start M10 (Bug Fixes + Data Quality) — `docs/plans/phase-3-analytics-roadmap.md`
2. Fix BUG-01 (trend builder date range) and BUG-02 (pivot MoM/YoY) first
3. Use subagent-driven development with superpowers + karpathy-guidelines

## What's on `main`

```
Phase 2 (M7-M9):
  2e43441 Merge PR #6: M9 — Impersonation UI + Audit Enhancements
    - "Preview as" button in user table dropdown
    - getUserCtx honors impersonation cookies (6 action files refactored)
    - Portal impersonation banner
    - Audit dashboard userType filter (Internal/External)
    - 3 impersonation E2E tests

  a096eaf Merge PR #5: M8 — Invite Flow + Email
    - Invite dialog: userType toggle + inline scope builder
    - inviteUser action: sets userType, inserts scopes at creation time
    - 3 branded email templates (internal invite, external invite, reset)
    - Set-password scope preview for external users
    - Shared DIMENSION_OPTIONS extracted
    - 4 invite flow E2E tests

  13995fc Merge PR #4: M7 — Portal Layout + 5 Scoped Analytics Pages
    - Portal shell (layout, sidebar, index redirect)
    - 5 analytics pages (re-exports of internal pages)
    - getScopedDimensionOptions server action
    - Filter bar accepts custom fetchOptions prop
    - Business events hidden for external users
    - Middleware redirects updated
    - 8 scoping + portal E2E tests

Phase 1 (M0-M6 + Polish):
  61b5976 Merge PR #1: Phase 1 Polish
  cb5a751 Merge M6: Analytics Pages
  a19543d–8b56512: M0-M5 Foundation through ETL
```

## Test Results (post-Phase 2)

- **Vitest (unit):** 235 passed / 14 todo / 1 skipped
- **Playwright E2E:** 140 passed / 0 failed / 27 skipped
- **Typecheck:** clean (1 pre-existing heat-map.test.ts error)

## Phase 2 — All Items Complete

| # | Milestone | PR | Key Deliverables |
|---|-----------|-----|-----------------|
| M7 | Portal + Scoped Analytics | #4 | 5 portal pages, scoped filter bar, portal sidebar |
| M8 | Invite Flow + Email | #5 | Scope capture at invite, 3 branded templates, scope preview |
| M9 | Admin QA + Audit | #6 | Preview as, impersonation-aware queries, audit userType filter |

## Phase 3 — Analytics Enhancements (Next)

**Full plan:** `docs/plans/phase-3-analytics-roadmap.md`

### M10 — Bug Fixes + Data Quality (8-12h)
- Fix trend builder date range not showing (BUG-01)
- Fix pivot table MoM/YoY blank columns (BUG-02)
- Geographic hierarchy: add `markets` entity (Market → Region → Location Group)
- Hotel ownership/group mapping fixes
- Data quality dashboard (completeness scores)

### M11 — Performance Flagging + Kiosk Maturity (10-14h)
- Traffic-light thresholds (Red/Amber/Green) on analytics pages
- Flag & triage underperforming locations (Relocate/Monitor/Exception)
- High-performer comparison views
- Kiosk maturity buckets (0-1mo, 1-3mo, 3-6mo, 6+mo) as filter + segment

### M12 — Experiment Measurement + Comparison UX (10-14h)
- Year-over-year comparison toggle
- Cohort experiment analysis with control groups
- Seasonality-adjusted views + rolling averages
- Entity vs entity comparison workflow

### M13 — Event System + Insight-to-Action (8-12h)
- Complete event overlays (promotions, ops changes, holidays)
- Convert flags to trackable action items with ownership
- Outcome tracking (did the action improve the metric?)

**M11 and M12 can run in parallel after M10. M13 depends on M11.**

## Architecture Summary (Post-Phase 2)

```
src/app/
  (app)/                    ← internal users (all routes)
    analytics/              ← 7 analytics pages + filter bar + impersonation banner
    settings/users/         ← user CRUD + invite + scopes + impersonation actions
    settings/audit-log/     ← audit log with userType filter
  portal/                   ← external users
    layout.tsx              ← portal shell + sidebar (5 analytics items)
    analytics/
      layout.tsx            ← scoped filter bar + impersonation banner
      actions.ts            ← getScopedDimensionOptions (impersonation-aware)
      */page.tsx            ← 5 re-exports of internal pages
  (auth)/
    set-password/           ← scope preview for external invites
```

**Scoping flow (3 layers):**
1. Middleware: `shouldGateExternalUser()` → blocks internal routes for external users
2. Query: `scopedSalesCondition()` via `getUserCtx()` → filters data by user scopes (impersonation-aware)
3. Field: Redaction rules hide sensitive fields

**Email flow:**
- `sendResetPassword` hook in auth.ts → detects invite vs. reset via URL param → dispatches correct branded template
- 3 templates: internal invite, external invite (portal-focused), password reset

## Phase 4 — Deployment + Commission (Future)

1. Managed Postgres (RDS/Neon)
2. Swap CsvFileSource → PostgresSource behind SalesDataSource interface
3. Commission engine — salesRecords × locationProducts.% → commission ledger
4. CI/CD, IaC, monitoring, backups

## How to Resume

```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool

# Ensure on main
git checkout main && git pull

# Dev Postgres
docker ps | grep wkg-pg || docker start wkg-pg

# Sanity
npm install
npx drizzle-kit migrate
npm run db:seed                          # admin user
npm run db:seed:sales-demo               # demo locations/products
npm run db:seed:kiosks                   # 8 kiosks (varied stages)
npx vitest run                           # 235 pass
npx playwright test                      # 140 pass

# Dev server
npm run dev                              # port 3003

# Start Phase 3 (M10)
# See docs/plans/phase-3-analytics-roadmap.md
# Start with BUG-01 (trend builder) and BUG-02 (pivot MoM/YoY)
```
