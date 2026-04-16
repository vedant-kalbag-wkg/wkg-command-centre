# Handoff — WKG Kiosk Platform (Phase 1, M3 ready to merge)

**Date:** 2026-04-16
**Status:** M0 + M1 + M2 merged to `main`. **M3 (Auth Extensions) implementation complete on `phase-1/m3-auth` — ready for merge.**
**Current branch:** `phase-1/m3-auth`
**Uncommitted state:** Clean (only this `docs/HANDOFF.md` is untracked — by convention; see "Notes" below).

## TL;DR

The `wkg-kiosk-tool` repo merges `data-dashboard` (analytics) and `kiosk-management` (ops) into a unified internal kiosk platform, with a scoped external portal planned for Phase 2. Four Phase-1 milestones are complete: foundation bootstrap, schema extensions, scoping security backbone, and now auth extensions. Next work is Milestone 4 — CSV ingestion.

## What's on `main`

```
7824058 Merge M2: Scoping Backbone
ffce4da Merge M1: Schema Extensions
8b56512 Merge M0: Foundation Bootstrap
5014b46 docs: initial design for kiosk-platform merge
```

(M3 not yet merged — see "Ready-to-merge branch" below.)

### Milestone 0 — Foundation Bootstrap
- Imported kiosk-management codebase as `wkg-kiosk-tool`; cleaned of agent-worktree state, planning artifacts, carryover CI workflows.
- Renamed project in `package.json` + stub `README.md`.
- Dev Postgres container (`wkg-pg`) + `wkg_kiosk_dev` DB, admin + pipeline-stages seeded.
- Playwright baseline captured: 70 passed / 29 skipped / 12 failed (12 failures inherited from upstream, documented in deferred backlog).

### Milestone 1 — Schema Extensions
- Testcontainers harness, `userType` enum on `user`, schema drift reconciliation (migration 0004), `userScopes` table, locations hotel-dimension fields, analytics dimension tables (hotel_groups / regions / location_groups + 3 membership tables), sales fact pipeline (`salesRecords` / `salesImports` / `importStagings`), all remaining analytics tables ported from data-dashboard.
- Fresh-DB migration produces 37 tables via 10 clean migrations (0000–0009).

### Milestone 2 — Scoping Backbone
- `buildScopeFilter()` (pure, 13 unit tests) + `scopedSalesCondition()` (Drizzle-bound, 7 integration tests). Admin bypass, external-must-have-scope invariant, dimension union semantics.
- Custom ESLint rule `wkg/no-raw-sales-query` flags raw `db.select()/delete()/update()/insert()` on `salesRecords` outside allow-listed paths.
- Playwright scoping stub captures the E2E contract; skipped until M6 analytics routes land.

## Ready-to-merge branch — `phase-1/m3-auth`

Six commits on the branch, all Tasks 3.1 → 3.5 covered:

```
a9d0fff test(e2e): external-user middleware gating spec          (Task 3.5)
1c48dab fix(auth): split server-action file + widen audit entity_id to text
766ef9c feat(admin): manage userScopes via row-action dialog     (Task 3.4)
be7cbf4 feat(auth): userScopes CRUD server actions with audit logging (Task 3.3)
34bd419 feat(auth): extend redaction to strip contact fields for external users (Task 3.2)
3cbc2d4 feat(auth): middleware gates external users to portal stub (Task 3.1)
```

### What landed in M3

