# Phase 1 Foundation — Implementation Plan (Milestones 0–2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap `wkg-kiosk-tool` as a fork of `kiosk-management`, extend the Drizzle schema with all new analytics + scoping tables, and build the `scopedQuery()` security backbone. This foundation is what every subsequent milestone depends on.

**Architecture:** Single Next.js app (kiosk-management base), Drizzle ORM + vanilla Postgres, Better Auth. Scoping enforced via three layers (middleware / `scopedQuery()` / field redaction). Test-driven — scoping and schema invariants are written as failing tests first.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PostgreSQL, Better Auth, Vitest (+ Testcontainers for integration), Playwright, ESLint (with a custom rule).

**Design reference:** `docs/plans/2026-04-16-kiosk-platform-merge-design.md`

**Repo:** `/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool` (empty except for `docs/plans/`)

**Source repos (read-only references):**
- `/Users/vedant/Work/WeKnowGroup/kiosk-management` — base we're cloning from
- `/Users/vedant/Work/WeKnowGroup/data-dashboard` — pull analytics schema/logic from

---

## Milestone 0 — Repo Bootstrap

**Outcome:** `wkg-kiosk-tool` contains the kiosk-management codebase, renamed, with green tests and a working dev server. Fresh git history.

### Task 0.1: Copy kiosk-management source

**Files:**
- Source: `/Users/vedant/Work/WeKnowGroup/kiosk-management/`
- Dest: `/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/`

**Step 1: Copy everything except `.git`, `node_modules`, build artifacts, and screenshots**

Run:
```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='test-results' --exclude='*.png' --exclude='tsconfig.tsbuildinfo' \
  --exclude='.claude' --exclude='.planning' --exclude='.playwright-cli' \
  --exclude='.github/workflows' \
  /Users/vedant/Work/WeKnowGroup/kiosk-management/ ./
```

Expected: Directory populated with `src/`, `package.json`, `drizzle.config.ts`, etc. No `.git` conflict with the existing one we initialized.

**Step 2: Verify the expected top-level structure**

Run: `ls -la`
Expected: See `src/`, `package.json`, `drizzle.config.ts`, `next.config.ts`, `tests/`, `migrations/`, `public/`, `docs/` (design doc preserved).

**Step 3: Commit baseline**

```bash
git add -A
git commit -m "chore: import kiosk-management codebase as baseline"
```

---

### Task 0.2: Rename project + strip irrelevant metadata

**Files:**
- Modify: `package.json`
- Modify: `README.md` (replace with stub)
- Delete: any old screenshots at root (already excluded above, double-check)

**Step 1: Update `package.json`**

Change `"name"` to `"wkg-kiosk-tool"`. Set `"version": "0.1.0"`. Set `"description": "Unified kiosk operations + analytics platform (WeKnow Group)"`. Keep all dependencies and scripts.

**Step 2: Replace README with a stub**

Write a short README explaining this is the merged platform, pointing at `docs/plans/` for design + implementation plans. Don't over-invest — `docs/ARCHITECTURE.md` comes later.

**Step 3: Verify no stale `.png` files at repo root**

Run: `ls *.png 2>/dev/null | head -5`
Expected: No output.

**Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: rename project to wkg-kiosk-tool"
```

---

### Task 0.3: Install dependencies and verify the app runs

**Step 1: Install**

Run: `npm ci` (or `npm install` if no lockfile-v3 issues)
Expected: `node_modules/` populated, no errors.

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors. If any surface, fix them before continuing (they indicate something didn't copy cleanly).

**Step 3: Run existing unit tests**

Run: `npx vitest run`
Expected: All tests green.

**Step 4: Run existing Playwright tests**

Run: `npx playwright test`
Expected: Green OR skipped (if they need a running DB). If red, investigate — fix before continuing.

**Step 5: Start dev server (smoke test)**

Run: `npm run dev &` then wait 10s, hit `http://localhost:3000`, then kill.
Expected: Server starts, home page renders (possibly redirect to `/login`). No runtime crashes.

**Step 6: Commit any lockfile changes**

```bash
git add package-lock.json
git commit -m "chore: regenerate lockfile"
```
(Skip if nothing changed.)

---

### Task 0.4: Set up a dev Postgres and verify Drizzle migrations run

**Step 1: Ensure a local Postgres is running**

Run: `docker ps | grep postgres || echo "need to start"`

If none, start one:
```bash
docker run -d --name wkg-pg -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16
```

**Step 2: Create the dev database**

Run:
```bash
docker exec wkg-pg psql -U postgres -c "CREATE DATABASE wkg_kiosk_dev;"
```

**Step 3: Configure `.env.local`**

