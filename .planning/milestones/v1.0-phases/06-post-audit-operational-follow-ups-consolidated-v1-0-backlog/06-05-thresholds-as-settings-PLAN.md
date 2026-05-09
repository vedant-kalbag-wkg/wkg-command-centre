---
plan_id: 06-05
plan_name: thresholds-as-settings
phase: 6
wave: 3
depends_on: []
requirements_addressed: [SC3, SC10]
files_modified:
  - src/lib/analytics/thresholds-server.ts
  - src/lib/analytics/thresholds.ts
  - src/lib/analytics/metrics.ts
  - src/lib/analytics/__tests__/metrics.test.ts
  - src/lib/analytics/__tests__/thresholds-server.test.ts
  - src/lib/analytics/queries/portfolio.ts
  - src/app/(app)/settings/thresholds/page.tsx
  - src/app/(app)/settings/thresholds/actions.ts
  - src/app/(app)/analytics/heat-map/page.tsx
  - src/app/(app)/analytics/portfolio/page.tsx
  - src/components/analytics/filter-bar.tsx
  - src/lib/analytics/search-params-to-filters.ts
  - tests/settings-thresholds/outlet-tier.spec.ts
  - tests/analytics-heat-map/url-overrides.spec.ts
  - tasks/todo.md
autonomous: true
estimated_tasks: 3
---

<must_haves>
**Phase 6 is verified for SC3 ONLY when:** the existing `/settings/thresholds` admin page has THREE new numeric inputs (`tierTop`, `tierMid`, `tierBottom` — defaults 80/50/20 per CONTEXT D-06); saving writes to `appSettings` keys `threshold_outlet_tier_top` / `threshold_outlet_tier_mid` / `threshold_outlet_tier_bottom` AND writes one `audit_logs` row with `entity_type='app_setting'`, `field='outlet_tier_thresholds'`; AND `classifyOutletTier` is refactored to take `(percentile: number, config: OutletTierConfig)` so the caller injects the loaded thresholds; AND `/analytics/heat-map/page.tsx` + `/analytics/portfolio/page.tsx` no longer hard-code `{ redMax: 500, greenMin: 1500 }` but call `getThresholdsCached()` server-side (RESEARCH.md "Critical findings #1"); AND URL params `?redMax=`, `?greenMin=`, `?tierTop=`, `?tierMid=`, `?tierBottom=` override the saved settings per-session (CONTEXT D-09 "temp override only" — no auto-save).

**SC10 contribution:** `tasks/todo.md` lines 103 (6.2) and 107 (6.6) are checked `[x]` after this plan completes.
</must_haves>

<objective>
Lift the magic-number thresholds out of code into the existing `appSettings` table + admin UI. Per RESEARCH.md "Critical findings #1", `/settings/thresholds` is NOT greenfield — it already saves `redMax/greenMin` with audit-log. This plan EXTENDS that page with the three outlet-tier cutoffs (80/50/20) AND fixes the silent-defaults bug where heat-map and portfolio pages hard-code 500/1500 instead of reading from `appSettings`.

Per CONTEXT D-06, plateau ±10% is DEFERRED — does NOT change in this plan.

Per CONTEXT D-19, this plan ships as PR 3 (its own PR; not bundled).

Output: 6 source-code edits (thresholds-server, metrics, portfolio, settings/thresholds page+action, heat-map+portfolio pages, filter-bar URL-param wiring); 2 new vitest unit-test files; 2 new Playwright specs.
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
@src/lib/analytics/thresholds-server.ts
@src/lib/analytics/metrics.ts
@src/lib/analytics/queries/portfolio.ts
@src/app/(app)/settings/thresholds/page.tsx
@src/app/(app)/settings/thresholds/actions.ts
@src/components/analytics/filter-bar.tsx
@src/lib/audit.ts
</context>