- **Task 3.1 — Middleware gating.** `src/proxy.ts` reads `session.user.userType` and redirects external users to `/portal/coming-soon` for any non-allow-listed path (allow-list: `/portal/`, `/login`, `/reset-password`, `/set-password`, `/api/auth/`). Pure helper `shouldGateExternalUser` in `src/lib/auth/gating.ts` (6 unit tests). Better Auth `user.additionalFields.userType` wired in `src/lib/auth.ts` so the column actually surfaces on the session — without this the gate would never fire. Stub portal page at `src/app/portal/coming-soon/page.tsx` with sign-out.
- **Task 3.2 — Field redaction respects userType.** `canAccessSensitiveFields` and `redactSensitiveFields` in `src/lib/rbac.ts` now take a `UserCtx` ({ userType, role }). External users always fail the check; they additionally lose `keyContactName`, `keyContactEmail`, `financeContact`, `maintenanceFee` on top of the existing banking/contract redactions. Three call sites in `src/app/(app)/locations/` updated. 19 unit tests cover the full matrix.
- **Task 3.3 — userScopes CRUD server actions.** Public actions in `src/app/(app)/settings/users/[id]/scopes-actions.ts` (`listScopes`, `addScope`, `removeScope`) gate on `requireRole('admin')` then delegate to internal helpers in the sibling `scopes-internal.ts`. Invariants: dimensionType validated against the enum, `addScope` is idempotent on the unique triple via `onConflictDoNothing`, `removeScope` refuses to remove the last remaining scope from an external user. Every mutation writes an `auditLogs` entry (action=assign|unassign). 14 integration tests against testcontainers Postgres.
- **Task 3.4 — Manage Scopes admin UI.** Dialog (`src/components/admin/manage-scopes-dialog.tsx`) opened from the user-table row dropdown — chosen over a per-user detail page to match the existing dialog-driven admin UX (ChangeRoleDialog, EditUserDialog, etc.). Lists scopes in a small table with per-row Remove buttons (aria-labelled for testability), inline Add form with dimension-type Select + free-text dimension ID Input, Enter submits. All errors surfaced via sonner toasts. Playwright spec covers open / add / add-then-remove flows.
- **Task 3.5 — Verification gate.** Vitest 127 pass / 14 todo / 1 skip. Playwright 87 pass / 31 skip / 5 fail (all 5 in pre-existing deferred backlog — zero M3 regressions; +16 passes vs M2 baseline). ESLint 41 errors / 137 warnings (M2 baseline preserved). Typecheck clean. New `tests/scoping/external-user-redirect.spec.ts` (5 specs) seeds a real external user via `auth.api.createUser`, signs in, verifies the gate end-to-end.
- **Hot-fix (1c48dab) — server-action file split + audit_logs widening.** Three interrelated bugs surfaced when actually exercising the dialog through Playwright (integration tests had missed them because they imported helpers directly into Node and used `randomUUID()` for IDs):
  1. `"use server"` files can only export async functions. The original `scopes-actions.ts` exported types, which made Turbopack emit JS that crashed every POST with `ReferenceError: DimensionType is not defined`.
  2. Exporting the `_*ForActor` helpers from a `"use server"` file registered them as **network-callable RPC endpoints**, bypassing the `requireRole('admin')` gate. The split into `scopes-internal.ts` + `scopes-actions.ts` closes that hole.
  3. `audit_logs.entity_id` was modelled as `uuid` but Better Auth user IDs are random 32-char strings (not UUIDs). Migration 0010 widens the column to `text`. Lossless; no caller breakage.

### To merge M3

```bash
git checkout main && git merge --no-ff phase-1/m3-auth -m "Merge M3: Auth Extensions"
```

Per the user's GSD branching/commit conventions in `~/.claude/CLAUDE.md`, optionally add a phase-summary commit on the branch before the merge (curatorial — do this before the merge if you want a single "M3 deliverable" anchor commit in addition to the per-task commits).

## Test baselines (end of M3, on `phase-1/m3-auth`)

- **Vitest:** 127 passed / 14 todo / 1 skipped (was 88 at end of M2 — +39 across M3: 6 gating + 19 rbac + 14 user-scopes-actions).
- **Playwright:** 87 passed / 31 skipped / 5 failed.
  - All 5 failures are pre-existing deferred backlog items: `admin/invite-user`, `admin/deactivate-user`, `kanban` KANBAN-01, `pipeline-stages` KIOSK-04, `location-kiosks-tab` LOC-05.
  - +16 passes vs M2 baseline (71 → 87) — manage-scopes ×3 + external-user-redirect ×5 + various flaky pre-existing now passing on this run.
  - The deferred-backlog failures fluctuate between runs (e.g. `change-role` and `deactivate-user` may pass or fail depending on data state) — known instability, not M3 regressions.
- **ESLint:** 41 errors, 137 warnings (M2 baseline preserved, zero M3 regressions).
- **Typecheck:** clean.

## Migrations

- 11 migrations total (0000 → 0010). Apply cleanly to a fresh DB. Journal at `migrations/meta/_journal.json`.
- **Migration 0010** (M3 hot-fix) widens `audit_logs.entity_id` from `uuid` to `text`.

## What's next (by priority)

1. **Merge M3.** See command above. Then start M4.

2. **M4 — CSV Ingestion** (design section 4; plan file TBD)
   - `SalesDataSource` interface; `CsvFileSource` impl using PapaParse.
   - Admin upload UI ported from data-dashboard `/admin/data`.
   - Staging → validate → commit pipeline with atomic transaction.
   - Source-hash idempotency.