Create `.env.local` (gitignored — confirm via `cat .gitignore | grep env`) with:
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wkg_kiosk_dev
BETTER_AUTH_SECRET=<generate-a-random-32-char-string>
```

**Step 4: Apply existing migrations**

Run: `npx drizzle-kit push` (or `npx drizzle-kit migrate` depending on how kiosk-management is configured).
Expected: Schema applied to `wkg_kiosk_dev`, no errors.

**Step 5: Verify schema via psql**

Run:
```bash
docker exec wkg-pg psql -U postgres -d wkg_kiosk_dev -c "\dt"
```
Expected: See tables like `user`, `kiosks`, `locations`, `installations`, `products`, etc.

**Step 6: Commit**

No code changes in this task — just environment setup. Document in README or a `docs/DEVELOPMENT.md` the local-DB steps for future setup. Commit that.

```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: local dev DB setup"
```

---

### Task 0.5: Baseline Playwright green-up (hybrid)

**Added mid-milestone** after Task 0.4 revealed 15 pre-existing Playwright failures inherited from the `kiosk-management` source repo. The user chose a **hybrid approach**: quick-fix trivially wrong tests (stale selectors, missing sign-in), defer anything requiring seed-fixture expansion or app-code changes.

**Scope:**
- **Fixed (test-only edits):** stale column selectors (`kiosk id` → `Asset` per MIGR-12), smoke test sign-in, Settings-in-sidebar-footer selector. Result: 15 → 12 failures, 67 → 70 passing.
- **Deferred:** everything requiring seed-fixture expansion or feature implementation. Full backlog with per-item root cause, fix direction, and effort estimate captured in [`docs/plans/2026-04-16-m0-deferred-test-backlog.md`](./2026-04-16-m0-deferred-test-backlog.md).

**Constraints:** no edits to `src/app/**`, `src/components/**`, `src/lib/**`. Test-file edits must reflect real UI state (no assertion weakening).

**M0 merge gate:** the 12 remaining failures are accepted as baseline tech debt inherited from upstream; they are gated to be picked up in M1 test-hardening. No NEW regressions are allowed against the post-0.5 baseline (70 passed / 29 skipped / 12 failed).

---

## Milestone 1 — Schema Extensions

**Outcome:** Drizzle schema contains every new table from the design doc plus `userType` / `userScopes`. Migration applies cleanly, invariants enforced (external users require ≥1 scope row, no external-admin), and integration tests pass against a real Postgres.

### Task 1.1: Set up Testcontainers for integration tests

**Files:**
- Create: `tests/helpers/test-db.ts`
- Modify: `package.json` (add `testcontainers`, `@testcontainers/postgresql`)
- Modify: `vitest.config.ts` (split config into unit + integration test projects)

**Step 1: Install dependencies**

Run: `npm install -D @testcontainers/postgresql testcontainers`

**Step 2: Write a test-db helper**

Create `tests/helpers/test-db.ts`:
```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';

let container: StartedPostgreSqlContainer | null = null;

export async function setupTestDb() {
  container = await new PostgreSqlContainer('postgres:16').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  return { db, pool, container };
}

export async function teardownTestDb(pool: Pool) {
  await pool.end();
  if (container) await container.stop();
}
```

**Step 3: Split vitest config into `unit` and `integration` projects**

Modify `vitest.config.ts` to have two projects — `unit` (default, fast) and `integration` (slow, uses Testcontainers). Match `*.integration.test.ts` for integration.

**Step 4: Write a smoke integration test**

Create `tests/db/smoke.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import { sql } from 'drizzle-orm';

describe('test-db smoke', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { await teardownTestDb(ctx.pool); });

  it('runs a trivial query', async () => {
    const rows = await ctx.db.execute(sql`select 1 as n`);
    expect(rows.rows[0]).toEqual({ n: 1 });
  });
});
```

**Step 5: Run the integration suite**

Run: `npx vitest run --project integration`
Expected: One test passes. (First run is slow — container download.)

**Step 6: Commit**

```bash
git add tests/helpers/test-db.ts tests/db/smoke.integration.test.ts vitest.config.ts package.json package-lock.json
git commit -m "test: add Testcontainers-based integration test harness"
```

---

### Task 1.2: Add `userType` column to `user` table (TDD)

**Files:**
- Modify: `src/db/schema.ts` (or wherever kiosk-management defines the Better Auth `user` table)
- Create: `migrations/00XX_user_type.sql` (let drizzle-kit generate)
- Create: `tests/db/user-type.integration.test.ts`

**Step 1: Write a failing integration test**

Create `tests/db/user-type.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import { user } from '@/db/schema';

describe('user.userType', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { await teardownTestDb(ctx.pool); });

  it('defaults to internal when not specified', async () => {
    const [row] = await ctx.db.insert(user).values({
      id: 'u1', email: 'a@a.test', name: 'A', emailVerified: true,
    }).returning();
    expect(row.userType).toBe('internal');
  });

  it('rejects invalid userType values', async () => {
    await expect(
      ctx.db.insert(user).values({
        id: 'u2', email: 'b@b.test', name: 'B', emailVerified: true,
        userType: 'alien' as any,
      }),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/user-type.integration.test.ts`
Expected: FAIL — column `userType` doesn't exist.

**Step 3: Add the column to the schema**

Modify `src/db/schema.ts` — add to the `user` table definition:
```ts
userType: text('user_type', { enum: ['internal', 'external'] }).notNull().default('internal'),
```

**Step 4: Generate migration**

Run: `npx drizzle-kit generate`
Expected: New migration file in `migrations/` adding `user_type` column with default.

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/user-type.integration.test.ts`
Expected: PASS both assertions.

**Step 6: Commit**

```bash
git add src/db/schema.ts migrations/ tests/db/user-type.integration.test.ts
git commit -m "feat(db): add userType column to user table"
```

---

### Task 1.3: Add `userScopes` table (TDD)

**Files:**
- Modify: `src/db/schema.ts`
- Create: migration
- Create: `tests/db/user-scopes.integration.test.ts`

**Step 1: Write failing tests for the table's shape and constraints**

Create `tests/db/user-scopes.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/test-db';
import { user, userScopes } from '@/db/schema';

describe('userScopes', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { await teardownTestDb(ctx.pool); });

  it('allows multiple scope rows per user (union semantics)', async () => {
    await ctx.db.insert(user).values({ id: 'u1', email: 'a@a.t', name: 'A', emailVerified: true });
    await ctx.db.insert(userScopes).values([
      { userId: 'u1', dimensionType: 'hotel_group', dimensionId: '42' },
      { userId: 'u1', dimensionType: 'region', dimensionId: '7' },
    ]);
    const rows = await ctx.db.select().from(userScopes);
    expect(rows.length).toBe(2);
  });

  it('rejects invalid dimensionType values', async () => {
    await expect(
      ctx.db.insert(userScopes).values({
        userId: 'u1', dimensionType: 'invalid' as any, dimensionId: '1',
      }),
    ).rejects.toThrow();
  });

  it('cascades delete on user removal', async () => {
    await ctx.db.insert(user).values({ id: 'u2', email: 'b@b.t', name: 'B', emailVerified: true });
    await ctx.db.insert(userScopes).values({ userId: 'u2', dimensionType: 'provider', dimensionId: '9' });
    await ctx.db.delete(user).where(/* eq(user.id, 'u2') */);
    const leftover = await ctx.db.select().from(userScopes);
    expect(leftover.find(r => r.userId === 'u2')).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/user-scopes.integration.test.ts`
Expected: FAIL — `userScopes` not defined.

**Step 3: Add the table to the schema**

In `src/db/schema.ts`:
```ts
export const userScopes = pgTable('user_scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  dimensionType: text('dimension_type', {
    enum: ['hotel_group', 'location', 'region', 'product', 'provider', 'location_group'],
  }).notNull(),
  dimensionId: text('dimension_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by').references(() => user.id),
}, (t) => ({
  uniq: unique().on(t.userId, t.dimensionType, t.dimensionId),
  byUser: index('user_scopes_user_idx').on(t.userId),
}));
```

**Step 4: Generate and apply migration**

Run: `npx drizzle-kit generate`

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/db/user-scopes.integration.test.ts`
Expected: All PASS.

