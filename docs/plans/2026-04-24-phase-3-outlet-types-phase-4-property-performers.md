# Phase 3 + 4 Implementation Plan — Outlet-Type Admin & Property-Level Performer Analytics

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship two features on branch `feat/netsuite-etl-data-model` before reopening PR #25: (Phase 3) an `/settings/outlet-types` admin page to classify the 290 unclassified prod outlets, and (Phase 4) property-level enhancements to the Top/Bottom performer tables showing kiosk count, revenue/kiosk, revenue/room, and total revenue per property.

**Architecture:**
- Phase 3 — new route `/settings/outlet-types`: server component page + client table island; server actions for list/set/bulk-set with audit log + `revalidateTag('analytics')`; suggested-type classifier mirrors `scripts/backfill-location-type.ts`.
- Phase 4 — tool becomes property-first: `OutletTierRow` grows with `hotelGroupName`, `kioskCount`, `revenuePerKiosk`, `revenuePerRoom`, `numRooms`; the `sharePercentage` column is dropped from the UI. Queries in `portfolio.ts` (tiers) and `heat-map.ts` (tiers) enrich their SELECTs. The hotel-group distribution table on the High/Low Performer Patterns card is removed.

**Tech Stack:** Next.js 15 App Router, React Server Components + client islands, Drizzle ORM, Neon Postgres, shadcn/ui + Tailwind, better-auth (session), Vitest + testcontainers (integration), Playwright (E2E).

**Scope note:** The HANDOFF's original Phase 4 ("roll up to hotel groups") is **replaced** by this property-level plan per the 2026-04-24 session. Hotel groups remain visible as a column but no longer drive grouping. Maturity age-bucket bug, commission-tier seeding, migrator upstream PR, and Vercel preview env binding stay deferred.

---

## Preconditions

- On branch `feat/netsuite-etl-data-model`, working tree clean apart from `HANDOFF.md` + `tasks/` (untracked)
- Dev DB `.env.neon-dev` populated; admin login `admin@weknow.co` / `NeonDevPhase0!Test`
- Docker daemon running (testcontainers needs it — already confirmed, `wkg-pg` container up)
- Don't run `npm install` on macOS (see repo CLAUDE.md). If lockfile drift appears, use the documented docker linux/amd64 regen.

---

# Phase 3 — `/settings/outlet-types`

## Task 3.1: Extract the classifier as a pure helper with unit tests

**Files:**
- Create: `src/lib/locations/suggest-location-type.ts`
- Create: `src/lib/locations/suggest-location-type.test.ts`
- Reference: `scripts/backfill-location-type.ts:27-122` (mirror rules exactly, first match wins)

**Step 1: Write failing tests**

```ts
// src/lib/locations/suggest-location-type.test.ts
import { describe, expect, test } from "vitest";
import { suggestLocationType } from "./suggest-location-type";

describe("suggestLocationType", () => {
  test("outlet_code 'IN' → online", () => {
    expect(suggestLocationType({ name: "Whatever", outletCode: "IN" })).toBe("online");
  });
  test("outlet_code 'BK' → retail_desk", () => {
    expect(suggestLocationType({ name: "Whatever", outletCode: "BK" })).toBe("retail_desk");
  });
  test("name starting 'Hex SSM ' → hex_kiosk", () => {
    expect(suggestLocationType({ name: "Hex SSM Heathrow T2", outletCode: "HX2" })).toBe("hex_kiosk");
  });
  test("Heathrow Terminal → airport", () => {
    expect(suggestLocationType({ name: "Heathrow Terminal 5", outletCode: "T5" })).toBe("airport");
  });
  test("Heathrow underground → airport", () => {
    expect(suggestLocationType({ name: "Heathrow underground POD", outletCode: "UG1" })).toBe("airport");
  });
  test("T_ Mobile → airport", () => {
    expect(suggestLocationType({ name: "T5 Mobile 01", outletCode: "M01" })).toBe("airport");
  });
  test("T_ Ambassador → airport", () => {
    expect(suggestLocationType({ name: "T3 Ambassador Suite", outletCode: "AMB" })).toBe("airport");
  });
  test("has hotel signals (numRooms) → hotel", () => {
    expect(suggestLocationType({ name: "Hilton Mayfair", outletCode: "HM", numRooms: 200 })).toBe("hotel");
  });
  test("has hotel signals (starRating) → hotel", () => {
    expect(suggestLocationType({ name: "Mandarin Oriental", outletCode: "MO", starRating: 5 })).toBe("hotel");
  });
  test("has hotel signals (hotelGroup) → hotel", () => {
    expect(suggestLocationType({ name: "Some Property", outletCode: "SP", hotelGroup: "Hilton" })).toBe("hotel");
  });
  test("no signals → null", () => {
    expect(suggestLocationType({ name: "Random Name", outletCode: "XYZ" })).toBeNull();
  });
  test("first match wins — IN outletCode beats Hex-named hotel", () => {
    expect(suggestLocationType({ name: "Hex SSM IN", outletCode: "IN" })).toBe("online");
  });
});
```