<interfaces>
<!-- Existing thresholds-server.ts (to extend) -->
```typescript
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import type { ThresholdConfig } from "./thresholds";

const DEFAULTS: ThresholdConfig = { redMax: 500, greenMin: 1500 };

export const THRESHOLDS_TAG = "analytics:thresholds";

const getThresholdsCached = unstable_cache(
  async (): Promise<ThresholdConfig> => {
    const rows = await db.select().from(appSettings)
      .where(inArray(appSettings.key, ["threshold_red_max", "threshold_green_min"]));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      redMax: Number(map.get("threshold_red_max") ?? DEFAULTS.redMax),
      greenMin: Number(map.get("threshold_green_min") ?? DEFAULTS.greenMin),
    };
  },
  ["analytics", "thresholds", "v1"],
  { revalidate: 86400, tags: ["analytics", THRESHOLDS_TAG] },
);
```

<!-- Current classifyOutletTier (src/lib/analytics/metrics.ts:105-110) — hard-coded -->
```typescript
export function classifyOutletTier(percentile: number): OutletTier {
  if (percentile >= 80) return "Premium";
  if (percentile >= 50) return "Standard";
  if (percentile >= 20) return "Developing";
  return "Emerging";
}
```

<!-- Current caller in src/lib/analytics/queries/portfolio.ts:500 -->
```typescript
tier: classifyOutletTier(percentile),  // bare call — to be replaced
```

<!-- Hardcoded defaults in heat-map page.tsx:22 (RESEARCH.md "Critical findings #1") -->
```typescript
const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({ redMax: 500, greenMin: 1500 });
```

<!-- Hardcoded defaults in portfolio page.tsx:81-82 -->
```typescript
redMax: 500,
greenMin: 1500,
```

<!-- Existing settings/thresholds saveThresholds action (extend, not replace) -->
```typescript
export async function saveThresholds(
  config: ThresholdConfig,
): Promise<{ success: true } | { error: string }>
```

<!-- HEAT_MAP_SCORE_THRESHOLDS in performance-table.tsx:47 — DIFFERENT thresholds (composite-score 0–100). RESEARCH.md "Pitfalls" — DO NOT TOUCH this constant. -->

<!-- PLATEAU_THRESHOLD_PCT in plateau-insight.ts:26 — DELIBERATELY EXCLUDED per CONTEXT D-06. DO NOT TOUCH. -->

<!-- FilterBar URL-param wiring (existing — see filter-bar.tsx:60: `const parsed = searchParamsToFilters(searchParams);`) -->
<!-- Add new URL param parsers for redMax/greenMin/tierTop/tierMid/tierBottom in src/lib/analytics/search-params-to-filters.ts (locate file in Task 3 — read filter-bar.tsx line 11 for the actual import path). -->
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend thresholds-server + refactor classifyOutletTier with unit tests</name>
  <files>
    src/lib/analytics/thresholds-server.ts,
    src/lib/analytics/thresholds.ts,
    src/lib/analytics/metrics.ts,
    src/lib/analytics/__tests__/metrics.test.ts,
    src/lib/analytics/__tests__/thresholds-server.test.ts,
    src/lib/analytics/queries/portfolio.ts
  </files>
  <read_first>
    - src/lib/analytics/thresholds-server.ts (all 30 lines — the existing cached reader to extend)
    - src/lib/analytics/thresholds.ts (the type definitions and any constants — read fully)
    - src/lib/analytics/metrics.ts (lines 103–118 — `classifyOutletTier` and `calculatePercentile`)
    - src/lib/analytics/queries/portfolio.ts (lines 480–510 — the call site at line 500 + the surrounding `tier:` mapping; line 629 — `getOutletTiersCached` cache wrapper which needs invalidation when thresholds change)
    - src/db/schema.ts (lines 97–102 — `appSettings` table definition)
    - src/lib/analytics/queries/hotel-groups.test.ts (referenced in RESEARCH.md as the canonical vitest mock pattern for `db` — mirror this pattern in the new tests)
  </read_first>
  <behavior>
    Tests written first.

    **`metrics.test.ts` covers `classifyOutletTier(percentile, config)`:**
    - Test 1: `classifyOutletTier(85, { top: 80, mid: 50, bottom: 20 })` → `"Premium"` (boundary at 80, inclusive)
    - Test 2: `classifyOutletTier(80, { top: 80, mid: 50, bottom: 20 })` → `"Premium"` (≥ inclusive)
    - Test 3: `classifyOutletTier(79, { top: 80, mid: 50, bottom: 20 })` → `"Standard"`
    - Test 4: `classifyOutletTier(50, { top: 80, mid: 50, bottom: 20 })` → `"Standard"`
    - Test 5: `classifyOutletTier(49, { top: 80, mid: 50, bottom: 20 })` → `"Developing"`
    - Test 6: `classifyOutletTier(20, { top: 80, mid: 50, bottom: 20 })` → `"Developing"`
    - Test 7: `classifyOutletTier(19, { top: 80, mid: 50, bottom: 20 })` → `"Emerging"`
    - Test 8: `classifyOutletTier(0, { top: 80, mid: 50, bottom: 20 })` → `"Emerging"`
    - Test 9 (custom config): `classifyOutletTier(75, { top: 90, mid: 60, bottom: 30 })` → `"Standard"` (75 < 90 but ≥ 60)
    - Test 10 (validation contract — caller's responsibility, but documenting): if config is `{ top: 50, mid: 80, bottom: 20 }` (invalid: top < mid), behaviour is undefined — the form-layer validates this. Add a test asserting the function does NOT throw on invalid config (so a misconfigured DB row doesn't 500 the dashboard); it just returns whatever falls out of the if-chain.

    **`thresholds-server.test.ts` covers the cached reader:**
    - Test 1 (defaults): when no `appSettings` rows exist for the new keys, `getOutletTierThresholdsCached()` returns `{ top: 80, mid: 50, bottom: 20 }`.
    - Test 2 (overrides): when `appSettings` has rows `threshold_outlet_tier_top=85`, `threshold_outlet_tier_mid=55`, `threshold_outlet_tier_bottom=25`, the cached reader returns `{ top: 85, mid: 55, bottom: 25 }`.
    - Test 3 (partial override): only `threshold_outlet_tier_top=85` set; other two fall back to defaults `mid=50, bottom=20`.
    - Test 4 (numeric coercion): `appSettings.value` is `text` column, so saved as `"85"` — the reader must `Number()`-coerce.
  </behavior>
  <action>