3. **M5 — Supabase ETL Migration** (design section 5; plan file TBD)
   - One-shot `scripts/migrate-from-supabase.ts`.
   - `profiles + user_permissions → user + userScopes` mapping.
   - Resumable/idempotent with verification pass.

4. **M6 — Port Analytics Pages** (largest milestone by LOC)
   - Port `portfolio`, `pivot-table`, `heat-map`, `trend-builder`, dimension CRUD, admin pages from `data-dashboard`.
   - Rewrite every Supabase call → Drizzle via `scopedSalesCondition()`.
   - Enables re-enabling the Playwright scoping-enforcement spec.

5. **M7 — Cross-App Integration** (nav unification, kiosk-hotel temporal attribution, outlet exclusion application, weather cache, brand theming).

6. **M8 — External Portal Stub** (mostly done already via M3 Task 3.1 — only the routes-beyond-stub remain for Phase 2).

7. **M9 — Testing Hardening** (1M-row performance seed, Lighthouse, axe, visual regression, fuzz tests).

8. **M10 — CI/CD + Observability** (GitHub Actions, Sentry, Pino logs, OTEL, preview deploys, gitleaks).

9. **M11 — Docs + Cutover** (architecture, runbooks, cutover).

## Key decisions (cumulative through M3)

- **Merge strategy:** kiosk-management base (Better Auth + Drizzle + vanilla Postgres) for DB portability.
- **Hotels vs locations:** 1:1 — `locations` table carries hotel dimension fields; no separate `hotels` table.
- **Sales granularity:** per-transaction (not pre-aggregated).
- **Monday.com integration:** dropped from Phase 1; replaced by unified CSV import.
- **Existing sales data:** migrate from Supabase (not greenfield-empty).
- **Branching:** one branch per milestone (`phase-1/m0-bootstrap`, `m1-schema`, `m2-scoping`, `m3-auth`). `--no-ff` merge with phase-summary message body.
- **External-user invariant enforcement:** app layer (invite-accept handler + `buildScopeFilter`), not DB.
- **`scopedSalesCondition` returns `SQL | undefined`:** `undefined` means unrestricted (admin / unscoped internal). Lint rule trusts the AST to spot the wrapper, not the value.
- **M3 — Manage Scopes UI shape:** dialog from row dropdown, NOT a per-user detail page — matches existing admin-UX convention (ChangeRoleDialog etc.) and avoids introducing a `[id]/page.tsx` route just for one admin action.
- **M3 — `"use server"` file structure:** types and internal `_*ForActor` helpers MUST live in a sibling non-"use server" module. Two reasons: Turbopack emits broken JS when a "use server" file exports types (runtime `ReferenceError`), and exporting non-wrapper helpers from a "use server" file registers them as network-callable RPCs that bypass the auth gate.
- **M3 — `audit_logs.entity_id` widened to `text`.** Heterogeneous entity IDs across types (kiosks/installations are uuid; Better Auth user IDs are random text). Lossless cast.
- **M3 — Better Auth `additionalFields.userType` is required.** Without it the proxy gate has no `userType` on the session and silently never fires.

## Key files (current)

### Planning & design
- `docs/plans/2026-04-16-kiosk-platform-merge-design.md` — original design doc.
- `docs/plans/2026-04-16-phase-1-foundation.md` — M0–M2 detailed plan.
- `docs/plans/2026-04-16-phase-1-m3-auth.md` — M3 plan.
- `docs/plans/2026-04-16-m0-deferred-test-backlog.md` — pre-existing Playwright failures with per-item fix direction.
- `docs/DEVELOPMENT.md` — local setup runbook.

### Code (M3 highlights)
- `src/lib/auth.ts` — Better Auth config. Now exposes `userType` via `user.additionalFields`.
- `src/lib/auth/gating.ts` — pure middleware-gate helper (`shouldGateExternalUser`). 6 unit tests in `gating.test.ts`.
- `src/proxy.ts` — Next.js proxy/middleware. Calls `shouldGateExternalUser` for external sessions.
- `src/lib/rbac.ts` — `UserCtx` type + userType-aware redaction. 19 unit tests in `rbac.test.ts`.
- `src/app/(app)/settings/users/[id]/scopes-actions.ts` — public server actions (`listScopes`, `addScope`, `removeScope`). Each gates on `requireRole('admin')` then delegates to internal helpers.
- `src/app/(app)/settings/users/[id]/scopes-internal.ts` — internal helpers + types. Deliberately NOT a "use server" file. See header comment for the (security + bundling) rationale.
- `src/app/portal/coming-soon/page.tsx` — external portal stub.
- `src/components/admin/manage-scopes-dialog.tsx` — admin UI for adding/removing userScopes.
- `src/components/admin/user-table.tsx` — wires "Manage scopes" dropdown item.
- `src/lib/audit.ts` — `writeAuditLog` extended with optional `db` parameter for testcontainers DI.
- `src/lib/scoping/scoped-query.ts` — security backbone from M2 (unchanged).
- `eslint-rules/no-raw-sales-query.js` — custom ESLint rule from M2 (unchanged).