**Step 2: Run to verify failure**

`npx vitest run src/lib/locations/suggest-location-type.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement**

```ts
// src/lib/locations/suggest-location-type.ts
import type { LocationType } from "@/lib/analytics/types";

export type LocationSignals = {
  name: string;
  outletCode: string;
  hotelGroup?: string | null;
  numRooms?: number | null;
  starRating?: number | null;
};

export function suggestLocationType(loc: LocationSignals): LocationType | null {
  if (loc.outletCode === "IN") return "online";
  if (loc.outletCode === "BK") return "retail_desk";
  if (/^Hex SSM /i.test(loc.name)) return "hex_kiosk";
  if (
    /^Heathrow Terminal/i.test(loc.name) ||
    /^Heathrow underground/i.test(loc.name) ||
    /^T.\s?Mobile/i.test(loc.name) ||
    /^T.\s?Ambassador/i.test(loc.name)
  ) {
    return "airport";
  }
  if (loc.hotelGroup || loc.numRooms != null || loc.starRating != null) return "hotel";
  return null;
}
```

**Step 4: Run to verify pass**

`npx vitest run src/lib/locations/suggest-location-type.test.ts`
Expected: PASS (12 tests).

**Step 5: Commit**

```bash
git add src/lib/locations/suggest-location-type.ts src/lib/locations/suggest-location-type.test.ts
git commit -m "feat(locations): extract outlet-type classifier into pure helper"
```

---

## Task 3.2: Server actions — listUnclassifiedOutlets

**Files:**
- Create: `src/app/(app)/settings/outlet-types/actions.ts`
- Reference patterns: `src/app/(app)/settings/thresholds/actions.ts`, `src/lib/audit.ts:9-56`, `src/lib/rbac.ts:21-27`

**Step 1: Write failing integration test**

Create `tests/settings/outlet-types.integration.test.ts` following `tests/etl/azure-etl-full.integration.test.ts` shape (testcontainers Postgres + drizzle migrate + FK-ordered cleanup):

```ts
// tests/settings/outlet-types.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { setupTestDb, type TestDbCtx } from "../helpers/setup-test-db";
import { locations, auditLogs, salesRecords, regions } from "@/db/schema";
import { eq } from "drizzle-orm";
// Import server-action internals (actor-parameterised variants, mirror pipeline.ts split)
import {
  _listUnclassifiedOutletsForActor,
  _setLocationTypeForActor,
  _bulkSetLocationTypeForActor,
} from "@/app/(app)/settings/outlet-types/pipeline";