**Step 6: Commit**

```bash
git add src/db/schema.ts migrations/ tests/db/user-scopes.integration.test.ts
git commit -m "feat(db): add userScopes table with dimension-type enum and cascade delete"
```

---

### Task 1.4: Add DB-level invariant — external user must have ≥1 scope row

**Files:**
- Create: migration SQL (manual, not drizzle-kit generated — trigger logic)
- Modify: `tests/db/user-scopes.integration.test.ts` (add constraint test)

**Step 1: Write failing test**

Append to `tests/db/user-scopes.integration.test.ts`:
```ts
it('rejects external user without any scope rows', async () => {
  await expect(
    ctx.db.insert(user).values({
      id: 'ext1', email: 'ext@x.t', name: 'Ext', emailVerified: true,
      userType: 'external',
    }),
  ).rejects.toThrow(/external.*scope/i);
});

it('allows external user with at least one scope row (via admin invite flow)', async () => {
  // We'll handle this at app layer - DB constraint is too strict for insert-then-scope ordering.
  // Skip DB-level enforcement; rely on application guard in invite flow.
});
```

**Step 2: Run test**

Expected: The first test FAILS — no constraint exists.

**Step 3: Decide enforcement layer**

Problem: chicken-and-egg — we must insert `user` row before we can insert scope rows (FK). A strict DB constraint blocks the transaction's natural ordering.