### Tests (M3 highlights)
- `tests/db/user-scopes-actions.integration.test.ts` — 14 integration tests via testcontainers.
- `tests/admin/manage-scopes.spec.ts` — Playwright dialog flow.
- `tests/scoping/external-user-redirect.spec.ts` — 5-spec end-to-end UAT for the middleware gate. Loads `.env.local` explicitly via dotenv.
- `tests/scoping/scoping-enforcement.spec.ts` — M6-gated stub from M2.

### Migrations
- `migrations/0000` through `migrations/0010`. Journal at `migrations/meta/_journal.json`.

## How to resume (fresh session)

```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool

# 1. State check
git status            # should be clean except this HANDOFF.md (untracked by convention)
git log --oneline -8  # confirm M3 commits on phase-1/m3-auth (or post-merge on main)

# 2. Make sure dev Postgres is running
docker ps | grep wkg-pg || docker start wkg-pg

# 3. Sanity check
npm install                     # idempotent
npx drizzle-kit migrate         # idempotent
npx vitest run                  # 127 pass / 14 todo / 1 skip
npx playwright test             # 87 pass / 31 skip / 5 fail (all in deferred backlog)

# 4. If M3 still on branch: merge it
# git checkout main && git merge --no-ff phase-1/m3-auth -m "Merge M3: Auth Extensions"

# 5. Start M4 (CSV ingestion). Plan file TBD — likely docs/plans/<date>-phase-1-m4-csv.md
```

## Notable gotchas

- **`docs/HANDOFF.md` is untracked by convention.** Refresh at milestone-end; do not commit. Live session-context, not git history.
- **Vitest v4 `projects` API:** `vitest.config.ts` defines `unit` and `integration` projects.
- **Docker required for integration tests.**
- **`.env.local` contains real secrets.** Gitignored.
- **Dev server uses port 3003**, not 3000.
- **Playwright `testMatch: "**/*.spec.ts"`** must be preserved so `.integration.test.ts` files aren't picked up by Playwright.
- **The `wkg/no-raw-sales-query` ESLint rule is active** — any raw `db.select().from(salesRecords)` in `src/**/*.ts` (outside allow-listed paths) will be flagged.
- **Playwright tests that need DB access from the test process** must explicitly `loadEnv({ path: ".env.local" })` at the top — the runner doesn't pick it up the way Next.js does. See `tests/scoping/external-user-redirect.spec.ts` for the pattern.
- **`"use server"` files can only export async functions.** Types and synchronous helpers must live in a sibling module. Otherwise Turbopack emits broken JS (runtime `ReferenceError`) AND any exported async helpers become network-callable RPCs that bypass auth. See `scopes-internal.ts` header for the canonical pattern.
- **Better Auth user IDs are NOT UUIDs.** They're random 32-char strings. Schema columns that reference user IDs must be `text`, not `uuid`.
- **Dev DB reseed is cheap** — admin user + 9 pipeline stages — if you nuke it you can rebuild in < 5 s:
  ```bash
  docker exec wkg-pg psql -U postgres -c "DROP DATABASE IF EXISTS wkg_kiosk_dev; CREATE DATABASE wkg_kiosk_dev;"
  npx drizzle-kit migrate
  npm run db:seed
  npx tsx --env-file=.env.local --tsconfig tsconfig.json src/db/seed-pipeline-stages.ts
  ```

## Open questions (for the human)

1. **Phase-summary commit before merge?** Optional curatorial commit on `phase-1/m3-auth` to anchor "M3 deliverable" before the `--no-ff` merge — versus merging the per-task commits as-is and letting the merge-commit message carry the summary.
2. **Impersonation scope** — design doc section 3 includes impersonation, deferred to M3.5/Phase 2. Still acceptable?
3. **Invite-time scope multi-select** — M3 plan deferred this; admins add scopes post-creation via the manage-scopes dialog. OK to keep as-is?
4. **When to start pulling real sales data** — M5 (Supabase ETL) is large. Should we do a small vertical slice (one hotel, one month) to validate the full pipeline end-to-end before the full migration?