describe("outlet-types server actions", () => {
  let ctx: TestDbCtx;
  beforeAll(async () => { ctx = await setupTestDb(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => {
    await ctx.db.delete(auditLogs);
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
  });

  test("lists only NULL-type, non-archived outlets with suggestedType", async () => {
    // arrange: seed 3 locations — 1 classified, 1 archived, 1 NULL
    // act
    const rows = await _listUnclassifiedOutletsForActor(ctx.db);
    // assert: only the NULL row, with suggestedType set
  });

  test("setLocationType writes audit log + updates row", async () => {
    // arrange
    // act: call _setLocationTypeForActor
    // assert: location.location_type updated, audit row present with action='set_location_type'
  });

  test("bulkSetLocationType writes one audit row per location", async () => { /* ... */ });
});
```

**Step 2: Run to verify failure** (module not found)

`npx vitest run tests/settings/outlet-types.integration.test.ts`

**Step 3: Implement pipeline.ts + actions.ts (split per `src/app/(app)/settings/data-import/sales/pipeline.ts:1-26` convention — pipeline holds DB-touching logic parameterised on actor; actions.ts is the `"use server"` wrapper)**

```ts
// src/app/(app)/settings/outlet-types/pipeline.ts
// No "use server" directive — this file exports both async fns AND types;
// the `"use server"` shim lives in actions.ts.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { db as dbType } from "@/db";
import { auditLogs, locations, salesRecords } from "@/db/schema";
import { suggestLocationType } from "@/lib/locations/suggest-location-type";
import type { LocationType } from "@/lib/analytics/types";
import { writeAuditLog } from "@/lib/audit";

export type UnclassifiedOutletRow = {
  id: string;
  outletCode: string;
  name: string;
  last30dRevenue: number;
  last30dTransactions: number;
  suggestedType: LocationType | null;
};

export async function _listUnclassifiedOutletsForActor(
  db: typeof dbType,
): Promise<UnclassifiedOutletRow[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: locations.id,
      outletCode: locations.outletCode,
      name: locations.name,
      hotelGroup: locations.hotelGroup,
      numRooms: locations.numRooms,
      starRating: locations.starRating,
      revenue: sql<string>`COALESCE(SUM(${salesRecords.netAmount}), 0)`,
      transactions: sql<string>`COALESCE(COUNT(${salesRecords.id}), 0)`,
    })
    .from(locations)
    .leftJoin(
      salesRecords,
      and(
        eq(salesRecords.locationId, locations.id),
        gte(salesRecords.transactionDate, thirtyDaysAgo),
      ),
    )
    .where(and(isNull(locations.locationType), isNull(locations.archivedAt)))
    .groupBy(locations.id)
    .orderBy(desc(sql`COALESCE(SUM(${salesRecords.netAmount}), 0)`));

  return rows.map((r) => ({
    id: r.id,
    outletCode: r.outletCode,
    name: r.name,
    last30dRevenue: Number(r.revenue),
    last30dTransactions: Number(r.transactions),
    suggestedType: suggestLocationType({
      name: r.name,
      outletCode: r.outletCode,
      hotelGroup: r.hotelGroup,
      numRooms: r.numRooms,
      starRating: r.starRating,
    }),
  }));
}

export async function _setLocationTypeForActor(
  db: typeof dbType,
  actor: { id: string; name: string },
  locationId: string,
  type: LocationType,
) {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ locationType: locations.locationType, name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!before) throw new Error(`Location ${locationId} not found`);

    await tx
      .update(locations)
      .set({ locationType: type, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog(tx, {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "location",
      entityId: locationId,
      entityName: before.name,
      action: "set_location_type",
      field: "location_type",
      oldValue: before.locationType,
      newValue: type,
    });
  });
}

export async function _bulkSetLocationTypeForActor(
  db: typeof dbType,
  actor: { id: string; name: string },
  locationIds: string[],
  type: LocationType,
) {
  if (locationIds.length === 0) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: locations.id, name: locations.name, locationType: locations.locationType })
      .from(locations)
      .where(inArray(locations.id, locationIds));
    await tx
      .update(locations)
      .set({ locationType: type, updatedAt: new Date() })
      .where(inArray(locations.id, locationIds));
    for (const r of rows) {
      await writeAuditLog(tx, {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location",
        entityId: r.id,
        entityName: r.name,
        action: "set_location_type",
        field: "location_type",
        oldValue: r.locationType,
        newValue: type,
      });
    }
  });
}
```

```ts
// src/app/(app)/settings/outlet-types/actions.ts
"use server";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import type { LocationType } from "@/lib/analytics/types";
import {
  _listUnclassifiedOutletsForActor,
  _setLocationTypeForActor,
  _bulkSetLocationTypeForActor,
} from "./pipeline";

export async function listUnclassifiedOutletsAction() {
  await requireRole("admin");
  return _listUnclassifiedOutletsForActor(db);
}

export async function setLocationTypeAction(locationId: string, type: LocationType) {
  const session = await requireRole("admin");
  await _setLocationTypeForActor(db, { id: session.user.id, name: session.user.name ?? session.user.email }, locationId, type);
  revalidateTag("analytics");
}

