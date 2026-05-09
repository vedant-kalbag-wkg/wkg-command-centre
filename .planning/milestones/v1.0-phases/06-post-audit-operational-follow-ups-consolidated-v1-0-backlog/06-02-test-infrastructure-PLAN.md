---
plan_id: 06-02
plan_name: test-infrastructure
phase: 6
wave: 2
depends_on: []
requirements_addressed: [SC7, SC8, SC10]
files_modified:
  - src/lib/monday/client.ts
  - src/lib/__tests__/monday-client.test.ts
  - src/lib/monday/import-location-products.ts
  - tests/kiosk-config-groups/multi-location.spec.ts
  - tests/kiosk-config-groups/list.spec.ts
  - tasks/todo.md
autonomous: true
estimated_tasks: 3
---

<must_haves>
**Phase 6 is verified for SC7 ONLY when:** the 14 `it.todo` placeholders in `src/lib/__tests__/monday-client.test.ts` are replaced with real `it(...)` tests against an extracted `src/lib/monday/client.ts` module; `npx vitest run --project unit src/lib/__tests__/monday-client.test.ts` exits 0 with all 14 tests passing; the existing Monday GraphQL traffic in `src/lib/monday/import-location-products.ts` continues to work unchanged (no behaviour regression).

**Phase 6 is verified for SC8 ONLY when:** a Playwright spec at `tests/kiosk-config-groups/multi-location.spec.ts` exists with a fixture that creates a kiosk-config-group containing ≥2 active linked locations + ≥1 active product, and asserts both `/kiosk-config-groups` (list) AND `/kiosk-config-groups/[id]` (detail) render without 500 / without error in the browser console; reverting commit `fbcce77` locally MUST cause the spec to fail (proving the spec catches the `ANY(${ids})` array-binding regression PR #29 fixed).

**SC10 contribution:** any unchecked items in `tasks/todo.md` matching "Monday-client `it.todo`" or "kiosk-config-groups regression fixture" are checked `[x]` after this plan completes (lines may not exist as explicit todos — covered by adding a final `Phase 6 follow-up: Monday client tests + kiosk-config-groups regression — landed in plan 06-02 (PR #NN)` note in the relevant section).
</must_haves>

<objective>
Two independent test-infra debts that bundle into a single low-risk PR per CONTEXT D-19:

1. **Monday GraphQL client tests** (SC7) — but per RESEARCH.md "Critical findings #2", the implementation under test does NOT exist. Today's Monday traffic lives inline in `src/lib/monday/import-location-products.ts`. This plan EXTRACTS the GraphQL wrapper into `src/lib/monday/client.ts`, retargets `import-location-products.ts` to use it, then fills the 14 `it.todo` tests against the new module. This is real refactor work (~300 LOC) plus 14 test fills — NOT a pure test job.

2. **Kiosk-config-groups multi-location regression fixture** (SC8) — PR #29 fixed a Drizzle `ANY(${ids})` → `inArray(...)` bug that 500'd `/kiosk-config-groups` when any group had ≥2 linked locations. The existing Playwright specs at `tests/kiosk-config-groups/list.spec.ts` did not catch it because the seed DB had no multi-location group. This plan adds a fixture that DOES.

Purpose: hardens the test surface so future drift in either area produces a CI signal rather than a runtime 500.

Output: 1 new module (`src/lib/monday/client.ts`), 1 refactored module (`import-location-products.ts`), 14 passing unit tests, 1 new Playwright spec, 1 confirmed regression-catching capability.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md
@src/lib/__tests__/monday-client.test.ts
@src/lib/monday/import-location-products.ts
@src/app/(app)/kiosk-config-groups/actions.ts
@tests/kiosk-config-groups/list.spec.ts
@tests/helpers/auth.ts
@playwright.config.ts
@vitest.config.ts
</context>

<interfaces>
<!-- Existing it.todo titles in src/lib/__tests__/monday-client.test.ts (verbatim from line numbers) -->
1.  ":5"  — "sends GraphQL POST to api.monday.com/v2 with auth header"
2.  ":6"  — "throws if MONDAY_API_TOKEN is not set"
3.  ":7"  — "throws on GraphQL errors in response"
4.  ":11" — "yields first page of items from items_page"
5.  ":12" — "follows cursor through next_items_page until cursor is null"
6.  ":13" — "handles empty board with zero items"
7.  ":17" — "retries on rate limit error with exponential backoff"
8.  ":18" — "throws after max retries exceeded"
9.  ":19" — "does not retry on non-rate-limit errors"
10. ":23" — "fetches subitems nested inside items query"
11. ":24" — "maps subitem column values to product/provider/commission data"
12. ":28" — "maps known Monday.com column titles to Drizzle field names"
13. ":29" — "returns unmapped columns for unknown column titles"
14. ":30" — "handles StatusValue label extraction via typed fragment"

<!-- Existing inline GraphQL fetch in src/lib/monday/import-location-products.ts -->
Line 117:
```typescript
const res = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: process.env.MONDAY_API_TOKEN!,
  },
  body: JSON.stringify({ query, variables }),
});
```

<!-- The bug PR #29 fixed (commit fbcce77) -->
File: src/app/(app)/kiosk-config-groups/actions.ts
Function: listConfigGroups
Old (broken): sql\`${locationProducts.locationId} = ANY(${ids})\` — generates `ANY(($1,$2,$3))` which Postgres rejects with 42809 on >1 location.
New (fixed): inArray(locationProducts.locationId, ids) — generates `IN ($1,$2,$3)` which works.

<!-- The Playwright admin auth helper (existing) -->
import { signInAsAdmin, TEST_ADMIN } from "../helpers/auth";
// signInAsAdmin(page) navigates to /login, fills email + password, waits for /kiosks redirect.

<!-- Vitest config (vitest.config.ts:13–65) -->
- Two projects: `unit` (Node env, no setup files), `integration` (Testcontainers Postgres)
- Globals enabled (so `describe`, `it`, `expect` are available without import — but the existing test file DOES import them, so we keep that style)
- Monday tests belong in `unit`
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract src/lib/monday/client.ts + fill 14 unit tests</name>
  <files>
    src/lib/monday/client.ts,
    src/lib/__tests__/monday-client.test.ts,
    src/lib/monday/import-location-products.ts
  </files>
  <read_first>
    - src/lib/monday/import-location-products.ts (lines 100–200 — existing inline fetch; lines 200–400 — pagination loop and column-mapping logic; lines 400–596 — subitem traversal; this is where the wrapper extraction comes from)
    - src/lib/__tests__/monday-client.test.ts (the 14 `it.todo` titles — they ARE the contract for the new module)
    - vitest.config.ts (project structure for unit tests)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md (lines 156–180 — the "Recommended planner decision" block; the implied public surface)
  </read_first>
  <behavior>
    Tests written FIRST (TDD). The 14 `it.todo` titles below define each test. Each `it.todo` becomes a real `it(...)` driven by the behaviour spec:

    - **Test 1** ("sends GraphQL POST..."): stub `fetch` via `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }))`. Call `mondayQuery('query Q { test }', {})`. Assert `fetch` was called with URL `https://api.monday.com/v2`, method `POST`, header `Authorization: <token>` from `process.env.MONDAY_API_TOKEN`, body containing the literal query string.

    - **Test 2** ("throws if MONDAY_API_TOKEN..."): clear `process.env.MONDAY_API_TOKEN`. Assert `mondayQuery(...)` throws with message containing the literal string `MONDAY_API_TOKEN`.

    - **Test 3** ("throws on GraphQL errors..."): stub `fetch` to return `{ ok: true, json: async () => ({ errors: [{ message: 'bad' }] }) }`. Assert `mondayQuery(...)` throws with message containing `bad` AND `errors`.

    - **Test 4** ("yields first page..."): stub `fetch` to return one page of 3 items + `null` cursor. Iterate `iterateBoardItems(123)`. Assert 3 items yielded.

    - **Test 5** ("follows cursor..."): stub `fetch` to return 3 sequential responses — page 1 (3 items, cursor='c1'), page 2 (3 items, cursor='c2'), page 3 (2 items, cursor=null). Assert 8 items yielded total; assert second `fetch` call body contains the literal `next_items_page(cursor: "c1")` (or equivalent variable injection).

    - **Test 6** ("handles empty board..."): stub `fetch` to return `{ items_page: { items: [], cursor: null } }`. Assert iterator yields 0 items, no throw.

    - **Test 7** ("retries on rate limit..."): stub `fetch` to return rate-limit error twice (`{ errors: [{ message: 'Rate limit', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED' } }] }` or whatever Monday's actual shape is — match `import-location-products.ts` current detection) then succeed. Assert `fetch` called 3 times; result returned successfully. Use `vi.useFakeTimers()` to fast-forward the backoff sleep.

    - **Test 8** ("throws after max retries..."): stub `fetch` to return rate-limit error 4 times in a row. Assert `mondayQueryWithRetry(...)` throws; assert `fetch` called exactly `MAX_RETRIES` times (whatever that is — define in the impl, default 3).

    - **Test 9** ("does not retry on non-rate-limit..."): stub `fetch` to return a non-rate-limit error once. Assert `fetch` called exactly 1 time; assert throw.

    - **Test 10** ("fetches subitems nested..."): stub `fetch` to return one item with `subitems: [{...}, {...}]`. Call the subitem-fetching path. Assert 2 subitems returned.

    - **Test 11** ("maps subitem column values..."): given a stubbed Monday subitem response with column values for product/provider/commission, assert the mapper returns the expected `{ productName, providerName, commissionTier }` shape (or whatever the existing `import-location-products.ts` logic expects).

    - **Test 12** ("maps known Monday.com column titles..."): pass an item with `column_values: [{ title: 'Hotel Name', text: 'X' }, ...]`. Assert the mapper returns `{ name: 'X', ... }` keyed on the Drizzle field names.

    - **Test 13** ("returns unmapped columns for unknown..."): pass an item with `column_values: [{ title: 'WeirdColumn', text: 'Y' }]`. Assert the result has an `unmapped: { WeirdColumn: 'Y' }` (or whatever the existing convention is — match `import-location-products.ts`).

    - **Test 14** ("handles StatusValue label extraction..."): pass a column value of type `StatusValue` with nested `{ label: { text: 'Active' } }`. Assert the mapper extracts `'Active'` as the column's text value (per the current TypeScript pattern in `import-location-products.ts` for status columns).

    Each test ends with a green assert. The 14 tests REPLACE the 14 `it.todo` lines (not append).
  </behavior>
  <action>
TDD order: tests first, then `src/lib/monday/client.ts` impl, then refactor `import-location-products.ts` to use the new module.

(A) **RED** — Replace `src/lib/__tests__/monday-client.test.ts` with the 14 real tests. Each test imports from `@/lib/monday/client` (which does not exist yet — tests fail to compile, that's RED).

Use this fetch-stub pattern (from RESEARCH.md lines 168–182):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mondayQuery,
  mondayQueryWithRetry,
  iterateBoardItems,
  mapColumnValues,
  // ... whatever else the 14 tests need
} from "@/lib/monday/client";

beforeEach(() => {
  process.env.MONDAY_API_TOKEN = "test-token";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("sends GraphQL POST to api.monday.com/v2 with auth header", async () => {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { boards: [] } }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  await mondayQuery("query Q { test }", {});
  expect(fetchSpy).toHaveBeenCalledWith(
    "https://api.monday.com/v2",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "test-token" }),
      body: expect.stringContaining("query Q { test }"),
    }),
  );
});