**Step 1 — RED: write the two test files.**

Mirror the vitest pattern from `src/lib/analytics/queries/hotel-groups.test.ts` (per RESEARCH.md lines 168–180):

```typescript
// src/lib/analytics/__tests__/thresholds-server.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSelect = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: mockSelect }) }) },
}));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

import { getOutletTierThresholdsCached } from "../thresholds-server";

describe("getOutletTierThresholdsCached", () => {
  beforeEach(() => mockSelect.mockReset());
  it("returns defaults when no rows exist", async () => {
    mockSelect.mockResolvedValue([]);
    const config = await getOutletTierThresholdsCached();
    expect(config).toEqual({ top: 80, mid: 50, bottom: 20 });
  });
  // ... tests 2-4
});
```

**Step 2 — GREEN: extend `thresholds-server.ts`.**

Add a SIBLING cached reader (per RESEARCH.md "Critical findings #1" recommendation: "sibling keeps the cache-tag invalidation surface tight"):

```typescript
export type OutletTierConfig = { top: number; bottom: number; mid: number };

const OUTLET_TIER_DEFAULTS: OutletTierConfig = { top: 80, mid: 50, bottom: 20 };

export const OUTLET_TIER_THRESHOLDS_TAG = "analytics:outlet_tier_thresholds";

export const getOutletTierThresholdsCached = unstable_cache(
  async (): Promise<OutletTierConfig> => {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, [
        "threshold_outlet_tier_top",
        "threshold_outlet_tier_mid",
        "threshold_outlet_tier_bottom",
      ]));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      top: Number(map.get("threshold_outlet_tier_top") ?? OUTLET_TIER_DEFAULTS.top),
      mid: Number(map.get("threshold_outlet_tier_mid") ?? OUTLET_TIER_DEFAULTS.mid),
      bottom: Number(map.get("threshold_outlet_tier_bottom") ?? OUTLET_TIER_DEFAULTS.bottom),
    };
  },
  ["analytics", "outlet_tier_thresholds", "v1"],
  { revalidate: 86400, tags: ["analytics", OUTLET_TIER_THRESHOLDS_TAG, "outlet_tiers"] },
);
```

