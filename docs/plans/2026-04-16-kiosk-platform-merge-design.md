# Kiosk Platform Merge — Design Document

**Date:** 2026-04-16
**Status:** Approved (sections 1–5)
**Repo (target):** `wkg-kiosk-tool` (new, forked from `kiosk-management`)
**Sources being merged:**
- `/Users/vedant/Work/WeKnowGroup/data-dashboard` (analytics + reporting)
- `/Users/vedant/Work/WeKnowGroup/kiosk-management` (kiosk ops + location/product/installation mgmt)

## Goal

A single internal platform for everything kiosk — sales data, commission (future), installations, config management — with a scoped external portal (Phase 2) for hotels/venues and partners to see only their slice of analytics.

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Merge approach | Consolidate into `kiosk-management` base | Better Auth + Drizzle + vanilla Postgres is most portable to standalone DB later |
| App topology | Single Next.js app with route groups | Kiosk ops + analytics share entities; single-DB joins beat cross-service RPCs |
| Route groups | `(internal)` + `(portal)` | Hard-gate audience at middleware independent of fine-grained scope |
| MVP scope | Internal-first (Phase 1), external portal (Phase 2) | De-risk infra before adding scoping UI |
| Commission calc | Deferred to Phase 3 | `locationProducts.%` already present; join to sales later |
| Sales ingestion | CSV upload now, DB/API pull later | Abstract behind `SalesDataSource` interface |
| Monday.com integration | Removed | Replaced by unified CSV import from kiosk tool |
| Hotels vs locations | 1:1, use `locations` | Confirmed from `OutletCode`↔`hotel_name` in CSV |
| Sales granularity | Per-transaction | CSV has `Saleref`, `Din`, `Time`, per-unit `Quantity`/`Amount` |
| Existing sales data | Migrate from Supabase | One-shot ETL at cutover; not greenfield-empty |

## Section 1 — High-Level Architecture

Single Next.js app, two route groups, one Postgres DB.

```
wkg-kiosk-tool/
├── src/app/
│   ├── (internal)/                ← internal users (admin/member/viewer)
│   │   ├── kiosks/                ← ported from kiosk-management
│   │   ├── locations/
│   │   ├── installations/
│   │   ├── products/
│   │   ├── analytics/             ← ported from data-dashboard
│   │   │   ├── portfolio/
│   │   │   ├── pivot-table/
│   │   │   ├── heat-map/
│   │   │   ├── trend-builder/
│   │   │   ├── hotel-groups/
│   │   │   ├── regions/
│   │   │   └── location-groups/
│   │   └── admin/                 ← users, presets, exclusions, data, events, audit
│   ├── (portal)/                  ← Phase 2 — external users (stubbed in Phase 1)
│   │   └── portal/analytics/
│   ├── api/                       ← route handlers (auth-gated)
│   └── (auth)/                    ← login, accept-invite, reset password
├── src/db/schema.ts               ← Drizzle, extended
├── src/lib/auth/                  ← Better Auth + scope helpers
├── src/lib/ingestion/             ← SalesDataSource interface + CsvFileSource
├── src/lib/scoping/               ← scopedQuery — single source of truth
└── src/lib/analytics/             ← enrichment, attribution, exclusion
```

**Key ideas:**
- Single app, single DB — entities shared across ops and analytics.
- Route groups enforce audience in middleware, independent of scope.
- `scopedQuery()` is the security backbone — every analytics query flows through it.
- Ingestion is interface-backed so swapping CSV → DB sync is contained.

## Section 2 — Data Model

### Kept as-is (from kiosk-management)
- `user`, `session`, `account` (Better Auth)
- `kiosks`, `locations`, `installations`, `products`, `kioskAssignments`
- `locationProducts` (has `%` rates — reserved for future commission)
- `auditLogs`, `userViews`, `duplicateDismissals`

### Extended
- `user` gains:
  - `userType: 'internal' | 'external'` (default `'internal'`)
  - `role` unchanged (`admin | member | viewer`)