**Resolution:** Enforce in application layer (invite-accept handler), not DB. Update test:
```ts
// remove the first 'rejects' test
// replace with a unit test for the invite-accept handler once that exists (Milestone 3)
```

**Step 4: Document the decision**

Add a comment in `src/db/schema.ts` above `userScopes`:
```ts
// INVARIANT: users with userType='external' MUST have >=1 row in userScopes.
// Enforced in invite-accept handler (src/lib/auth/invite.ts) and in scopedQuery().
// Not enforced at DB layer because insert-ordering makes a CHECK constraint impractical.
```

**Step 5: Commit**

```bash
git add src/db/schema.ts tests/db/user-scopes.integration.test.ts
git commit -m "docs(db): document external-user scope invariant and enforcement layer"
```

---

### Task 1.5: Extend `locations` with hotel dimension fields (TDD)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `tests/db/locations-hotel-fields.integration.test.ts`

**Step 1: Write failing test**

```ts
it('stores hotel dimension fields on locations', async () => {
  const [loc] = await ctx.db.insert(locations).values({
    /* existing required fields */,
    numRooms: 226,
    starRating: 4,
    hotelAddress: 'Brighton, UK',
    liveDate: new Date('2025-12-15'),
    launchPhase: 'Phase 3',
  }).returning();
  expect(loc.numRooms).toBe(226);
  expect(loc.starRating).toBe(4);
});
```

**Step 2: Run to verify fail**
**Step 3: Add columns to `locations` in schema**
**Step 4: Generate migration**
**Step 5: Run to verify pass**
**Step 6: Commit**

```bash
git commit -m "feat(db): extend locations with hotel dimension fields"
```

---

### Task 1.6: Add analytics dimension tables

**Tables to add (one task each, following the same TDD pattern as 1.3):**

- `hotelGroups` — `id`, `name`, `parentGroupId` (self-FK for nesting, nullable), `createdAt`, `createdBy`
- `regions` — `id`, `name`, `code`, `createdAt`, `createdBy`
- `locationGroups` — `id`, `name`, `description`, `createdAt`, `createdBy`
- `providers` — `id`, `name`, `code`, `createdAt`
- Membership tables as needed: `locationHotelGroupMemberships`, `locationRegionMemberships`, `locationGroupMemberships`

For each: write a failing integration test asserting basic insert + FK + uniqueness, add schema, generate migration, verify pass, commit.

**Commit pattern:** `feat(db): add <table> table`

**Shortcut:** Since these are nearly identical CRUD tables, you can batch them (generate one migration for all dimension tables) after writing one integration test covering all of them.

---

### Task 1.7: Add `salesRecords`, `salesImports`, `importStagings` (TDD)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `tests/db/sales.integration.test.ts`

**Step 1: Write failing tests covering:**

- Insert a salesRecord with all fields
- FK enforcement (locationId → locations, productId → products, providerId → providers)
- Indexes exist: `(locationId, transactionDate)`, `(productId, transactionDate)`, `(providerId, transactionDate)` — test via `EXPLAIN` that a query uses them
- `salesImports` tracks metadata; `importStagings` holds raw rows tied to a `salesImports.id`
- Unique `saleRef` (or composite unique on `saleRef` + `transactionDate`)

**Step 2: Add schema:**