Note the `"outlet_tiers"` cache tag in the tags array — `getOutletTiersCached` (in portfolio.ts:629) uses this tag, so saving thresholds invalidates the outlet-tiers query result too. RESEARCH.md "Pitfalls" called this out specifically: "Make sure the cache key incorporates the threshold config OR invalidate the cache on threshold-save."

Also re-export `OutletTierConfig` from `src/lib/analytics/thresholds.ts` for shared access.

**Step 3 — Refactor `classifyOutletTier`.**

In `src/lib/analytics/metrics.ts:105`, change:
```typescript
export function classifyOutletTier(percentile: number): OutletTier {
  if (percentile >= 80) return "Premium";
  // ...
}
```
to:
```typescript
import type { OutletTierConfig } from "./thresholds";

export function classifyOutletTier(percentile: number, config: OutletTierConfig): OutletTier {
  if (percentile >= config.top) return "Premium";
  if (percentile >= config.mid) return "Standard";
  if (percentile >= config.bottom) return "Developing";
  return "Emerging";
}
```

This is a BREAKING signature change. Find every call site:
```bash
grep -rn "classifyOutletTier(" src/ --include="*.ts" --include="*.tsx"
```

The known caller per RESEARCH.md is `src/lib/analytics/queries/portfolio.ts:500`. Update it:
```typescript
// at top of getOutletTiers function:
import { getOutletTierThresholdsCached } from "@/lib/analytics/thresholds-server";

export async function getOutletTiers(filters, userCtx) {
  const tierConfig = await getOutletTierThresholdsCached();
  // ...
  // line 500:
  tier: classifyOutletTier(percentile, tierConfig),
}
```

If the grep finds other callers, update them similarly. If a caller is in test code, the test fixtures must be updated to pass the config explicitly.

**Step 4 — VERIFY: tests go green.**

Run:
```bash
npx vitest run --project unit src/lib/analytics/__tests__/metrics.test.ts src/lib/analytics/__tests__/thresholds-server.test.ts
```
All tests pass. Then:
```bash
npm run typecheck
```
Zero errors. (If typecheck fails, it's because a `classifyOutletTier(...)` call site was missed — find and fix.)
  </action>
  <verify>
    <automated>
npx vitest run --project unit src/lib/analytics/__tests__/metrics.test.ts src/lib/analytics/__tests__/thresholds-server.test.ts && npm run typecheck
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/analytics/__tests__/metrics.test.ts` exists; `grep -c "^  it(" src/lib/analytics/__tests__/metrics.test.ts` returns ≥ 10.
    - File `src/lib/analytics/__tests__/thresholds-server.test.ts` exists; `grep -c "^  it(" src/lib/analytics/__tests__/thresholds-server.test.ts` returns ≥ 4.
    - `grep -n "getOutletTierThresholdsCached" src/lib/analytics/thresholds-server.ts` returns ≥ 1 line.
    - `grep -n "OUTLET_TIER_THRESHOLDS_TAG" src/lib/analytics/thresholds-server.ts` returns ≥ 1 line.
    - `grep -E "classifyOutletTier\(percentile\)" src/` returns ZERO results (every call site now passes the config).
    - `grep -c "classifyOutletTier(percentile, " src/lib/analytics/queries/portfolio.ts` returns ≥ 1.
    - `grep -c "getOutletTierThresholdsCached" src/lib/analytics/queries/portfolio.ts` returns ≥ 1.
    - `npx vitest run --project unit src/lib/analytics/__tests__/metrics.test.ts` exits 0 with at least 10 passed.
    - `npx vitest run --project unit src/lib/analytics/__tests__/thresholds-server.test.ts` exits 0 with at least 4 passed.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Outlet-tier thresholds are now read from `appSettings` via a cached reader, with sensible defaults; `classifyOutletTier` is config-driven; tests cover the boundary conditions and the default/override paths; the `getOutletTiers` query invalidates correctly when thresholds change.
  </done>
</task>

<task type="auto">
  <name>Task 2: Extend /settings/thresholds page + action with three outlet-tier inputs</name>
  <files>
    src/app/(app)/settings/thresholds/page.tsx,
    src/app/(app)/settings/thresholds/actions.ts,
    tests/settings-thresholds/outlet-tier.spec.ts
  </files>
  <read_first>
    - src/app/(app)/settings/thresholds/page.tsx (all 173 lines — existing form layout to extend)
    - src/app/(app)/settings/thresholds/actions.ts (all 70 lines — existing `saveThresholds` action with audit-log + revalidateTag)
    - src/lib/analytics/thresholds-server.ts (post-Task 1; `getOutletTierThresholdsCached` and `OUTLET_TIER_THRESHOLDS_TAG`)
    - tests/kiosk-config-groups/list.spec.ts (Playwright pattern in this repo for an admin-only settings page)
  </read_first>
  <action>
**(A) Extend `actions.ts`** — add a sibling `saveOutletTierThresholds` action with the same shape as `saveThresholds`. Keep them separate (single-purpose actions are easier to reason about than one action with two payload shapes):

```typescript
"use server";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  getThresholds,
  getOutletTierThresholdsCached,
  THRESHOLDS_TAG,
  OUTLET_TIER_THRESHOLDS_TAG,
} from "@/lib/analytics/thresholds-server";
import { revalidateTag } from "next/cache";
import type { ThresholdConfig, OutletTierConfig } from "@/lib/analytics/thresholds";