export async function bulkSetLocationTypeAction(locationIds: string[], type: LocationType) {
  const session = await requireRole("admin");
  await _bulkSetLocationTypeForActor(db, { id: session.user.id, name: session.user.name ?? session.user.email }, locationIds, type);
  revalidateTag("analytics");
}
```

**Step 4: Flesh out integration tests** (fill in arrange/assert from the stubs), re-run. Expected: all three tests PASS.

**Step 5: Commit**

```bash
git add src/app/\(app\)/settings/outlet-types/ tests/settings/outlet-types.integration.test.ts
git commit -m "feat(settings): outlet-types server actions with audit log + analytics revalidation"
```

---

## Task 3.3: UI — page shell + client island table

**Files:**
- Create: `src/app/(app)/settings/outlet-types/page.tsx` (RSC)
- Create: `src/app/(app)/settings/outlet-types/outlet-types-table.tsx` (`"use client"`)
- Reference: `src/app/(app)/settings/data-import/sales/page.tsx` for chrome, `src/components/analytics/multi-select-filter.tsx` for Popover+Command dropdown primitives

**Step 1: RSC page shell**

```tsx
// page.tsx
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { _listUnclassifiedOutletsForActor } from "./pipeline";
import { db } from "@/db";
import { OutletTypesTable } from "./outlet-types-table";

export default async function OutletTypesPage() {
  await requireRole("admin");
  const rows = await _listUnclassifiedOutletsForActor(db);
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Outlet Types"
        description="Classify unclassified outlets so they appear in the Location Type filter across analytics."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <OutletTypesTable initialRows={rows} />
      </div>
    </div>
  );
}
```

**Step 2: Client island table** — columns: checkbox · outlet code · name · last-30d revenue · last-30d txns · suggested · dropdown · save (per-row); bulk toolbar `Apply <type> to selected` appears when ≥1 row selected; empty state "All outlets classified — nothing to do here" when `initialRows.length === 0`; on each server-action call, re-fetch via `router.refresh()` so newly-classified rows drop from the list.

Use `useTransition` around action calls; disable the row/bulk buttons while pending; optimistic toast via existing sonner setup (grep for `toast(` in `src/app/(app)/settings` to find the style in use).

**Step 3: Nav link** — add to `src/components/layout/app-sidebar.tsx:78-83` inside the admin-only `configure` array:
```ts
{ label: "Outlet Types", href: "/settings/outlet-types", icon: Tag },
```
Import `Tag` from `lucide-react`.

**Step 4: Smoke check (manual)** — boot dev, sign in as admin, navigate to `/settings/outlet-types`, verify table renders with the ~4 dev NULL rows and suggested types populated. Verify non-admin gets forbidden.

**Step 5: Commit**

```bash
git add src/app/\(app\)/settings/outlet-types/ src/components/layout/app-sidebar.tsx
git commit -m "feat(settings): outlet-types admin UI with bulk-classify toolbar"
```

---

## Task 3.4: Playwright E2E — classify one outlet and verify analytics filter picks it up

**Files:**
- Create: `tests/settings/outlet-types.spec.ts`
- Reference: `tests/smoke.spec.ts` for base Playwright pattern, `tests/fixtures/` for existing fixtures

**Step 1: Auth fixture** — if `tests/fixtures/auth.ts` doesn't already give you a signed-in admin page, add one (or inline `page.request.post('/api/auth/sign-in', …)` at the top of the spec).

**Step 2: Write the test**

```ts
// tests/settings/outlet-types.spec.ts
import { test, expect } from "@playwright/test";
// TODO: use existing admin-auth fixture if present

test("classify an outlet and see it in analytics filter", async ({ page }) => {
  // 1. Log in as admin (fixture or inline)
  await page.goto("/settings/outlet-types");
  await expect(page.getByRole("heading", { name: "Outlet Types" })).toBeVisible();

  // 2. Pick first row, set to 'airport'
  const firstRow = page.locator("tbody tr").first();
  const outletName = await firstRow.locator("td").nth(2).innerText();
  await firstRow.getByRole("button", { name: /set type/i }).click();
  await page.getByRole("option", { name: "airport" }).click();
  await firstRow.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText(/classified|updated/i)).toBeVisible();

  // 3. Jump to portfolio and confirm the location type filter shows the classification
  await page.goto("/analytics/portfolio");
  await page.getByRole("button", { name: /location type/i }).click();
  await expect(page.getByRole("option", { name: /airport/i })).toBeVisible();
});
```

**Step 3: Run**

`npx playwright test tests/settings/outlet-types.spec.ts --reporter=list`
Expected: PASS.

**Step 4: Commit**

```bash
git add tests/settings/outlet-types.spec.ts tests/fixtures/
git commit -m "test(settings): E2E for outlet-type classification → analytics filter roundtrip"
```

---

## Task 3.5: Phase 3 summary commit

Run full verification before the summary commit:
- `npx vitest run` (all unit + integration pass)
- `npx playwright test` (all E2E pass)
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm run lint`