```ts
export const salesRecords = pgTable('sales_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').references(() => salesImports.id, { onDelete: 'set null' }),
  saleRef: text('sale_ref').notNull(),
  refNo: text('ref_no'),
  transactionDate: date('transaction_date').notNull(),
  transactionTime: time('transaction_time'),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  providerId: uuid('provider_id').references(() => providers.id),
  quantity: integer('quantity').notNull().default(1),
  grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull(),
  netAmount: numeric('net_amount', { precision: 12, scale: 2 }),
  discountCode: text('discount_code'),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }),
  bookingFee: numeric('booking_fee', { precision: 12, scale: 2 }),
  saleCommission: numeric('sale_commission', { precision: 12, scale: 2 }),
  currency: text('currency').notNull().default('GBP'),
  customerCode: text('customer_code'),
  customerName: text('customer_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  saleRefIdx: index('sales_sale_ref_idx').on(t.saleRef),
  locDateIdx: index('sales_loc_date_idx').on(t.locationId, t.transactionDate),
  prodDateIdx: index('sales_prod_date_idx').on(t.productId, t.transactionDate),
  provDateIdx: index('sales_prov_date_idx').on(t.providerId, t.transactionDate),
  uniq: unique().on(t.saleRef, t.transactionDate),
}));

export const salesImports = pgTable('sales_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  sourceHash: text('source_hash').notNull(),
  uploadedBy: text('uploaded_by').notNull().references(() => user.id),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
  rowCount: integer('row_count').notNull().default(0),
  dateRangeStart: date('date_range_start'),
  dateRangeEnd: date('date_range_end'),
  status: text('status', {
    enum: ['staging', 'committed', 'failed', 'rolled_back'],
  }).notNull().default('staging'),
  errors: jsonb('errors'),
});

export const importStagings = pgTable('import_stagings', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').notNull().references(() => salesImports.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  rawRow: jsonb('raw_row').notNull(),
  parsedRow: jsonb('parsed_row'),
  status: text('status', { enum: ['pending', 'valid', 'invalid', 'committed'] }).notNull().default('pending'),
  validationErrors: jsonb('validation_errors'),
}, (t) => ({
  byImport: index('staging_import_idx').on(t.importId),
}));
```

**Step 3: Generate migration**
**Step 4: Run integration tests, verify pass**
**Step 5: Commit**

```bash
git commit -m "feat(db): add salesRecords, salesImports, importStagings with indexes"
```

---

### Task 1.8: Add remaining analytics tables

Same TDD pattern for:
- `outletExclusions` (port from `supabase/migrations/20260223_add_outlet_exclusions.sql`)
- `analyticsPresets` (port from data-dashboard `presets` table)
- `analyticsSavedViews` (port from data-dashboard `saved_views`)
- `eventCategories`, `businessEvents` (port from `20260317_phase4_trend_builder.sql`)
- `weatherCache` (port from same migration)
- `eventLog`

Read each source migration, translate to Drizzle, write integration test for basic insert + FK, add, generate, verify, commit.

**Commit pattern:** `feat(db): add <table> ported from data-dashboard`

---

### Task 1.9: Verify full migration applies cleanly on a fresh DB

**Step 1: Destroy local dev DB**

```bash
docker exec wkg-pg psql -U postgres -c "DROP DATABASE IF EXISTS wkg_kiosk_dev;"
docker exec wkg-pg psql -U postgres -c "CREATE DATABASE wkg_kiosk_dev;"
```

**Step 2: Apply all migrations**

Run: `npx drizzle-kit migrate`
Expected: Clean apply, no errors.

**Step 3: Verify table list**

```bash
docker exec wkg-pg psql -U postgres -d wkg_kiosk_dev -c "\dt"
```
Expected: Every table from the design doc's schema section present.

**Step 4: Run full integration suite**

Run: `npx vitest run --project integration`
Expected: All green.

**Step 5: Run existing Playwright tests**

Run: `npx playwright test`
Expected: Green (or same pass/skip state as baseline).

**Step 6: Commit**

No changes — this is a verification step. If anything failed, fix it with additional commits.

---

## Milestone 2 — Scoping Backbone (`scopedQuery`)

**Outcome:** `scopedQuery()` helper that injects dimension-based filters into every analytics query. ESLint custom rule bans raw `salesRecords` queries outside the helper. 100% test coverage on the helper because it's the security backbone.

### Task 2.1: Write scoping spec as failing tests

**Files:**
- Create: `src/lib/scoping/scoped-query.ts` (empty stub)
- Create: `src/lib/scoping/scoped-query.test.ts` (unit — no DB)
- Create: `src/lib/scoping/scoped-query.integration.test.ts` (real DB)

**Step 1: Write unit tests (behavioral spec, fast)**