// existing saveThresholds — UNCHANGED (read it; do not modify)
export async function saveThresholds(config: ThresholdConfig): Promise<...> { /* ... */ }

// NEW
export async function fetchOutletTierThresholds(): Promise<OutletTierConfig> {
  await requireRole("admin");
  return getOutletTierThresholdsCached();
}

export async function saveOutletTierThresholds(
  config: OutletTierConfig,
): Promise<{ success: true } | { error: string }> {
  const session = await requireRole("admin");

  if (config.top <= 0 || config.top > 100) return { error: "Top cutoff must be between 1 and 100" };
  if (config.mid <= 0 || config.mid > 100) return { error: "Mid cutoff must be between 1 and 100" };
  if (config.bottom < 0 || config.bottom > 100) return { error: "Bottom cutoff must be between 0 and 100" };
  if (!(config.top > config.mid && config.mid > config.bottom)) {
    return { error: "Cutoffs must satisfy: top > mid > bottom (e.g. 80 > 50 > 20)" };
  }

  try {
    const old = await getOutletTierThresholdsCached();
    for (const [key, value] of [
      ["threshold_outlet_tier_top", config.top],
      ["threshold_outlet_tier_mid", config.mid],
      ["threshold_outlet_tier_bottom", config.bottom],
    ] as const) {
      await db
        .insert(appSettings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: String(value), updatedAt: new Date() },
        });
    }

    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "app_setting",
      entityId: "outlet_tier_thresholds",
      entityName: "Outlet Tier Thresholds",
      action: "update",
      field: "outlet_tier_thresholds",
      oldValue: JSON.stringify(old),
      newValue: JSON.stringify(config),
    });

    revalidateTag(OUTLET_TIER_THRESHOLDS_TAG, "max");
    revalidateTag("outlet_tiers", "max"); // invalidates the consumer query too

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save outlet tier thresholds" };
  }
}
```

**(B) Extend `page.tsx`** — add a SECOND `<Card>` titled "Outlet Tier Cutoffs" below the existing "Revenue Thresholds" card. Three numeric inputs (`tierTop`, `tierMid`, `tierBottom`) with `min=0 max=100`, save button, validation message slot, preview block ("Premium ≥ X / Standard X-1 to Y / Developing Y-1 to Z / Emerging < Z").

Pattern to mirror: the existing `redMax/greenMin` form on the same page (lines 41–172). Use the same `useState` + `useEffect(fetchOutletTierThresholds)` + `handleSave` shape. Both cards live on the same page; saving each is independent (separate Save buttons).

**(C) Add Playwright spec at `tests/settings-thresholds/outlet-tier.spec.ts`:**

```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@thresholds outlet-tier form saves three values and persists across reload", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/thresholds");
  await expect(page.getByRole("heading", { name: "Performance Thresholds", level: 1 })).toBeVisible();
  await expect(page.getByText("Outlet Tier Cutoffs")).toBeVisible();

  await page.getByLabel(/top cutoff/i).fill("85");
  await page.getByLabel(/mid cutoff/i).fill("55");
  await page.getByLabel(/bottom cutoff/i).fill("25");
  await page.getByRole("button", { name: /save outlet tier/i }).click();
  await expect(page.getByText(/saved successfully|saved/i)).toBeVisible({ timeout: 5_000 });

  await page.reload();
  await expect(page.getByLabel(/top cutoff/i)).toHaveValue("85");
  await expect(page.getByLabel(/mid cutoff/i)).toHaveValue("55");
  await expect(page.getByLabel(/bottom cutoff/i)).toHaveValue("25");

  // Restore defaults so the test doesn't leak state to other specs
  await page.getByLabel(/top cutoff/i).fill("80");
  await page.getByLabel(/mid cutoff/i).fill("50");
  await page.getByLabel(/bottom cutoff/i).fill("20");
  await page.getByRole("button", { name: /save outlet tier/i }).click();
});