Empty-commit (or stacked chore commit) summarising the phase:

```bash
git commit --allow-empty -m "feat(phase-3): outlet-type admin page for classifying 290 unclassified prod outlets

Ships /settings/outlet-types gated to admins with:
- server actions (list/set/bulk-set) with audit_log writes + analytics revalidation
- classifier heuristic extracted from scripts/backfill-location-type.ts
- bulk-classify toolbar for operators sorting 290 NULL outlets on prod
- Playwright E2E: classify outlet → verify it surfaces in the portfolio filter"
```

---

# Phase 4 — Property-level performer analytics

## Task 4.1: Extend `OutletTierRow` type and drop `sharePercentage` from UI

**Files:**
- Modify: `src/lib/analytics/types.ts:97-107`

**Step 1: Add fields**

```ts
export type OutletTierRow = {
  locationId: string;
  outletCode: string;
  hotelName: string;
  hotelGroupName: string | null;    // NEW — nice-to-have column
  liveDate: string | null;
  revenue: number;                   // total revenue (existing)
  transactions: number;
  kioskCount: number;                // NEW — active kiosks on this property
  numRooms: number | null;           // NEW — surfaced from locations.num_rooms
  revenuePerKiosk: number | null;    // NEW — null if kioskCount=0
  revenuePerRoom: number | null;     // NEW — null if numRooms is null/0
  percentile: number;
  sharePercentage: number;           // KEEP in type (for backwards-compat with any hidden callers), just not rendered
  tier: OutletTier;
};
```

**Step 2: Typecheck**

`npx tsc --noEmit` — expect red across call sites that construct `OutletTierRow`. That's the next tasks' work.

No commit yet — the type change + its consumers land together.

---

## Task 4.2: `getOutletTiers` in `portfolio.ts` — enrich query with kiosks + rooms + hotel group

**Files:**
- Modify: `src/lib/analytics/queries/portfolio.ts:~356` (the outlet-tier GROUP BY block)
- Reference: `src/lib/analytics/queries/high-performer-analysis.ts:186-198` for the active-kiosk subquery pattern

**Step 1: Extend the SELECT**

Join a correlated kiosk count and a canonical hotel-group name. Keep the query shape as a single SELECT with a LEFT JOIN (not a separate roundtrip) to preserve per-request caching.

Sketch of the SQL shape (Drizzle fragments):
```ts
const activeKiosksSubquery = sql`(
  SELECT COUNT(*)::int
  FROM ${kioskAssignments}
  WHERE ${kioskAssignments.locationId} = ${locations.id}
    AND ${kioskAssignments.unassignedAt} IS NULL
)`;

// Canonical hotel group: primary_hotel_group_id if set, else MIN(hotel_group_id) from memberships.
// Use a LATERAL subquery OR a LEFT JOIN on a CTE. Simplest: LEFT JOIN on
// (SELECT location_id, MIN(hotel_group_id) AS group_id FROM location_hotel_group_memberships GROUP BY location_id)
// and COALESCE with locations.operating_group_id (or primary_hotel_group_id if column exists).
```

Select additions: `${activeKiosksSubquery} AS kiosk_count`, `${locations.numRooms}::int AS num_rooms`, `hg.name AS hotel_group_name`. Keep the existing `GROUP BY locations.id, outletCode, name`; add `numRooms`, `hg.name` to the GROUP BY list.

**Step 2: Map to `OutletTierRow` in the query return**