- `locations` gains hotel dimension fields from data-dashboard:
  - `numRooms`, `starRating`, `hotelAddress`, `liveDate`, `launchPhase`, `keyContactName`, `keyContactEmail`, `financeContact`, `maintenanceFee`

### New — analytics dimensions (ported from data-dashboard)
- `hotelGroups` — chains/portfolios
- `regions` — geographic rollups
- `locationGroups` — ad-hoc reporting groupings
- `providers` — product vendors
- `outletExclusions` — pattern-based filter rules
- Membership join tables as needed

### New — sales fact
- `salesRecords` — per-transaction, FK to `locations` + `products` + `providers`. Fields: `saleRef`, `refNo`, `transactionDate`, `transactionTime`, `quantity`, `grossAmount`, `netAmount`, `discountCode`, `discountAmount`, `bookingFee`, `saleCommission`, `supplier`, `customer*`, `pickup/dropoff`, currency. Indexes on `(locationId, transactionDate)`, `(productId, transactionDate)`, `(providerId, transactionDate)`.
- `salesImports` — per-upload metadata: filename, uploadedBy, rowCount, dateRange, status, errors, sourceHash.
- `importStagings` — raw CSV rows pre-validation (for rollback/review before commit).

### New — analytics UX
- `analyticsPresets` — saved filter/dimension configs (ported from `presets`)
- `analyticsSavedViews` — saved analytics views (distinct from `userViews` which is ops-side)
- `eventCategories`, `businessEvents` — for trend-builder overlays
- `weatherCache` — cached weather API responses for correlation analytics
- `eventLog` — lightweight analytics usage tracking

### New — scoping (security backbone)
- `userScopes` — `(userId, dimensionType, dimensionId)`. Dimension types: `hotel_group`, `location`, `region`, `product`, `provider`, `location_group`. Multiple rows per user = union.
- `scopePresets` (optional) — named bundles admins can apply.

### Code-enforced invariants
1. Every `salesRecords` query must pass through `scopedQuery(user, baseQuery)` — ESLint custom rule + code review.
2. `userType = 'external'` requires ≥1 `userScope` row (application + DB guard).
3. No `userType = 'external'` with `role = 'admin'` combination.

## Section 3 — Auth & RBAC

### Base
Better Auth (email/password, invite-only, session cookies) kept from kiosk-management.

### User matrix

| `userType` | `role` | Lands on | Sees |
|---|---|---|---|
| `internal` | `admin` | `(internal)` | Everything, unrestricted |
| `internal` | `member` | `(internal)` | Everything except sensitive fields (contracts, banking) redacted |
| `internal` | `viewer` | `(internal)` | Read-only, redacted |
| `external` | n/a | `(portal)` only | Only analytics, scoped to `userScopes` |

### Scoping rules
- Internal admins: 0 scope rows = unrestricted.
- Internal member/viewer: 0 rows = unrestricted; rows = union-scoped.
- External users: ≥1 row required, enforced at invite-accept and DB level.

### Three enforcement layers
1. **Middleware** (`src/middleware.ts`) — route group gating by `userType`.
2. **`scopedQuery()` helper** — injects dimension filters on every analytics query; linted.
3. **Field redaction** — existing kiosk-management logic, extended to fully strip operational data for external users.

### Invite flow
- Admin invite form: email, dimension scopes (multi-select), optional expiry.
- Scopes editable post-creation via user admin page.
- All scope changes logged in `auditLogs` with old/new diff.

### Impersonation (ported from data-dashboard)
- Admin → "View as [user]" → session stamps `impersonatedUserId`.
- `scopedQuery` uses impersonated user's scopes.
- Works across audiences (admin can impersonate external user → lands in `/portal`).
- Start/stop logged in `auditLogs`.

## Section 4 — Migration Phasing