Create `src/lib/scoping/scoped-query.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildScopeFilter } from './scoped-query';

describe('buildScopeFilter', () => {
  it('returns null (unrestricted) for internal admin with no scopes', () => {
    const user = { id: 'a1', userType: 'internal', role: 'admin' };
    expect(buildScopeFilter(user, [])).toBeNull();
  });

  it('returns null (unrestricted) for internal member with no scopes', () => {
    const user = { id: 'm1', userType: 'internal', role: 'member' };
    expect(buildScopeFilter(user, [])).toBeNull();
  });

  it('THROWS for external user with no scopes', () => {
    const user = { id: 'e1', userType: 'external', role: null };
    expect(() => buildScopeFilter(user, [])).toThrow(/external.*scope/i);
  });

  it('builds a locationId IN (…) filter from hotel_group scope', () => {
    const user = { id: 'e1', userType: 'external', role: null };
    const scopes = [{ dimensionType: 'hotel_group', dimensionId: '42' }];
    const filter = buildScopeFilter(user, scopes);
    expect(filter).toMatchObject({ kind: 'hotel_group', ids: ['42'] });
  });

  it('unions multiple scopes of the same dimension', () => {
    const scopes = [
      { dimensionType: 'provider', dimensionId: '1' },
      { dimensionType: 'provider', dimensionId: '2' },
    ];
    const filter = buildScopeFilter({ id: 'e', userType: 'external', role: null }, scopes);
    expect(filter).toMatchObject({ kind: 'provider', ids: ['1', '2'] });
  });

  it('unions across dimensions (hotel_group OR provider)', () => {
    const scopes = [
      { dimensionType: 'hotel_group', dimensionId: '42' },
      { dimensionType: 'provider', dimensionId: '7' },
    ];
    const filter = buildScopeFilter({ id: 'e', userType: 'external', role: null }, scopes);
    expect(filter).toMatchObject({ kind: 'union', parts: expect.arrayContaining([
      { kind: 'hotel_group', ids: ['42'] },
      { kind: 'provider', ids: ['7'] },
    ])});
  });

  it('admin with scopes: scopes ignored (unrestricted) — admins bypass', () => {
    const user = { id: 'a1', userType: 'internal', role: 'admin' };
    const scopes = [{ dimensionType: 'provider', dimensionId: '1' }];
    expect(buildScopeFilter(user, scopes)).toBeNull();
  });

  it('respects impersonation — uses impersonated user\'s effective scopes', () => {
    const session = {
      user: { id: 'a1', userType: 'internal', role: 'admin' },
      impersonatedUser: { id: 'e1', userType: 'external', role: null },
    };
    const scopes = [{ dimensionType: 'provider', dimensionId: '1' }];
    expect(buildScopeFilter(session, scopes, { honorImpersonation: true }))
      .toMatchObject({ kind: 'provider', ids: ['1'] });
  });
});
```

**Step 2: Run — verify fail**

Run: `npx vitest run src/lib/scoping/scoped-query.test.ts`
Expected: FAIL — `buildScopeFilter` not exported.

**Step 3: Implement `buildScopeFilter` minimally**

Create `src/lib/scoping/scoped-query.ts`:
```ts
type DimType = 'hotel_group' | 'location' | 'region' | 'product' | 'provider' | 'location_group';
type Scope = { dimensionType: DimType; dimensionId: string };
type UserCtx = { id: string; userType: 'internal' | 'external'; role: 'admin' | 'member' | 'viewer' | null };

export type ScopeFilter =
  | null
  | { kind: DimType; ids: string[] }
  | { kind: 'union'; parts: Array<{ kind: DimType; ids: string[] }> };

export function buildScopeFilter(userOrSession: UserCtx | { user: UserCtx; impersonatedUser?: UserCtx }, scopes: Scope[], opts?: { honorImpersonation?: boolean }): ScopeFilter {
  const user = 'user' in userOrSession && opts?.honorImpersonation && userOrSession.impersonatedUser
    ? userOrSession.impersonatedUser
    : ('user' in userOrSession ? userOrSession.user : userOrSession);

  if (user.userType === 'internal' && user.role === 'admin') return null;
  if (user.userType === 'external' && scopes.length === 0) {
    throw new Error('External user must have at least one scope row');
  }
  if (scopes.length === 0) return null;

  const byDim = new Map<DimType, string[]>();
  for (const s of scopes) {
    if (!byDim.has(s.dimensionType)) byDim.set(s.dimensionType, []);
    byDim.get(s.dimensionType)!.push(s.dimensionId);
  }
  const parts = Array.from(byDim.entries()).map(([kind, ids]) => ({ kind, ids }));
  if (parts.length === 1) return parts[0];
  return { kind: 'union', parts };
}
```

**Step 4: Run — verify pass**

Run: `npx vitest run src/lib/scoping/scoped-query.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/lib/scoping/ package.json
git commit -m "feat(scoping): buildScopeFilter with admin-bypass and external-guard"
```

---

### Task 2.2: Implement `scopedQuery()` — binds filter to Drizzle query

**Files:**
- Modify: `src/lib/scoping/scoped-query.ts`
- Modify: `src/lib/scoping/scoped-query.test.ts`
- Create: `src/lib/scoping/scoped-query.integration.test.ts`

**Step 1: Write integration test** (real DB, real queries against `salesRecords`).

Seed: 2 locations in hotelGroup A, 1 in hotelGroup B. 3 users: admin (no scopes), partner-bob (external, provider=1), hotel-alice (external, hotel_group=A). Insert sales tied to each. Run `scopedQuery(user, db.select().from(salesRecords))` and assert row counts match expected slice.