test("@thresholds outlet-tier validation rejects top <= mid", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/thresholds");
  await page.getByLabel(/top cutoff/i).fill("40");
  await page.getByLabel(/mid cutoff/i).fill("50");
  await page.getByLabel(/bottom cutoff/i).fill("20");
  await page.getByRole("button", { name: /save outlet tier/i }).click();
  await expect(page.getByText(/top > mid > bottom/i)).toBeVisible({ timeout: 5_000 });
});
```

Add `data-testid="outlet-tier-form"` and label `htmlFor="tierTop"` etc. on the inputs in `page.tsx` so the spec's `getByLabel` works reliably.
  </action>
  <verify>
    <automated>
npm run typecheck && npx playwright test tests/settings-thresholds/outlet-tier.spec.ts --reporter=list
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "saveOutletTierThresholds\|fetchOutletTierThresholds" src/app/\(app\)/settings/thresholds/actions.ts` returns ≥ 2.
    - `grep -c "Outlet Tier Cutoffs\|tierTop\|tierMid\|tierBottom" src/app/\(app\)/settings/thresholds/page.tsx` returns ≥ 4.
    - `grep -c "writeAuditLog" src/app/\(app\)/settings/thresholds/actions.ts` returns ≥ 2 (one in saveThresholds, one in saveOutletTierThresholds).
    - `grep -c "revalidateTag(\"outlet_tiers\"" src/app/\(app\)/settings/thresholds/actions.ts` returns ≥ 1.
    - File `tests/settings-thresholds/outlet-tier.spec.ts` exists with ≥ 2 tests.
    - `npx playwright test tests/settings-thresholds/outlet-tier.spec.ts` exits 0.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Admin can save outlet-tier cutoffs from `/settings/thresholds`; values persist; audit-log row written per save; consumer queries invalidate; Playwright covers the happy-path AND the validation error.
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire heat-map + portfolio to read from settings + URL-param overrides + close todo.md</name>
  <files>
    src/app/(app)/analytics/heat-map/page.tsx,
    src/app/(app)/analytics/portfolio/page.tsx,
    src/components/analytics/filter-bar.tsx,
    src/lib/analytics/search-params-to-filters.ts,
    tests/analytics-heat-map/url-overrides.spec.ts,
    tasks/todo.md
  </files>
  <read_first>
    - src/app/(app)/analytics/heat-map/page.tsx (line 22: hard-coded `useState({ redMax: 500, greenMin: 1500 })` — RESEARCH.md "Critical findings #1")
    - src/app/(app)/analytics/portfolio/page.tsx (lines 81–82: hard-coded `redMax: 500, greenMin: 1500`)
    - src/components/analytics/filter-bar.tsx (lines 28–60: existing URL-param parsing via `useSearchParams` and `searchParamsToFilters`)
    - src/lib/analytics/search-params-to-filters.ts (the parser — exact path may differ; locate via `grep -rn "export.*searchParamsToFilters" src/`)
    - src/lib/analytics/thresholds-server.ts (post-Task 1)
  </read_first>
  <action>
**(A) Make heat-map page read from settings, with URL-param override.**

In `src/app/(app)/analytics/heat-map/page.tsx`, the page is a Client Component (uses `useState` for thresholdConfig). The existing pattern is to fetch via server action; mirror that:

1. At the top of the file, replace the hard-coded `useState({ redMax: 500, greenMin: 1500 })` with:
```typescript
const searchParams = useSearchParams();
const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({ redMax: 500, greenMin: 1500 });
const [tierConfig, setTierConfig] = useState<OutletTierConfig>({ top: 80, mid: 50, bottom: 20 });

useEffect(() => {
  fetchThresholds().then((cfg) => setThresholdConfig(cfg)).catch(() => {});
  fetchOutletTierThresholds().then((cfg) => setTierConfig(cfg)).catch(() => {});
}, []);

// Apply URL-param overrides on top of the loaded settings (per CONTEXT D-09: temp-override semantics)
const effectiveThresholds = useMemo<ThresholdConfig>(() => ({
  redMax: searchParams.get("redMax") !== null ? Number(searchParams.get("redMax")) : thresholdConfig.redMax,
  greenMin: searchParams.get("greenMin") !== null ? Number(searchParams.get("greenMin")) : thresholdConfig.greenMin,
}), [searchParams, thresholdConfig]);

const effectiveTiers = useMemo<OutletTierConfig>(() => ({
  top: searchParams.get("tierTop") !== null ? Number(searchParams.get("tierTop")) : tierConfig.top,
  mid: searchParams.get("tierMid") !== null ? Number(searchParams.get("tierMid")) : tierConfig.mid,
  bottom: searchParams.get("tierBottom") !== null ? Number(searchParams.get("tierBottom")) : tierConfig.bottom,
}), [searchParams, tierConfig]);
```

Use `effectiveThresholds` (not `thresholdConfig`) wherever the heat-map cells are rendered. Same for `effectiveTiers` if the heat-map page renders any tier-classified rows.

**(B) Make portfolio page read from settings.**

In `src/app/(app)/analytics/portfolio/page.tsx`, find lines 81–82 (the hard-coded `redMax: 500, greenMin: 1500`). Replace with the same `fetchThresholds` + `fetchOutletTierThresholds` pattern — including URL-param override per (A). Wire `effectiveTiers` into the props passed to `<OutletTiers />` so the portfolio page's tier classifications respect the saved cutoffs.

NOTE: `getOutletTiers` (in queries/portfolio.ts) is server-side and was already wired in Task 1 to call `getOutletTierThresholdsCached()` server-side. The portfolio PAGE-level wiring here is for any client-side display logic that wants to show "You're viewing tier cutoffs of X/Y/Z (URL override active)" — and for the heat-map cells which are client-rendered.

**(C) Optional URL-param emit from FilterBar (for shareable links).**

In `src/components/analytics/filter-bar.tsx`, add a small "Threshold overrides" disclosure (collapsible) showing the active red/green/tier values, with a tiny "Clear overrides" link that strips those URL params. This is UX polish — if it complicates the implementation, defer to a follow-up plan; the URL-param consumption (A+B) is the SC3 requirement, the FilterBar UX is not.

**(D) Add Playwright spec at `tests/analytics-heat-map/url-overrides.spec.ts`:**

```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@heat-map ?redMax=200&greenMin=800 URL params shift colour cells", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map?redMax=200&greenMin=800");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The heat-map renders cells with data-color attributes (or inline style); we
  // assert the legend or threshold-display reflects the URL override (NOT the
  // saved 500/1500 default).
  // The exact selector depends on the heat-map page UI; the spec uses a generic
  // assertion that the page does not show the saved-default text.
  await expect(page.getByText(/red.*200|≤\s*200/i).first()).toBeVisible({ timeout: 10_000 });
});

test("@heat-map without URL params reads saved default thresholds", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Without URL params, the page should show the SAVED default (currently 500
  // assuming Task 2 restored to 80/50/20 + 500/1500 defaults at end of test).
  await expect(page.getByText(/red.*500|≤\s*500/i).first()).toBeVisible({ timeout: 10_000 });
});
```

If the heat-map page does not render a visible threshold legend, add a small `data-testid="threshold-legend"` element to the page that shows the active thresholds — this both helps the test and helps the user see "URL override is active".

**(E) Update `tasks/todo.md` lines 103 (6.2) and 107 (6.6):**

