# Phase 2 — External Portal

**Date:** 2026-04-17
**Status:** Planning
**Prerequisite:** Merge PR #1 (Phase 1 polish) to `main`

## Goal

Give hotel partners and venue operators a scoped, read-only analytics portal where they
see only the data they've been granted access to — without exposing internal operations
(kiosks, installations, pipeline).

## What Already Exists

| Component | Status | Key Files |
|-----------|--------|-----------|
| Middleware gating | Done | `src/proxy.ts`, `src/lib/auth/gating.ts` |
| Coming-soon stub page | Done | `src/app/portal/coming-soon/page.tsx` |
| Scoping backbone | Done | `src/lib/scoping/scoped-query.ts` |
| User scopes CRUD + audit | Done | `src/app/(app)/settings/users/[id]/scopes-*.ts` |
| Impersonation (cookies) | Done | `src/app/(app)/settings/users/impersonation-actions.ts` |
| External user redirect tests | Done | `tests/scoping/external-user-redirect.spec.ts` |
| Email transport | Done | `src/lib/email.ts` |

## Milestones

### M7 — Portal Layout & Scoped Analytics (core)

**M7.1: Portal shell**
- Create `src/app/portal/layout.tsx` with simplified nav (analytics only, no ops)
- WeKnow-branded header with user name, sign-out button
- Responsive sidebar with only the analytics pages the user can access
- Remove coming-soon redirect once portal is live

**M7.2: Scoped analytics pages (5 pages)**
- `/portal/analytics/portfolio` — Portfolio overview
- `/portal/analytics/heat-map` — Performance heat map
- `/portal/analytics/trend-builder` — Trend builder (without business events)
- `/portal/analytics/regions` — Regional breakdown
- `/portal/analytics/hotel-groups` — Hotel group breakdown

Implementation: Reuse existing analytics components and server actions. Wrap all data
fetching with `scopedSalesCondition()` using `honorImpersonation: false` (external users
should never impersonate). The same components render for both internal and portal routes —
only the layout and data scoping differ.

**M7.3: Portal filter bar**
- Same `AnalyticsFilterBar` component but pre-scoped: dimension options only show
  locations/products/groups the user has scope access to
- `getDimensionOptions()` must be filtered by user scopes

**M7.4: Scoping enforcement tests**
- Enable the skipped `tests/scoping/scoping-enforcement.spec.ts` tests
- Add E2E tests for portal analytics pages with scoped external users
- Verify: external user scoped to hotel_group=A sees only HG-A data

### M8 — Invite Flow & Email Polish

**M8.1: Scope capture at invite time**
- Extend invite dialog: add multi-select for user type (internal/external)
- When external selected: require ≥1 scope selection (dimension type + dimension)
- Create user + scopes in a transaction

**M8.2: Branded email templates**
- External invite email with WeKnow branding, scope summary, portal URL
- Password reset email with portal-specific messaging
- Use MJML or inline HTML for email templates

**M8.3: Invite acceptance improvements**
- Set-password page shows scope preview ("You'll have access to: Hotel Group A, Region London")
- After password set, redirect to `/portal/analytics/portfolio` (not `/login`)

### M9 — Admin QA Tooling & Audit

**M9.1: Impersonation UI**
- "Preview as" button on user detail page (admin only)
- When impersonating an external user, admin sees the portal layout with that user's scopes
- Banner at top: "Previewing as [User Name] — Exit preview"
- Already wired: `startImpersonation()`/`stopImpersonation()` + cookies

**M9.2: Scope preview**
- Admin can preview which analytics data a scoped user would see
- Reuse impersonation with `honorImpersonation: true` on queries

**M9.3: Audit dashboard enhancements**
- Filter audit log by `userType=external` to review external access patterns
- Show scope changes in user detail audit timeline
- Log portal page views for external users (via `eventLog` table)

## Architecture Notes

**Route structure:**
```
src/app/
  (app)/          ← internal users (existing)
  portal/
    layout.tsx    ← portal shell (Phase 2)
    analytics/
      portfolio/page.tsx
      heat-map/page.tsx
      trend-builder/page.tsx
      regions/page.tsx
      hotel-groups/page.tsx
```

**Scoping flow (3 layers, all existing):**
1. Middleware: `shouldGateExternalUser()` → blocks `/kiosks`, `/locations`, etc.
2. Query: `scopedSalesCondition()` → filters sales data to user's scopes
3. Field: Redaction rules hide sensitive fields (contract values, banking details)

**New gating update needed:** Change `src/lib/auth/gating.ts` to allow portal analytics
routes for external users (currently only `/portal/coming-soon` is allowed).

## Success Criteria

- [ ] External user can log in and see scoped analytics dashboard
- [ ] External user sees only locations/products they're scoped to
- [ ] External user cannot access any internal operations pages
- [ ] Admin can preview what an external user sees (impersonation)
- [ ] Invite flow captures scopes for new external users
- [ ] All scoping enforcement tests pass
- [ ] Playwright E2E coverage for portal happy paths

## Estimated Effort

| Milestone | Est. Hours | Dependencies |
|-----------|-----------|-------------|
| M7 (portal + analytics) | 12-16h | PR #1 merged |
| M8 (invite + email) | 6-8h | M7 |
| M9 (admin QA + audit) | 4-6h | M7 |
| **Total** | **22-30h** | |