Compute `revenuePerKiosk = kioskCount > 0 ? revenue / kioskCount : null` and `revenuePerRoom = numRooms && numRooms > 0 ? revenue / numRooms : null`.

**Step 3: Update / add unit test**

Grep for an existing `portfolio.test.ts` / `outlet-tiers.test.ts`. If none, add a narrow test fixture that seeds 2 locations (one with 3 kiosks + 100 rooms + 10k revenue → expect `revenuePerKiosk=3333.33`, `revenuePerRoom=100`; one with 0 kiosks + null rooms → `revenuePerKiosk=null`, `revenuePerRoom=null`).

**Step 4: Run**

`npx vitest run src/lib/analytics/queries/portfolio` (or the new test file path)
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/analytics/queries/portfolio.ts src/lib/analytics/types.ts
git commit -m "feat(analytics): enrich portfolio OutletTierRow with kiosk count + rooms + hotel group"
```

---

## Task 4.3: Same enrichment in `heat-map.ts`

**Files:**
- Modify: `src/lib/analytics/queries/heat-map.ts:117-175` (the `num_rooms` block already exists — add `kiosk_count`, `hotel_group_name`, derive `revenuePerKiosk`)

Mirror Task 4.2's pattern. Heat map already selects `num_rooms` and computes `revenuePerRoom` — so the delta is: add `kiosk_count` subquery, add hotel-group LEFT JOIN, derive `revenuePerKiosk`, include in the returned row shape.

Commit:
```bash
git add src/lib/analytics/queries/heat-map.ts
git commit -m "feat(analytics): surface kiosk count + revenue/kiosk on heat-map tier rows"
```

---

## Task 4.4: Remove hotel-group distribution from High/Low Performer Patterns card

**Files:**
- Modify: `src/lib/analytics/queries/high-performer-analysis.ts:159-170` (drop the `hotelGroupDistribution` SELECT)
- Modify: `src/lib/analytics/queries/high-performer-analysis.ts:220-224` (drop the `.hotelGroupDistribution` field from the returned object)
- Modify: `src/lib/analytics/types.ts` — drop `hotelGroupDistribution` from the `HighPerformerPatterns` type (and mirror type if one exists for low performers)
- Modify: `src/app/(app)/analytics/portfolio/high-performer-patterns.tsx:62-90` (remove the Hotel Group Distribution panel; keep Region Distribution + Top Products + KPIs)
- Modify: `src/app/(app)/analytics/portfolio/low-performer-patterns.tsx` (same)

**Step 1: Remove the parallel-fetch slot** — the `Promise.all([...])` at `high-performer-analysis.ts:157-217` drops from 4 queries to 3.

**Step 2: Update type + return shape** — TS will flag the downstream consumers.

**Step 3: Remove the UI panel** — the remaining card layout goes from `grid-cols-1 sm:grid-cols-2` (two distribution panels) to `grid-cols-1` with just Region Distribution.

**Step 4: Test** — `npx vitest run` + manual: load `/analytics/portfolio`, confirm no Hotel Group Distribution renders, Region Distribution still renders, KPIs + Top Products unchanged.

**Step 5: Commit**

```bash
git add src/lib/analytics/queries/high-performer-analysis.ts src/lib/analytics/types.ts src/app/\(app\)/analytics/portfolio/high-performer-patterns.tsx src/app/\(app\)/analytics/portfolio/low-performer-patterns.tsx
git commit -m "refactor(analytics): remove hotel-group distribution from performer patterns card