**Step 2: Verify fail**
**Step 3: Implement `scopedQuery()`**

```ts
import { and, inArray, or, eq, sql } from 'drizzle-orm';
import { salesRecords, userScopes, locationHotelGroupMemberships, locationRegionMemberships } from '@/db/schema';

export async function scopedQuery<T>(
  db: DrizzleDb,
  user: UserCtx,
  queryBuilder: (scopeCondition: SQL | undefined) => Promise<T>,
): Promise<T> {
  const scopes = await db.select().from(userScopes).where(eq(userScopes.userId, user.id));
  const filter = buildScopeFilter(user, scopes);
  if (filter === null) return queryBuilder(undefined);
  const condition = translateFilterToSql(filter);
  return queryBuilder(condition);
}

function translateFilterToSql(filter: ScopeFilter): SQL {
  // For each dim type, resolve to a condition on salesRecords.
  // hotel_group → salesRecords.locationId IN (SELECT locationId FROM locationHotelGroupMemberships WHERE hotelGroupId IN (…))
  // location    → salesRecords.locationId IN (…)
  // region      → salesRecords.locationId IN (SELECT … regions …)
  // product     → salesRecords.productId IN (…)
  // provider    → salesRecords.providerId IN (…)
  // location_group → salesRecords.locationId IN (SELECT … from group membership)
  // union       → OR the above
  // (implementation details)
}
```

**Step 4: Verify integration test passes**
**Step 5: Commit**

```bash
git commit -m "feat(scoping): scopedQuery applies dimension filters to Drizzle queries"
```

---

### Task 2.3: ESLint custom rule banning raw `salesRecords` queries

**Files:**
- Create: `eslint-rules/no-raw-sales-query.js`
- Modify: `eslint.config.mjs`
- Create: `eslint-rules/no-raw-sales-query.test.js` (RuleTester)

**Step 1: Write the RuleTester spec (failing test)**

```js
const { RuleTester } = require('eslint');
const rule = require('./no-raw-sales-query');
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }}});
tester.run('no-raw-sales-query', rule, {
  valid: [
    { code: 'scopedQuery(user, (scope) => db.select().from(salesRecords).where(scope))' },
    { code: 'import { salesRecords } from "@/db/schema"; // type-only import is fine' },
  ],
  invalid: [
    { code: 'db.select().from(salesRecords)', errors: [{ messageId: 'rawSalesQuery' }] },
    { code: 'db.delete(salesRecords)', errors: [{ messageId: 'rawSalesQuery' }] },
  ],
});
```

**Step 2: Verify fail**
**Step 3: Implement the rule**

AST-walk to find `CallExpression` where callee chain reaches `salesRecords` as an argument to `.from()` or `.delete()` / `.insert()` / `.update()` — unless the enclosing function body or ancestor is inside `scopedQuery(...)`. Allow with an explicit `// eslint-disable-next-line no-raw-sales-query -- reason: <why>` escape hatch.

**Step 4: Wire into `eslint.config.mjs`**

```js
import noRawSalesQuery from './eslint-rules/no-raw-sales-query.js';
export default [
  {
    plugins: { 'wkg': { rules: { 'no-raw-sales-query': noRawSalesQuery }}},
    rules: { 'wkg/no-raw-sales-query': 'error' },
  },
  // ... existing config
];
```

**Step 5: Run `npm run lint`**

Expected: Green (no raw queries yet). If red, fix.

**Step 6: Commit**

```bash
git commit -m "lint: custom rule banning raw salesRecords queries outside scopedQuery"
```

---

### Task 2.4: Add scoping Playwright E2E smoke (Tier A)

**Files:**
- Create: `tests/e2e/scoping.spec.ts`

**Step 1: Write E2E test**

Seed 3 users via API (admin, external-bob scoped to provider=1, external-alice scoped to hotel_group=A). Log in as each. Hit `/api/analytics/sales-summary`. Assert each sees the right row counts. (The route doesn't exist yet — it's a stub returning a fixed shape in Milestone 3/6. For now, just write the test and mark it `test.skip` with a comment to re-enable when the route lands.)

**Step 2: Commit**

```bash
git commit -m "test(e2e): scoping enforcement spec (skipped until route lands)"
```

---

### Task 2.5: Milestone 2 closing — verify end-to-end

**Step 1: Destroy + recreate dev DB; run all migrations; run full test suite**

```bash
docker exec wkg-pg psql -U postgres -c "DROP DATABASE IF EXISTS wkg_kiosk_dev;"
docker exec wkg-pg psql -U postgres -c "CREATE DATABASE wkg_kiosk_dev;"
npx drizzle-kit migrate
npx vitest run   # unit + integration
npm run lint
```
Expected: All green.

