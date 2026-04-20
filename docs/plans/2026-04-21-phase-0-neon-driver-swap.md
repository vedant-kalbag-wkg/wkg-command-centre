# Phase 0 — Neon Driver Swap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` where a unit test applies. Use `superpowers:verification-before-completion` on every gate.

**Goal:** Replace `postgres-js` with `@neondatabase/serverless` (WebSocket Pool via `drizzle-orm/neon-serverless`) on the Next.js request path, behind an env-driven fork so local Postgres and CI testcontainers keep working.

**Architecture:** Single file (`src/db/index.ts`) picks driver by URL shape: URLs containing `neon.tech` use the WebSocket Pool; all others use `postgres-js`. The exported `db` is typed as the union of both driver instances. Zero call-site changes in the 55 consumer files. Seed and import scripts keep `postgres-js` unchanged.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM 0.45, Neon Postgres (prod), local Postgres (dev), Vercel serverless, Playwright for UAT, Vitest for unit tests.

**Related design doc:** `docs/plans/2026-04-21-db-performance-design.md`

**Prerequisite:** Work on a feature branch. Suggested name: `perf/phase-0-neon-driver-swap`.

---

### Task 1: Install runtime dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Install `@neondatabase/serverless` and `ws`**

Run:
```
npm install @neondatabase/serverless
npm install --save-dev ws @types/ws
```

Expected: `package.json` and `package-lock.json` updated; no errors.

**Step 2: Verify install**

Run: `npm ls @neondatabase/serverless ws`
Expected: both packages listed with resolved versions, no `UNMET DEPENDENCY`.

**Step 3: Commit**

```
git add package.json package-lock.json
git commit -m "chore(deps): add @neondatabase/serverless and ws for Phase 0 driver swap"
```

---

### Task 2: Add `isNeonUrl` helper with unit test (TDD)

**Files:**
- Create: `src/db/is-neon-url.ts`
- Create: `src/db/is-neon-url.test.ts`

**Step 1: Write the failing test**

Create `src/db/is-neon-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isNeonUrl } from "./is-neon-url";

describe("isNeonUrl", () => {
  it("returns true for neon.tech hostnames", () => {
    expect(isNeonUrl("postgres://user:pass@ep-foo.us-east-1.aws.neon.tech/db?sslmode=require")).toBe(true);
  });

  it("returns true for neon pooler hostnames", () => {
    expect(isNeonUrl("postgres://user:pass@ep-foo-pooler.us-east-1.aws.neon.tech:6543/db")).toBe(true);
  });

  it("returns false for localhost", () => {
    expect(isNeonUrl("postgres://postgres:postgres@localhost:5432/wkg_kiosk_dev")).toBe(false);
  });

  it("returns false for a bare IP", () => {
    expect(isNeonUrl("postgres://user:pass@10.0.0.5:5432/db")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isNeonUrl("")).toBe(false);
  });

  it("returns false for a malformed URL", () => {
    expect(isNeonUrl("not-a-url")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/is-neon-url.test.ts`
Expected: FAIL — module `./is-neon-url` not found.

**Step 3: Write minimal implementation**

Create `src/db/is-neon-url.ts`:

```ts
export function isNeonUrl(connectionString: string): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return url.hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/is-neon-url.test.ts`
Expected: PASS — 6 tests.

**Step 5: Commit**

```
git add src/db/is-neon-url.ts src/db/is-neon-url.test.ts
git commit -m "feat(db): add isNeonUrl helper for env-driven driver selection"
```

---

### Task 3: Swap driver in `src/db/index.ts` with env fork

**Files:**
- Modify: `src/db/index.ts` (full rewrite)

**Step 1: Read the current file to confirm baseline**

Read `src/db/index.ts`. Confirm it matches the design doc's "Before" shape: `drizzle-orm/postgres-js` with `max: 10` in prod.

**Step 2: Rewrite to env-driven fork**

Replace contents of `src/db/index.ts`:

```ts
import { drizzle as drizzlePgJs } from "drizzle-orm/postgres-js";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";
import { isNeonUrl } from "./is-neon-url";

const connectionString = process.env.DATABASE_URL!;

function createDb() {
  if (isNeonUrl(connectionString)) {
    if (typeof globalThis.WebSocket === "undefined") {
      // Node runtimes without a global WebSocket (local dev on older Node)
      // Lazy-require to avoid bundling `ws` in edge environments.
      const ws = require("ws");
      neonConfig.webSocketConstructor = ws;
    }
    const pool = new NeonPool({ connectionString });
    return drizzleNeon(pool, { schema });
  }

  const client = postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 10 : 2,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzlePgJs(client, { schema });
}

export const db = createDb();
```

Note on typing: Drizzle's return type differs between `drizzle-orm/postgres-js` and `drizzle-orm/neon-serverless`. The `createDb()` return is inferred as the union, and all existing call sites use the shared Drizzle query API surface that exists on both. If the TypeScript compiler rejects the union at any call site in Task 4, resolve by adjusting the return type annotation on `createDb` rather than editing call sites.

**Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

If errors reference `AnyDb` in `src/app/(app)/settings/data-import/sales/pipeline.ts`: update that alias to the widened union. Do not edit other call sites.

**Step 4: Build check**

Run: `npm run build`
Expected: build succeeds.

**Step 5: Commit**

```
git add src/db/index.ts src/app/\(app\)/settings/data-import/sales/pipeline.ts
git commit -m "feat(db): switch request-path to neon-serverless WebSocket Pool"
```

---

### Task 4: Gate 1a — Vitest suite against local Postgres

**Files:** none modified.

**Step 1: Confirm local Postgres is running and `DATABASE_URL` points at it**

Run: `echo "$DATABASE_URL"` (from a shell with `.env.local` loaded, or check `.env.local`).
Expected: contains `localhost` or another non-`neon.tech` host.

**Step 2: Run the Vitest suite**

Run: `npx vitest run`
Expected: all tests pass including the new `is-neon-url.test.ts`.

If any test fails due to the driver change, halt and investigate before proceeding.

---

### Task 5: Gate 1b — Playwright against local Postgres

**Files:** none modified.

**Step 1: Start the dev server**

Run (background): `npm run dev`
Wait for "ready" on port 3003.

**Step 2: Run Playwright E2E headless**

Run: `npx playwright test`
Expected: all tests pass. Screenshots in `test-results/` only for failures.

**Step 3: Stop the dev server**

Kill the background dev server.

If any test fails, halt and investigate. Do not proceed to the Neon branch until the local path is green.

---

### Task 6: Gate 1c — Playwright against a Neon dev branch

**Files:** none modified.

**Prerequisite (manual):** A Neon dev branch URL is available and exported as `DATABASE_URL`. The branch should contain the full migrated schema. Seed data is optional but recommended for realistic flows.

**Step 1: Verify the driver branch is being exercised**

Run (one-liner): `node -e "console.log(require('./src/db/is-neon-url').isNeonUrl(process.env.DATABASE_URL))"`
Expected: `true`.

**Step 2: Run the Vitest suite against Neon**

Run: `npx vitest run`
Expected: all tests pass.

**Step 3: Run Playwright E2E against the dev server pointed at Neon**

Start dev server, then:
Run: `npx playwright test`
Expected: all tests pass.

If any test fails that passed locally, the WebSocket Pool path has behavior drift. Halt and investigate.

---

### Task 7: Gate 2 — Transaction smoke tests

**Files:**
- Create: `tests/e2e/transactions.spec.ts` (or adjacent to existing E2E specs — match project convention after reading `tests/`).

**Step 1: Read existing E2E test conventions**

Read one existing Playwright spec (e.g. anything under `tests/`) to mirror the fixture and auth pattern used.

**Step 2: Write the failing test — commission run**

Add a test that:
- Logs in as admin.
- Triggers a commission run via the UI (`/analytics/commission` or the relevant action).
- Asserts the expected rows exist in the commission table after completion.

**Step 3: Run the test to verify it passes**

Run: `npx playwright test tests/e2e/transactions.spec.ts -g "commission"`
Expected: PASS against the Neon dev branch.

**Step 4: Write the failing test — sales CSV import**

Add a test that:
- Uploads a tiny CSV via `/settings/data-import/sales`.
- Asserts the import_id is returned and rows land in the expected tables.

**Step 5: Run the test**

Run: `npx playwright test tests/e2e/transactions.spec.ts -g "sales import"`
Expected: PASS.