### Phase 1 — Internal-first POC (this engagement)
1. Repo setup — fork `kiosk-management` → `wkg-kiosk-tool`.
2. Schema — Drizzle migration with all new analytics + scoping tables + `userType`/`userScopes`.
3. Auth extensions — `userType` column, `userScopes` CRUD, invite UI updates, redaction rules.
4. CSV ingestion — port data-dashboard's admin data importer; `SalesDataSource` interface with `CsvFileSource` impl.
5. **Data migration from Supabase** — one-shot ETL script reading data-dashboard's Supabase Postgres, writing to new Postgres. Migrates: `salesRecords`, `presets`, `outlet_exclusions`, `event_categories`, `business_events`, `saved_views`, `profiles` + `user_permissions` → `user` + `userScopes`. Idempotent, re-runnable, with verification pass.
6. Port analytics pages — `portfolio`, `pivot-table`, `heat-map`, `trend-builder`, `hotel-groups`, `regions`, `location-groups`, admin (`presets`, `outlet-exclusions`, `events`, `data`, `users`). Rewrite Supabase calls → Drizzle via `scopedQuery()`.
7. Unify navigation — top groups: Operations / Analytics / Admin.
8. Port enrichment logic from data-dashboard — monthly kiosk-hotel attribution (using kiosk-management's `kioskAssignments` temporal table), outlet exclusion application, any other derived fields analytics depends on.
9. Weather cache service — port from data-dashboard.
10. External portal stub — middleware rejects `external` users with "coming soon".
11. Playwright E2E — happy path + auth boundary tests for every route.
12. Decommission plan — runbook for shutting down both old apps.

**Not in Phase 1:** Monday.com integration (dropped), commission calc, external portal UI.

### Phase 2 — External portal
1. Portal-specific layout (simplified nav, external branding).
2. Scoped analytics pages (subset of internal).
3. External invite flow polish, branded email templates.
4. Scope-QA tooling for admins (impersonate + preview).
5. Audit/observability for external access.

### Phase 3 — Deployment hardening + commission
1. Move Postgres to managed (RDS/Neon/self-hosted).
2. Swap `CsvFileSource` → `PostgresSource` or `MondaySource` behind same interface.
3. Commission engine — join `salesRecords × locationProducts.%` → commission ledger.
4. Real CI/CD, IaC, monitoring, backups.

## Section 5 — Production-Ready Testing & Quality

### Test Pyramid

**Unit (Vitest):**
- `scopedQuery()` — every dimension type, union semantics, admin bypass, external-must-have-scope invariant, empty-scope edge cases.
- CSV parser — malformed rows, duplicate Salerefs, date format variants, unknown outlets, whitespace, encoding.
- Redaction helpers — every `userType × role × field` combination.
- Enrichment logic — kiosk-hotel temporal attribution, outlet exclusion, discount handling.
- Commission rate lookup (even though calc is deferred).
- Target: 80%+ coverage on `src/lib/**`.

**Integration (Vitest + Testcontainers Postgres):**
- Real Postgres per test file; migrations applied; seed; assert.
- Scoping enforcement golden-path — 2 hotel groups, 3 users with different scopes, assert correct row visibility.
- CSV import E2E — upload → staging → commit → verify `salesRecords` + `salesImports` + `auditLogs`.
- Migration script — seed mini-Supabase snapshot, run ETL, assert row counts + FK integrity.
- Invite flow with scopes — full cycle, token expiry, double-accept, scope changes.
- DB constraint tests — external user without scope rejected.

**E2E (Playwright), tiered:**

*Tier A: Critical auth/scoping boundary (blocking, ~15 tests):*
- External user → 403 on every `(internal)` route.
- Internal viewer → 403 on every mutation endpoint.
- Unauthenticated → redirect on every protected route.
- Impersonation preserves/restores admin session.
- External user sees ONLY scoped rows on every analytics page.

*Tier B: Feature happy paths (~20 tests):*
- Every analytics page loads, renders, exports.
- Dimension management CRUD.
- Admin: users, scopes, presets, exclusions CRUD.
- CSV import: happy + error + large (10k rows).

*Tier C: Error & edge cases (~15 tests):*
- Expired sessions, invalid tokens, concurrent imports, pagination, empty states, scope-removed-mid-session.

### Non-Functional

**Performance:**
- 1M+ seeded `salesRecords` from real CSV exports.
- p95 < 500ms on scoped analytics queries; CI fails on >20% regression.
- Lighthouse CI on critical pages, LCP < 2.5s.
- `EXPLAIN ANALYZE` assertions on hot query paths.

**Security:**
- Row-scoping fuzz tests (SQL injection, path traversal in filter values).
- Auth boundary enumeration — every route × every user type.
- Dependency scanning (`npm audit` + Dependabot).
- ESLint custom rule — no raw `salesRecords` queries outside `scopedQuery()`.
- Secret scanning (gitleaks) in pre-commit + CI.
- CSP headers + CSRF (Better Auth) verified.

**Accessibility:**
- `@axe-core/playwright` in every Tier B test. Zero serious/critical violations.
- Keyboard-nav tests on login, invite-accept, core tables.

**Visual regression:**
- Playwright snapshots on login, dashboard landings, core charts. Reviewed in PR.

**Database migrations:**
- Up + down tested against prod-shape snapshot on every PR.
- Migration perf budget < 60s online; slower = documented runbook.

**Resilience / fault injection:**
- Mid-file CSV failure → staging untouched (atomic commit).
- Concurrent imports → one wins, other rejected cleanly.
- Supabase→Postgres ETL partial failure → resume from checkpoint.
- Weather cache failure → analytics pages still render.

### Observability
- Structured logs (Pino) — `userId`, `userType`, `impersonatedUserId`, `traceId`, route, duration, status.
- Sentry — user context (userId only, no PII); source maps uploaded.
- Metrics — request rate, error rate, query latency p50/p95/p99 by route. OTEL export.
- Alerts — error spike, p95 latency, auth failure rate, import failure, DB pool exhaustion.
- Monthly `auditLogs` review for anomalies.

### CI/CD

```
PR opened
  ├─ Lint (ESLint + custom rules)            [blocking]
  ├─ Typecheck                                [blocking]
  ├─ Unit tests                               [blocking]
  ├─ Integration tests (Testcontainers)       [blocking]
  ├─ E2E Tier A (auth boundary)               [blocking]
  ├─ E2E Tier B+C (features + edges)          [blocking]
  ├─ Axe accessibility                        [blocking — zero serious]
  ├─ Lighthouse CI                            [advisory]
  ├─ Migration up+down on fresh DB            [blocking]
  ├─ Security: npm audit + gitleaks           [blocking]
  └─ Build

Merge to main
  ├─ All of above
  ├─ Deploy to staging
  ├─ Smoke test on staging
  └─ Manual promote to prod (automate later)
```

### Staging
- Prod-schema mirror, PII-scrubbed subset of real data.
- Per-PR preview deploys (Vercel-style).
- Internal dogfooding required before prod promotion.

### Documentation Deliverables
- `README.md` — setup, test, deploy.
- `docs/ARCHITECTURE.md` — system diagram + data flow.
- `docs/SCOPING.md` — scope rules + examples.
- `docs/MIGRATION-FROM-SUPABASE.md` — ETL cutover runbook.
- `docs/RUNBOOKS/` — failed import, user lockout, scope misconfiguration, DB restore.

## Open Questions (for implementation plan)

- Exact Supabase connection approach for ETL — read-replica, dump/restore, or direct app connection?
- Staging environment host — Vercel preview, or separate?
- Error tracking vendor — Sentry confirmed, or alternative?
- OTEL export target — Honeycomb / Datadog / Grafana Cloud?

## Next Step

Transition to `writing-plans` skill to produce a detailed implementation plan for Phase 1.