Change:
```
- [ ] **6.2** Threshold magic numbers (...) → settings table. (P2 — **deferred to follow-up PR**: ...)
- [ ] **6.6** Threshold editor: persist to URL params + write audit log on change. (P2 — **deferred to follow-up PR**: ...)
```
to:
```
- [x] **6.2** Threshold magic numbers (heat-map green/red + outlet-tier 80/50/20) → `appSettings` keys + admin UI at `/settings/thresholds`. Phase 6 plan 06-05 (PR #NN). Plateau ±10% deliberately deferred per CONTEXT D-06.
- [x] **6.6** Threshold editor: persist to URL params (`?redMax=`, `?greenMin=`, `?tierTop=`, `?tierMid=`, `?tierBottom=` — temp override only per D-09) + write audit log on save. Phase 6 plan 06-05 (PR #NN).
```

Per-plan summary commit on the plan's branch (`gsd/phase-06-thresholds-as-settings`): `feat(thresholds): outlet-tier cutoffs as appSettings + URL-param override + admin UI (SC3)`.
  </action>
  <verify>
    <automated>
grep -E "redMax: 500" src/app/\(app\)/analytics/heat-map/page.tsx src/app/\(app\)/analytics/portfolio/page.tsx ; test $? -ne 0 && npx playwright test tests/analytics-heat-map/url-overrides.spec.ts --reporter=list && npm run typecheck && grep -c '^- \[x\] \*\*6\.2\*\*\|^- \[x\] \*\*6\.6\*\*' tasks/todo.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "redMax: 500" src/app/\(app\)/analytics/heat-map/page.tsx` returns 0 (the hardcoded default is gone — replaced with `fetchThresholds` call).
    - `grep -c "redMax: 500" src/app/\(app\)/analytics/portfolio/page.tsx` returns 0.
    - `grep -c "fetchThresholds()\|fetchOutletTierThresholds()" src/app/\(app\)/analytics/heat-map/page.tsx` returns ≥ 2.
    - `grep -c "fetchThresholds()\|fetchOutletTierThresholds()" src/app/\(app\)/analytics/portfolio/page.tsx` returns ≥ 2.
    - `grep -c "searchParams.get(\"redMax\"\|searchParams.get(\"tierTop\"" src/app/\(app\)/analytics/heat-map/page.tsx` returns ≥ 2.
    - File `tests/analytics-heat-map/url-overrides.spec.ts` exists with ≥ 2 tests.
    - `npx playwright test tests/analytics-heat-map/url-overrides.spec.ts` exits 0.
    - `grep -c '^- \[x\] \*\*6\.2\*\*' tasks/todo.md` returns 1.
    - `grep -c '^- \[x\] \*\*6\.6\*\*' tasks/todo.md` returns 1.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Heat-map and portfolio pages now consume saved thresholds (no more silent 500/1500 defaults); URL params override per-session for what-if exploration; Playwright covers both the override path and the saved-default path; todo.md 6.2 and 6.6 ticked.
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0
- `npx vitest run --project unit src/lib/analytics/__tests__/` exits 0
- `npx playwright test tests/settings-thresholds tests/analytics-heat-map` exits 0
- After save: `SELECT * FROM app_settings WHERE key LIKE 'threshold_outlet_tier_%'` returns 3 rows
- After save: `SELECT * FROM audit_logs WHERE entity_id = 'outlet_tier_thresholds' ORDER BY created_at DESC LIMIT 1` returns 1 row with `field='outlet_tier_thresholds'`
- After URL `?redMax=200`: heat-map page renders with red threshold = 200 (not the saved default)
- `tasks/todo.md` lines 103 and 107 ticked
</verification>

<success_criteria>
1. SC3 — heat-map green/red AND outlet-tier 80/50/20 are editable from the admin UI at `/settings/thresholds`; saves persist to `appSettings`; audit-log entry per save; URL params provide temp-override for what-if exploration.
2. SC10 contribution — `tasks/todo.md` lines 103 (6.2) and 107 (6.6) ticked.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-05-SUMMARY.md`: file diff stats; appSettings rows added; audit-log entry shape; cache-tag invalidation chain; PR # + merge SHA.
</output>