Hotel-group info moves to a per-property column on the Top/Bottom 20 tables.
The patterns card keeps region distribution + KPIs + top products — hotel-group
bucketing is no longer a primary analytics lens per the 2026-04-24 product call."
```

---

## Task 4.5: Render the new columns in `outlet-tiers.tsx`

**Files:**
- Modify: `src/app/(app)/analytics/portfolio/outlet-tiers.tsx`

**Step 1: Update the table header + body**

Columns (left to right): Outlet Code · Hotel · Hotel Group · Kiosks · Rooms · Total Revenue · Revenue / Kiosk · Revenue / Room · Tier badge

Drop the existing `sharePercentage` column from the rendered table.

Format money cells with `formatCurrency`; `revenuePerKiosk` / `revenuePerRoom` → `"—"` when null. Kiosk count → `formatNumber`. Hotel group → `row.hotelGroupName ?? "—"`.

**Step 2: Mode-aware labels** — "Total Revenue" / "Revenue / Kiosk" / "Revenue / Room" labels should use `useMetricLabel()` to swap to "Total Sales" / "Sales / Kiosk" / "Sales / Room" in Sales mode (per commit `e1cd993`).

**Step 3: Manual verify** — load `/analytics/portfolio`, toggle Sales↔Revenue, confirm labels + numbers reshape. Confirm Top 20 and Bottom 20 both render new columns.

**Step 4: Commit**

```bash
git add src/app/\(app\)/analytics/portfolio/outlet-tiers.tsx
git commit -m "feat(analytics): property-level columns on OutletTiers — kiosk count, rev/kiosk, rev/room"
```

---

## Task 4.6: Heat Map table — render the same new columns

**Files:**
- Modify: `src/app/(app)/analytics/heat-map/page.tsx` (or the table component it delegates to)

Same column set as 4.5. Commit:

```bash
git add src/app/\(app\)/analytics/heat-map/
git commit -m "feat(analytics): property-level columns on heat-map tiers"
```

---

## Task 4.7: Playwright E2E — property metrics roundtrip

**Files:**
- Create: `tests/analytics/portfolio-performers.spec.ts`

Asserts on `/analytics/portfolio`:
- Top 20 table has a "Kiosks" column header, a "Revenue / Kiosk" column, a "Revenue / Room" column
- At least one data row has a numeric kiosk count and a currency-formatted revenue/kiosk
- No "Hotel Group Distribution" heading in the High Performer Patterns card
- Toggling Sales→Revenue changes the column label and at least one cell's value

Run + commit:
```bash
npx playwright test tests/analytics/portfolio-performers.spec.ts
git add tests/analytics/portfolio-performers.spec.ts
git commit -m "test(analytics): E2E for property-level Top/Bottom performer columns"
```

---

## Task 4.8: Phase 4 summary commit

Run full verification:
- `npx vitest run`
- `npx playwright test`
- `npm run typecheck`
- `npm run lint`

```bash
git commit --allow-empty -m "feat(phase-4): property-first performer analytics

Reshapes the Top/Bottom performer tables (portfolio + heat map) around the
per-property lens:
- new columns: Kiosks, Rooms, Revenue / Kiosk, Revenue / Room, Hotel Group
- removed the share-% column (raw totals are more useful than group-share)
- removed Hotel Group Distribution from the patterns card — hotel-group
  roll-up is no longer a primary analytics dimension

Hotel-group context stays visible as a column on each row, but the tool's
centre of gravity is now individual hotel performance, including multi-kiosk
normalisation via revenue/kiosk."
```

---

# Final — PR reopen

**Task F.1: Reopen PR #25 with a phase-3+4 comment**

```bash
gh pr reopen 25
gh pr comment 25 --body "Phase 3 (outlet-type admin page) + Phase 4 (property-level performer analytics, supersedes the earlier hotel-group roll-up direction) are now in. Ready for review."
```

---

# Deferred (explicitly out of scope for this plan)

- Maturity age-bucket fix (`src/app/(app)/analytics/maturity/page.tsx` — uses `today` instead of selected end date)
- Drizzle migrator upstream PR (sort by `folderMillis`)
- Prod `commission_tiers` seeding
- Vercel preview env binding
- Azure Blob Storage ETL source (separate branch)

---

# Risk log

1. **Canonical hotel-group tie-break on multi-membership** — using `MIN(hotel_group_id)` is deterministic but arbitrary. If a location belongs to two groups, the column shows one; this is acceptable for a nice-to-have column. Document the rule in `src/lib/analytics/queries/shared.ts` (add a 2-line JSDoc on the helper).
2. **Next.js `unstable_cache` 24h TTL** — after query changes, dev server must be restarted with `rm -rf .next/cache` to see fresh rows. Noted in HANDOFF.md.
3. **Testcontainers flake** — if CI-style integration tests run locally, docker daemon must be up. Confirmed up at plan-write time.
4. **Lockfile drift** — don't run `npm install` on macOS for any reason during this plan. If a dep change is needed, use the docker linux/amd64 regen per repo CLAUDE.md.
