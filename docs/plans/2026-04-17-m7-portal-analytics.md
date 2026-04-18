# M7 — Portal Layout & Scoped Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give external users a scoped, read-only analytics portal with 5 analytics pages, a portal-specific sidebar, and dimension-filtered filter bar — reusing existing analytics components and query infrastructure.

**Architecture:** Portal pages re-export internal page components (they're client components whose server actions already enforce scoping via `scopedSalesCondition(userCtx)`). The portal has its own layout with a simplified sidebar and its own analytics layout with a scoped filter bar. Only one new server action is needed: `getScopedDimensionOptions()`.

**Tech Stack:** Next.js 15, React, Drizzle ORM, better-auth, shadcn/ui, Playwright, Vitest

---

## Task 1: Extract shared `getUserCtx` helper

**Files:**
- Create: `src/lib/auth/get-user-ctx.ts`

**Step 1: Create the helper**

```typescript
// src/lib/auth/get-user-ctx.ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { UserCtx } from "@/lib/scoping/scoped-query";

export async function getUserCtx(): Promise<UserCtx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  return {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as "admin" | "member" | "viewer" | null,
  };
}
```

**Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/lib/auth/get-user-ctx.ts
git commit -m "feat(auth): extract shared getUserCtx helper for portal actions"
```

---

## Task 2: Create `PortalSidebar` component

**Files:**
- Create: `src/components/layout/portal-sidebar.tsx`
- Reference: `src/components/layout/app-sidebar.tsx` (internal sidebar pattern)

**Step 1: Create the portal sidebar**

Same visual style as `AppSidebar` but with only 5 analytics nav items (no entity/admin items). Nav items use `/portal/analytics/*` paths:

| Title | Path | Icon |
|-------|------|------|
| Portfolio | `/portal/analytics/portfolio` | `BarChart3` |
| Heat Map | `/portal/analytics/heat-map` | `Grid3X3` |
| Trend Builder | `/portal/analytics/trend-builder` | `TrendingUp` |
| Hotel Groups | `/portal/analytics/hotel-groups` | `Building2` |
| Regions | `/portal/analytics/regions` | `Globe` |

- Use the same shadcn `Sidebar*` components and WeKnow brand styling (dark bg, cyan active state `#00A6D3`)
- Header: "WK" logo text + `SidebarTrigger`
- Footer: user avatar, name, role badge, sign-out button (same pattern as `AppSidebar`)
- Props: `{ user?: { name: string; email: string; role: string } }`
- No admin settings section, no entity items

**Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/components/layout/portal-sidebar.tsx
git commit -m "feat(portal): add PortalSidebar with analytics-only nav"
```

---

## Task 3: Create portal layout

**Files:**
- Create: `src/app/portal/layout.tsx`
- Reference: `src/app/(app)/layout.tsx` (internal layout pattern)

**Step 1: Create the portal layout**

Server component that:
1. Checks auth session — redirects to `/login` if no session
2. Renders `SidebarProvider` + `PortalSidebar` + `<main>{children}</main>`
3. Same structure as the internal `(app)/layout.tsx`

```typescript
// src/app/portal/layout.tsx
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PortalSidebar } from "@/components/layout/portal-sidebar";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  return (
    <div className="h-dvh">
      <SidebarProvider>
        <PortalSidebar
          user={{
            name: session.user.name,
            email: session.user.email,
            role: (session.user.role as string) || "viewer",
          }}
        />
        <main className="flex-1 bg-white">{children}</main>
      </SidebarProvider>
    </div>
  );
}
```

**Step 2: Create portal index redirect**

Create `src/app/portal/page.tsx` that redirects to the default analytics page:

```typescript
// src/app/portal/page.tsx
import { redirect } from "next/navigation";
export default function PortalIndexPage() {
  redirect("/portal/analytics/portfolio");
}
```

**Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/app/portal/layout.tsx src/app/portal/page.tsx
git commit -m "feat(portal): add portal layout with sidebar and index redirect"
```

---

## Task 4: Modify `AnalyticsFilterBar` to accept custom dimension fetcher

**Files:**
- Modify: `src/components/analytics/filter-bar.tsx`

**Step 1: Add `fetchOptions` prop with default**

Change the component signature to accept an optional fetcher:

```typescript
export function AnalyticsFilterBar({
  fetchOptions = getDimensionOptions,
}: {
  fetchOptions?: () => Promise<DimensionOptions>;
} = {}) {
```

In the `useEffect`, replace `getDimensionOptions()` with `fetchOptions()`:

```typescript
useEffect(() => {
  startTransition(async () => {
    const opts = await fetchOptions();
    setOptions(opts);
  });
}, [fetchOptions]);
```

Add `fetchOptions` to the deps array.

**Step 2: Verify existing analytics pages still work**

Run: `npx tsc --noEmit`
Expected: Clean (existing pages don't pass the prop, so default is used)

**Step 3: Commit**

```bash
git add src/components/analytics/filter-bar.tsx
git commit -m "feat(analytics): make filter bar accept custom dimension fetcher"
```

---

## Task 5: Create `getScopedDimensionOptions` server action

**Files:**
- Create: `src/app/portal/analytics/actions.ts`

**Step 1: Write a unit test**

Create `src/app/portal/analytics/actions.test.ts`:

```typescript
import { describe, test, expect, vi } from "vitest";
// Test the scoping logic of getScopedDimensionOptions
// by mocking the DB calls and verifying dimension filtering.
```

The test should verify:
- User scoped to `hotel_group=A` → hotelGroups filtered to [A], locations filtered to those in A
- User scoped to `region=R1` → regions filtered to [R1], locations filtered to those in R1
- User scoped to `location=L1` → locations filtered to [L1]
- Products are always returned unfiltered (product scoping is query-level only)

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/portal/analytics/actions.test.ts`
Expected: FAIL

**Step 3: Implement the action**

```typescript
// src/app/portal/analytics/actions.ts
"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  locations, products, hotelGroups, regions, locationGroups,
  userScopes, locationHotelGroupMemberships,
  locationRegionMemberships, locationGroupMemberships,
} from "@/db/schema";
import type { DimensionOptions } from "@/lib/analytics/types";

export async function getScopedDimensionOptions(): Promise<DimensionOptions> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  const userId = session.user.id;

  // Get user scopes
  const scopes = await db
    .select({ dimensionType: userScopes.dimensionType, dimensionId: userScopes.dimensionId })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));

  // Expand scopes to a set of allowed location IDs
  const allowedLocationIds = await expandToLocationIds(scopes);

  // Fetch all base dimension data
  const [allLocs, allProds, allHGroups, allRegs, allLGroups] = await Promise.all([
    db.select({ id: locations.id, name: locations.name, outletCode: locations.outletCode })
      .from(locations).where(isNull(locations.archivedAt)),
    db.select({ id: products.id, name: products.name }).from(products),
    db.select({ id: hotelGroups.id, name: hotelGroups.name }).from(hotelGroups),
    db.select({ id: regions.id, name: regions.name }).from(regions),
    db.select({ id: locationGroups.id, name: locationGroups.name }).from(locationGroups),
  ]);

  // If no location restriction (shouldn't happen for external users, but defensive)
  if (allowedLocationIds === null) {
    // Return all — same as getDimensionOptions()
    return formatOptions(allLocs, allProds, allHGroups, allRegs, allLGroups);
  }

  // Filter locations
  const filteredLocs = allLocs.filter(l => allowedLocationIds.has(l.id));
  
  // Filter groups to those containing at least one allowed location
  const [hgMemberships, regMemberships, lgMemberships] = await Promise.all([
    allowedLocationIds.size > 0
      ? db.select({ hotelGroupId: locationHotelGroupMemberships.hotelGroupId })
          .from(locationHotelGroupMemberships)
          .where(inArray(locationHotelGroupMemberships.locationId, [...allowedLocationIds]))
      : [],
    allowedLocationIds.size > 0
      ? db.select({ regionId: locationRegionMemberships.regionId })
          .from(locationRegionMemberships)
          .where(inArray(locationRegionMemberships.locationId, [...allowedLocationIds]))
      : [],
    allowedLocationIds.size > 0
      ? db.select({ locationGroupId: locationGroupMemberships.locationGroupId })
          .from(locationGroupMemberships)
          .where(inArray(locationGroupMemberships.locationId, [...allowedLocationIds]))
      : [],
  ]);

  const allowedHgIds = new Set(hgMemberships.map(m => m.hotelGroupId));
  const allowedRegIds = new Set(regMemberships.map(m => m.regionId));
  const allowedLgIds = new Set(lgMemberships.map(m => m.locationGroupId));

  return formatOptions(
    filteredLocs,
    allProds, // products always unfiltered
    allHGroups.filter(g => allowedHgIds.has(g.id)),
    allRegs.filter(r => allowedRegIds.has(r.id)),
    allLGroups.filter(g => allowedLgIds.has(g.id)),
  );
}

// Expand all scope types to a set of allowed location IDs (union semantics)
async function expandToLocationIds(
  scopes: { dimensionType: string; dimensionId: string }[]
): Promise<Set<string> | null> {
  if (scopes.length === 0) return null;

  const locationIds = new Set<string>();

  const directLocScopes = scopes.filter(s => s.dimensionType === "location");
  for (const s of directLocScopes) locationIds.add(s.dimensionId);

  const hgIds = scopes.filter(s => s.dimensionType === "hotel_group").map(s => s.dimensionId);
  const regIds = scopes.filter(s => s.dimensionType === "region").map(s => s.dimensionId);
  const lgIds = scopes.filter(s => s.dimensionType === "location_group").map(s => s.dimensionId);

  const expansions = await Promise.all([
    hgIds.length > 0
      ? db.select({ locationId: locationHotelGroupMemberships.locationId })
          .from(locationHotelGroupMemberships)
          .where(inArray(locationHotelGroupMemberships.hotelGroupId, hgIds))
      : [],
    regIds.length > 0
      ? db.select({ locationId: locationRegionMemberships.locationId })
          .from(locationRegionMemberships)
          .where(inArray(locationRegionMemberships.regionId, regIds))
      : [],
    lgIds.length > 0
      ? db.select({ locationId: locationGroupMemberships.locationId })
          .from(locationGroupMemberships)
          .where(inArray(locationGroupMemberships.locationGroupId, lgIds))
      : [],
  ]);

  for (const rows of expansions) {
    for (const row of rows) locationIds.add(row.locationId);
  }

  // product/provider scopes don't restrict locations
  return locationIds;
}

function formatOptions(
  locs: { id: string; name: string | null; outletCode: string | null }[],
  prods: { id: string; name: string }[],
  hGroups: { id: string; name: string }[],
  regs: { id: string; name: string }[],
  lGroups: { id: string; name: string }[],
): DimensionOptions {
  return {
    locations: locs.map(l => ({ id: l.id, name: l.name ?? l.outletCode ?? l.id, outletCode: l.outletCode ?? "" })),
    products: prods.map(p => ({ id: p.id, name: p.name, category: null })),
    hotelGroups: hGroups.map(g => ({ id: g.id, name: g.name })),
    regions: regs.map(r => ({ id: r.id, name: r.name })),
    locationGroups: lGroups.map(g => ({ id: g.id, name: g.name })),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/portal/analytics/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/portal/analytics/actions.ts src/app/portal/analytics/actions.test.ts
git commit -m "feat(portal): add getScopedDimensionOptions for scoped filter bar"
```

---

## Task 6: Create portal analytics layout

**Files:**
- Create: `src/app/portal/analytics/layout.tsx`
- Reference: `src/app/(app)/analytics/layout.tsx` (internal analytics layout)

**Step 1: Create the layout**

Same as internal analytics layout but:
- No `ImpersonationBanner`
- Pass `getScopedDimensionOptions` as `fetchOptions` to `AnalyticsFilterBar`

```typescript
// src/app/portal/analytics/layout.tsx
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { getScopedDimensionOptions } from "./actions";

export default function PortalAnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilterBar fetchOptions={getScopedDimensionOptions} />
      {children}
    </div>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/portal/analytics/layout.tsx
git commit -m "feat(portal): add portal analytics layout with scoped filter bar"
```

---

## Task 7: Create 5 portal analytics page re-exports

**Files:**
- Create: `src/app/portal/analytics/portfolio/page.tsx`
- Create: `src/app/portal/analytics/heat-map/page.tsx`
- Create: `src/app/portal/analytics/trend-builder/page.tsx`
- Create: `src/app/portal/analytics/hotel-groups/page.tsx`
- Create: `src/app/portal/analytics/regions/page.tsx`

**Step 1: Create all 5 page re-exports**

Each file is a single line that re-exports the internal page component:

```typescript
// src/app/portal/analytics/portfolio/page.tsx
export { default } from "@/app/(app)/analytics/portfolio/page";
```

```typescript
// src/app/portal/analytics/heat-map/page.tsx
export { default } from "@/app/(app)/analytics/heat-map/page";
```

```typescript
// src/app/portal/analytics/trend-builder/page.tsx
export { default } from "@/app/(app)/analytics/trend-builder/page";
```

```typescript
// src/app/portal/analytics/hotel-groups/page.tsx
export { default } from "@/app/(app)/analytics/hotel-groups/page";
```

```typescript
// src/app/portal/analytics/regions/page.tsx
export { default } from "@/app/(app)/analytics/regions/page";
```

**Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/portal/analytics/
git commit -m "feat(portal): add 5 portal analytics pages as re-exports"
```

---

## Task 8: Hide business events for external users

**Files:**
- Modify: `src/app/(app)/analytics/trend-builder/actions.ts`

**Step 1: Modify `fetchBusinessEvents` to return empty for external users**

In `fetchBusinessEvents`, check `userCtx.userType` and return `[]` for external users:

```typescript
export async function fetchBusinessEvents(
  dateFrom: string,
  dateTo: string,
): Promise<BusinessEventDisplay[]> {
  const userCtx = await getUserCtx();
  if (userCtx.userType === "external") return [];
  return getBusinessEvents(dateFrom, dateTo);
}
```

**Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/(app)/analytics/trend-builder/actions.ts
git commit -m "fix(analytics): hide business events from external users"
```

---

## Task 9: Update middleware redirects

**Files:**
- Modify: `src/proxy.ts`

**Step 1: Update post-login redirect for external users**

Change the auth route redirect logic:
- External users on auth routes → redirect to `/portal/analytics/portfolio`
- Internal users on auth routes → redirect to `/kiosks` (existing)

```typescript
if (session && isAuthRoute) {
  const userType = (session.user as { userType?: string }).userType;
  const target = userType === "external" ? "/portal/analytics/portfolio" : "/kiosks";
  return NextResponse.redirect(new URL(target, request.url));
}
```

**Step 2: Update external user gating redirect**

Change gating redirect from `/portal/coming-soon` to `/portal/analytics/portfolio`:

```typescript
if (shouldGateExternalUser("external", p)) {
  return NextResponse.redirect(new URL("/portal/analytics/portfolio", request.url));
}
```

**Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(portal): update middleware redirects for live portal"
```

---

## Task 10: Enable scoping enforcement tests

**Files:**
- Modify: `tests/scoping/scoping-enforcement.spec.ts`
- Reference: `tests/scoping/external-user-redirect.spec.ts` (existing pattern)

**Step 1: Implement real test cases**

Replace the skipped test stubs with real implementations following the `external-user-redirect.spec.ts` pattern:

1. **Setup helper**: Seed test users with specific scopes (reuse `ensureExternalTestUser` pattern from redirect spec, but with real hotel_group IDs from seeded data)
2. **Admin sees all**: Sign in as admin, go to `/analytics/portfolio`, verify data from multiple hotel groups
3. **External scoped to hotel_group=A**: Sign in as scoped external user, go to `/portal/analytics/portfolio`, verify only HG-A data visible
4. **External with zero scopes**: Verify the user sees an error or empty state (not silent empty — scopedSalesCondition throws for external users with 0 scopes)

Test seeding must use real hotel_group IDs from the demo seed. Check which hotel groups exist in the seeded data.

**Step 2: Run tests**

Run: `npx playwright test tests/scoping/scoping-enforcement.spec.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/scoping/scoping-enforcement.spec.ts
git commit -m "test(scoping): enable scoping enforcement tests with real implementations"
```

---

## Task 11: Portal E2E tests

**Files:**
- Create: `tests/portal/portal-analytics.spec.ts`

**Step 1: Write E2E tests**

Test scenarios:
1. **External user sees portal layout**: Sign in as external user → lands on `/portal/analytics/portfolio` → portal sidebar visible with 5 items → no internal nav items (kiosks, locations, etc.)
2. **External user can navigate portal pages**: Click through all 5 analytics pages in the portal sidebar → each loads without error
3. **External user cannot access internal routes**: Navigate to `/kiosks` → redirected to portal
4. **Scoped filter bar**: Verify dimension options are filtered to user's scopes (hotel groups dropdown shows only scoped groups)
5. **External user can sign out**: Click sign out → redirected to `/login`

Follow the `external-user-redirect.spec.ts` pattern for user seeding and auth.

**Step 2: Run tests**

Run: `npx playwright test tests/portal/portal-analytics.spec.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/portal/portal-analytics.spec.ts
git commit -m "test(portal): add E2E tests for portal analytics pages"
```

---

## Task 12: Full verification

**Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 2: Run unit tests**

Run: `npx vitest run`
Expected: All pass (235+ existing + new)

**Step 3: Run E2E tests**

Run: `npx playwright test`
Expected: All pass (124+ existing + new portal + scoping enforcement)

**Step 4: Manual smoke test**

Start dev server (`npm run dev`), sign in as the seeded external user, verify:
- Portal layout renders with correct sidebar
- Portfolio page loads with scoped data
- Filter bar shows only scoped dimensions
- Cannot navigate to internal routes

**Step 5: Commit summary**

```bash
git commit --allow-empty -m "feat(portal): complete M7 — portal layout + 5 scoped analytics pages

Portal shell with simplified sidebar, 5 analytics pages (portfolio, heat-map,
trend-builder, hotel-groups, regions), scoped dimension filter bar, middleware
redirects, and comprehensive E2E coverage."
```

---

## Key Architectural Decisions

1. **Portal pages re-export internal page components** — zero duplication. The internal page components already import their own server actions which apply `scopedSalesCondition(userCtx)`. The external user's scopes are enforced at the query layer regardless of which route renders the page.

2. **Single new server action** — only `getScopedDimensionOptions()` is new. All data-fetching actions are reused from internal pages.

3. **Filter bar accepts custom fetcher** — minimal change to shared component. Internal pages use default (all dimensions), portal uses scoped version.

4. **Business events hidden at action level** — `fetchBusinessEvents` returns `[]` for external users. Security-correct regardless of route.

5. **Middleware redirects updated** — external users go directly to portal after login, not via double redirect through `/kiosks`.