// ... all 14 tests
```

(B) **GREEN** — Create `src/lib/monday/client.ts`. Public exports (matching the 14 test contracts):

```typescript
export async function mondayQuery<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T>;

export async function mondayQueryWithRetry<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  options?: { maxRetries?: number; initialBackoffMs?: number },
): Promise<T>;

export async function* iterateBoardItems(
  boardId: number,
): AsyncGenerator<MondayItem>;

export type MondayColumnValue = { id: string; title: string; text: string | null; type?: string; value?: string | null };
export type MondayItem = {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
  subitems?: MondayItem[];
};

export function mapColumnValues<T>(
  item: MondayItem,
  columnTitleToField: Record<string, keyof T>,
): { mapped: Partial<T>; unmapped: Record<string, string | null> };

export function extractStatusLabel(value: unknown): string | null;
```

Move the inline GraphQL fetch from `import-location-products.ts:117` into `mondayQuery`. Move the pagination loop into `iterateBoardItems`. Move the column-mapping helpers into `mapColumnValues` + `extractStatusLabel`. Run tests after each move; all 14 must go green before proceeding.

(C) **REFACTOR** — In `src/lib/monday/import-location-products.ts`, replace the inline `fetch(...)` + retry + pagination + column-mapping with imports from `@/lib/monday/client`. The public exports of `import-location-products.ts` (function names + signatures) must NOT change — only the internals are refactored. Run `npm run typecheck` after the refactor.

If `import-location-products.ts` has its own tests (check `src/lib/monday/__tests__/`), they MUST still pass after the refactor. If no tests exist, add a smoke test asserting one happy-path import call returns the expected shape.
  </action>
  <verify>
    <automated>
npx vitest run --project unit src/lib/__tests__/monday-client.test.ts && npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/monday/client.ts` exists.
    - `grep -c '^export' src/lib/monday/client.ts` returns ≥ 5 (mondayQuery, mondayQueryWithRetry, iterateBoardItems, mapColumnValues, extractStatusLabel — plus any types).
    - `grep -c 'it\.todo' src/lib/__tests__/monday-client.test.ts` returns 0.
    - `grep -c '^  it(' src/lib/__tests__/monday-client.test.ts` returns ≥ 14.
    - `npx vitest run --project unit src/lib/__tests__/monday-client.test.ts` exits 0 with `14 passed`.
    - `grep -c 'fetch("https://api.monday.com/v2"' src/lib/monday/import-location-products.ts` returns 0 (the inline fetch has been removed).
    - `grep -c "from \"@/lib/monday/client\"" src/lib/monday/import-location-products.ts` returns ≥ 1.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Monday GraphQL client is a first-class testable module; 14 unit tests cover the auth/pagination/retry/mapping surfaces; `import-location-products.ts` consumes the extracted module without behaviour change.
  </done>