**Step 6: Write the rollback test**

Add a test that forces a mid-transaction failure (malformed row in the CSV) and asserts:
- No partial rows persisted.
- Error surfaced to the user.

**Step 7: Run the rollback test**

Run: `npx playwright test tests/e2e/transactions.spec.ts -g "rollback"`
Expected: PASS.

**Step 8: Commit**

```
git add tests/e2e/transactions.spec.ts
git commit -m "test(e2e): transaction parity tests for Phase 0 driver swap"
```

---

### Task 8: Gate 3a — Performance measurement harness

**Files:**
- Create: `scripts/perf-measure.ts`

**Step 1: Write the harness**

Create a script that:
- Reads a target base URL from CLI arg (`--url=https://...`).
- For each of the six pages below, issues 20 authenticated GET requests serially, records the Vercel function duration from the `server-timing` response header (Vercel exposes function time as `server-timing: fn;dur=<ms>`).
- Writes a JSON report to `test-results/perf-<timestamp>.json` with per-page p50/p95/p99 and mean.
- Pages: `/analytics/heat-map`, `/analytics/hotel-groups`, `/installations`, `/kiosks`, `/locations`, `/analytics/portfolio`.

Auth approach: reuse the Playwright auth storage state (`auth.json` exists at repo root per `git status`). Or bearer-token via env if the app supports it; otherwise launch a headless Playwright context to capture cookies, then use `fetch` with the cookies.

**Step 2: Commit**

```
git add scripts/perf-measure.ts
git commit -m "test(perf): add measurement harness for Phase 0 Gate 3"
```

---

### Task 9: Gate 3b — Baseline measurement (main)

**Prerequisite:** A Vercel preview deploy of `main` exists pointing at the same Neon dev branch used in Task 6.

**Step 1: Run the harness against main's preview**

Run: `npx tsx scripts/perf-measure.ts --url=<main-preview-url> --out=test-results/perf-main.json`
Expected: JSON report written; 6 pages × 20 samples each.

---

### Task 10: Gate 3c — Candidate measurement (feature branch)

**Prerequisite:** A Vercel preview deploy of the feature branch exists pointing at the same Neon dev branch.

**Step 1: Run the harness against the feature branch preview**

Run: `npx tsx scripts/perf-measure.ts --url=<feature-preview-url> --out=test-results/perf-phase-0.json`
Expected: JSON report written.

---

### Task 11: Gate 3d — Analysis and acceptance

**Files:**
- Create: `docs/plans/2026-04-21-phase-0-results.md`

**Step 1: Compute deltas**

Diff the two JSON reports. For each page, record p50/p95 before/after and the percent change.

**Step 2: Check acceptance criteria**

Acceptance:
- p95 does not regress by more than 5% on any page.
- p95 improves on at least 3 of 6 pages.
- Neon active connection count during the candidate run stayed below the prior `max=10 × lambda` ceiling (check Neon dashboard during the run window).

**Step 3: Write the results doc**

Populate `docs/plans/2026-04-21-phase-0-results.md` with:
- The per-page table of p50/p95 before/after.
- PASS/FAIL per acceptance criterion.
- Neon connection graph observation.
- Go/no-go recommendation.

**Step 4: Commit**

```
git add docs/plans/2026-04-21-phase-0-results.md test-results/perf-main.json test-results/perf-phase-0.json
git commit -m "docs(plans): Phase 0 performance results"
```

If acceptance fails: halt. Open an issue documenting the regression shape; revisit the design. Do not merge.

---

### Task 12: Open PR

**Step 1: Push the branch**

Run: `git push -u origin perf/phase-0-neon-driver-swap`

**Step 2: Open PR**

Use `gh pr create` with a summary pointing at `docs/plans/2026-04-21-phase-0-results.md` and the design doc.

---

## Rollback

Single-commit revert of Task 3's commit is sufficient. No migrations, no schema, no data changes. If a problem surfaces post-merge, revert and redeploy.

## Out of scope

- Query rewrites, index additions, N+1 fixes — Phase 2.
- Caching — Phase 3.
- Edge runtime / materialized views — Phase 4.
- Touching `src/db/seed*.ts`, `scripts/import-*.ts`, `scripts/migrate-from-supabase.ts` — they keep `postgres-js`.