**Step 2: Tag the milestone**

```bash
git tag phase-1-m2-foundation
git commit --allow-empty -m "chore: milestone 2 complete — foundation ready"
```

---

## Milestones 3–11 — Roadmap (separate plan files to come)

Each of these will get its own `docs/plans/YYYY-MM-DD-phase-1-mN-<name>.md` written when we start the milestone.

### Milestone 3 — Auth Extensions
- Route-group middleware gating `(internal)` vs `(portal)` by `userType`.
- `userScopes` CRUD API + admin UI (add/edit/remove scopes on user detail page).
- Invite flow UI updates — dimension-scope multi-select at invite time.
- Field redaction extended for `userType='external'` (no contracts, banking, contact fields).
- Impersonation port from data-dashboard — session stamp + `scopedQuery` respect.
- All scope changes + impersonation start/stop logged to `auditLogs`.

### Milestone 4 — CSV Ingestion
- `SalesDataSource` interface (abstract over CSV-now / DB-later).
- `CsvFileSource` impl using PapaParse.
- Admin upload UI ported from data-dashboard's `/admin/data`.
- Staging → validate → commit pipeline with atomic transaction.
- Idempotency via `sourceHash`.
- Error surfacing: per-row validation errors visible in staging view before commit.
- Audit logs for every import.

### Milestone 5 — Supabase ETL Migration
- One-shot script `scripts/migrate-from-supabase.ts`.
- Reads data-dashboard's Supabase Postgres via direct connection string.
- Transforms: `profiles` + `user_permissions` → `user` + `userScopes` (user_permissions dimensions map 1:1 to userScopes dimension types).
- Migrates: `sales_records` (if table exists in Supabase) or re-imports via CSV, `presets`, `outlet_exclusions`, `event_categories`, `business_events`, `saved_views`.
- Idempotent — re-running skips already-migrated rows via source-id mapping table.
- Verification pass — asserts row counts match, FK integrity clean, no orphans.

### Milestone 6 — Port Analytics Pages
- `/analytics/portfolio` — port from `(dashboard)/portfolio/page.tsx`
- `/analytics/pivot-table` — port with dimension-cascading filters
- `/analytics/heat-map`
- `/analytics/trend-builder` — with business events overlay + weather correlation
- `/analytics/hotel-groups`, `/analytics/regions`, `/analytics/location-groups` — dimension CRUD
- `/admin/presets`, `/admin/outlet-exclusions`, `/admin/events`, `/admin/data`, `/admin/users`, `/admin/audit`
- Every Supabase client call → Drizzle via `scopedQuery()`. Lint rule enforces this.

### Milestone 7 — Cross-App Integration
- Nav unification — top groups Operations / Analytics / Admin.
- Kiosk-hotel temporal attribution helper using `kioskAssignments` (data-dashboard logic port).
- Outlet exclusion application in analytics queries.
- Weather cache service port.
- Shared layout + theming (WeKnow brand guidelines).

### Milestone 8 — External Portal Stub
- `/portal/*` route group with middleware rejecting with "Phase 2 — coming soon".
- External user fixtures for auth-boundary tests.

### Milestone 9 — Testing Hardening
- Performance seed (1M salesRecords).
- Lighthouse CI, axe integration on all Tier B tests.
- Visual regression baselines.
- Fuzz tests for scoping with crafted inputs.

### Milestone 10 — CI/CD + Observability
- GitHub Actions pipeline per design doc section 5.
- Sentry integration with user context.
- Pino structured logs with `traceId` propagation.
- OpenTelemetry metrics + dashboards.
- Preview deploys per PR.
- Secret scanning (gitleaks) + `npm audit` gates.

### Milestone 11 — Documentation + Cutover
- `docs/ARCHITECTURE.md`, `docs/SCOPING.md`, `docs/MIGRATION-FROM-SUPABASE.md`.
- `docs/RUNBOOKS/` — failed import, lockout, scope misconfig, DB restore.
- Production DB provisioning + cutover runbook.
- Old-app decommission checklist.

---

## Execution Notes

- Every task ends with a commit. Commit messages follow `type(scope): subject` (conventional commits).
- Every schema change = new Drizzle migration (never amend a migration post-commit).
- Every new query against `salesRecords` must go through `scopedQuery()` — the lint rule enforces it.
- Per user's global instructions:
  - Playwright tests required for user-facing features (happy + error path minimum).
  - Phase-level summary commits at end of each milestone.
  - Use `phase` branching: `gsd/phase-1-m0-bootstrap`, etc., OR single `main` if not using GSD here — clarify with user before tagging.