</task>

<task type="auto">
  <name>Task 2: Multi-location kiosk-config-groups Playwright fixture</name>
  <files>
    tests/kiosk-config-groups/multi-location.spec.ts,
    tests/kiosk-config-groups/list.spec.ts
  </files>
  <read_first>
    - tests/kiosk-config-groups/list.spec.ts (existing 3 tests — pattern to mirror)
    - tests/helpers/auth.ts (signInAsAdmin)
    - src/app/(app)/kiosk-config-groups/actions.ts (the file PR #29 fixed — `listConfigGroups` at line 28; the `inArray(locationProducts.locationId, ids)` call at line 86 is what the regression catches)
    - tests/helpers/db.ts (DB helper for inline test seeding — read its actual exports; if it doesn't have what we need, the spec uses server actions instead)
    - playwright.config.ts (workers: 1, fullyParallel: false — safe for inline DB seeding)
  </read_first>
  <action>
Create `tests/kiosk-config-groups/multi-location.spec.ts` with a fixture that seeds (and cleans up) a config group containing ≥2 active linked locations + ≥1 active product, then asserts both list and detail pages render without 500 / browser console error.

Two approaches; **pick (B)** — direct DB seeding via test helpers — because the existing `db:seed` is minimal and extending it pollutes every test run.

```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";
import { db } from "@/db";
import {
  kioskConfigGroups,
  locations,
  products,
  locationProducts,
  regions,
  user as userTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const FIXTURE_GROUP_NAME = "_e2e_multi_location_group";
const FIXTURE_PRODUCT_NAME = "_e2e_multi_location_product";

test.describe("@kiosk-config-groups multi-location regression (PR #29)", () => {
  let groupId: string;
  let location1Id: string;
  let location2Id: string;
  let productId: string;

  test.beforeAll(async () => {
    // Resolve any existing region (every location requires primary_region_id)
    const [region] = await db.select().from(regions).limit(1);
    if (!region) throw new Error("Test prerequisite: at least one region must exist (run npm run db:seed first)");

    // Seed config group
    const [group] = await db.insert(kioskConfigGroups).values({ name: FIXTURE_GROUP_NAME }).returning();
    groupId = group.id;

    // Seed two active locations linked to the group
    const [loc1] = await db.insert(locations).values({
      name: "_e2e Multi-Location 1",
      outletCode: `_e2e_1_${randomUUID().slice(0, 4)}`,
      primaryRegionId: region.id,
      kioskConfigGroupId: groupId,
    }).returning();
    location1Id = loc1.id;
    const [loc2] = await db.insert(locations).values({
      name: "_e2e Multi-Location 2",
      outletCode: `_e2e_2_${randomUUID().slice(0, 4)}`,
      primaryRegionId: region.id,
      kioskConfigGroupId: groupId,
    }).returning();
    location2Id = loc2.id;

    // Seed one active product attached to BOTH locations (so productAvailability count > 0)
    const [product] = await db.insert(products).values({ name: FIXTURE_PRODUCT_NAME }).returning();
    productId = product.id;
    await db.insert(locationProducts).values([
      { locationId: location1Id, productId, providerId: null, availability: "yes" },
      { locationId: location2Id, productId, providerId: null, availability: "yes" },
    ]);
  });

  test.afterAll(async () => {
    // Clean up — delete in reverse FK order
    await db.delete(locationProducts).where(eq(locationProducts.productId, productId)).catch(() => {});
    await db.delete(products).where(eq(products.id, productId)).catch(() => {});
    await db.delete(locations).where(eq(locations.id, location1Id)).catch(() => {});
    await db.delete(locations).where(eq(locations.id, location2Id)).catch(() => {});
    await db.delete(kioskConfigGroups).where(eq(kioskConfigGroups.id, groupId)).catch(() => {});
  });

  test("list page (/kiosk-config-groups) renders the multi-location group without 500", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await signInAsAdmin(page);
    const response = await page.goto("/kiosk-config-groups");
    expect(response?.status()).toBeLessThan(400); // catches the 500 PR #29 fixed
    await expect(page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 })).toBeVisible();
    await expect(page.getByText(FIXTURE_GROUP_NAME)).toBeVisible({ timeout: 10_000 });
    expect(consoleErrors).toEqual([]);
  });

  test("detail page (/kiosk-config-groups/[id]) renders both linked locations", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await signInAsAdmin(page);
    const response = await page.goto(`/kiosk-config-groups/${groupId}`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByText("_e2e Multi-Location 1")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("_e2e Multi-Location 2")).toBeVisible({ timeout: 10_000 });
    expect(consoleErrors).toEqual([]);
  });
});
```

The fixture explicitly creates ≥2 active linked locations + ≥1 active product. This is the EXACT shape that surfaces the `ANY(${ids})` Drizzle bug — `ids.length === 2` triggers the broken positional-tuple binding.

If the test DB does not have a `regions` row to attach to, the test ABORTS in `beforeAll` rather than silently skipping (so a missing seed becomes a CI signal, not a green-but-empty test). Operator must run `npm run db:seed` before the suite.

After writing the spec, document the regression-catch property in `tests/kiosk-config-groups/list.spec.ts` (a top-of-file comment): "Multi-location regression coverage lives in `multi-location.spec.ts`. To verify the spec catches PR #29's bug: `git revert --no-commit fbcce77 && npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` — the list-page test must FAIL."
  </action>
  <verify>
    <automated>
npx playwright test tests/kiosk-config-groups/multi-location.spec.ts --reporter=list
    </automated>
  </verify>
  <acceptance_criteria>
    - File `tests/kiosk-config-groups/multi-location.spec.ts` exists.
    - `grep -c "test(" tests/kiosk-config-groups/multi-location.spec.ts` returns 2 (list page + detail page).
    - `grep -c "_e2e_multi_location_group\|FIXTURE_GROUP_NAME" tests/kiosk-config-groups/multi-location.spec.ts` returns ≥ 2.
    - `grep -c "kioskConfigGroupId: groupId" tests/kiosk-config-groups/multi-location.spec.ts` returns ≥ 2 (both locations linked).
    - `npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` exits 0.
    - `grep -c "multi-location.spec.ts\|PR #29" tests/kiosk-config-groups/list.spec.ts` returns ≥ 1 (cross-reference comment added).
    - One-time manual verification (operator runs after task complete): `git stash && git revert --no-commit fbcce77 && npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` — the list-page test FAILS. Restore with `git revert --abort && git stash pop`.
  </acceptance_criteria>
  <done>
    The regression that PR #29 hot-fixed is now permanently guarded by Playwright. Future drift in `listConfigGroups` SQL produces a CI failure, not a runtime 500.
  </done>
</task>

<task type="auto">
  <name>Task 3: Update todo.md + per-plan summary commit</name>
  <files>
    tasks/todo.md
  </files>
  <read_first>
    - tasks/todo.md (search for "monday-client" or "kiosk-config-groups" to locate the relevant lines)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md (D-19 + summary-commit conventions)
  </read_first>
  <action>
Add a brief follow-up note to `tasks/todo.md` under the Phase 8 section (or as a new line at the bottom of "Informal follow-ups" section depending on file shape after plan 06-01 / 06-04 land first):

```
- [x] **Phase 6 plan 06-02** — Monday GraphQL client extracted to `src/lib/monday/client.ts` with 14 unit tests covering auth/pagination/retry/mapping. Kiosk-config-groups multi-location Playwright regression fixture at `tests/kiosk-config-groups/multi-location.spec.ts` (would catch PR #29 `ANY(${ids})` bug). (PR #NN, YYYY-MM-DD).
```

Per-plan summary commit on the plan's branch (`gsd/phase-06-test-infra`): `feat(test-infra): extract monday GraphQL client + multi-location config-groups regression fixture (SC7, SC8)`.
  </action>
  <verify>
    <automated>
grep -c "Phase 6 plan 06-02\|monday GraphQL client extracted" tasks/todo.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase 6 plan 06-02" tasks/todo.md` returns ≥ 1.
    - The plan branch's most recent commit subject contains the literal string `monday` or `test-infra` and references SC7 + SC8.
  </acceptance_criteria>
  <done>
    todo.md reflects this plan's completion; commit on the per-plan branch is ready for PR.
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0
- `npx vitest run --project unit src/lib/__tests__/monday-client.test.ts` exits 0 with 14 passed
- `npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` exits 0
- `git revert --no-commit fbcce77 && npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` (one-time manual) — list-page test FAILS, proving regression coverage; restore with `git revert --abort`
- `tasks/todo.md` has the Phase 6 plan 06-02 line added
</verification>

<success_criteria>
1. SC7 — 14 Monday-client `it.todo` placeholders are now passing real tests against an extracted `src/lib/monday/client.ts` module; `import-location-products.ts` consumes the new module without behaviour change.
2. SC8 — Playwright spec at `tests/kiosk-config-groups/multi-location.spec.ts` catches the `ANY(${ids})` regression PR #29 fixed (verified by reverting `fbcce77` locally — list-page test fails).
3. SC10 contribution — `tasks/todo.md` has the Phase 6 plan 06-02 follow-up tick.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-02-SUMMARY.md` documenting: file diff stats; 14 test names that went from `it.todo` → `it`; the manual revert-fbcce77 verification result; PR # + merge SHA.
</output>
