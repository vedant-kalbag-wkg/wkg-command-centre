# M9 — Admin QA Tooling & Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give admins a "Preview as" button to see what any user sees (impersonation), add impersonation support to the portal, and enhance the audit dashboard with userType filtering.

**Architecture:** The existing impersonation infrastructure (cookies, banner, audit logging) is fully built — M9 wires it into the UI. The shared `getUserCtx()` helper gains impersonation cookie awareness, so any analytics action using it returns the impersonated user's context. Internal analytics actions adopt this helper, making portal page re-exports automatically impersonation-aware. The user table gets a "Preview as" dropdown item that starts impersonation and redirects to the correct layout.

**Tech Stack:** Next.js 15, React, better-auth, Drizzle ORM, shadcn/ui, Playwright

---

## Task 1: Add impersonation support to getUserCtx

**Files:**
- Modify: `src/lib/auth/get-user-ctx.ts`

**What to change:**

The current helper extracts userCtx from the session. Add impersonation cookie checking so that when an admin is impersonating, the helper returns the **impersonated user's** context instead.

```typescript
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import type { UserCtx } from "@/lib/scoping/scoped-query";

export async function getUserCtx(): Promise<UserCtx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  // If admin is impersonating, return the impersonated user's context
  const cookieStore = await cookies();
  const impersonatingId = cookieStore.get("impersonating_user_id")?.value;

  if (impersonatingId && (session.user.role as string) === "admin") {
    const { db } = await import("@/db");
    const { user } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [target] = await db
      .select({ id: user.id, userType: user.userType, role: user.role })
      .from(user)
      .where(eq(user.id, impersonatingId))
      .limit(1);

    if (target) {
      return {
        id: target.id,
        userType: (target.userType ?? "internal") as "internal" | "external",
        role: (target.role ?? null) as "admin" | "member" | "viewer" | null,
      };
    }
  }

  return {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as "admin" | "member" | "viewer" | null,
  };
}
```

**Step 1:** Update the file.
**Step 2:** Verify typecheck: `npx tsc --noEmit`
**Step 3:** Commit: `feat(auth): add impersonation support to getUserCtx helper`

---

## Task 2: Adopt getUserCtx in analytics actions

**Files:**
- Modify: `src/app/(app)/analytics/portfolio/actions.ts`
- Modify: `src/app/(app)/analytics/heat-map/actions.ts`
- Modify: `src/app/(app)/analytics/hotel-groups/actions.ts`
- Modify: `src/app/(app)/analytics/regions/actions.ts`
- Modify: `src/app/(app)/analytics/trend-builder/actions.ts`
- Modify: `src/app/portal/analytics/actions.ts`

**What to change in each internal analytics action:**

Each file currently has an inline userCtx extraction pattern like:
```typescript
const session = await auth.api.getSession({ headers: await headers() });
if (!session?.user) throw new Error("Not authenticated");
const userCtx = {
  id: session.user.id,
  userType: ...,
  role: ...,
};
```

Replace with:
```typescript
import { getUserCtx } from "@/lib/auth/get-user-ctx";

// In each function:
const userCtx = await getUserCtx();
```

Remove the now-unused `auth`, `headers` imports from each file (unless used elsewhere in the file).

**For trend-builder/actions.ts:** It already has a local `getUserCtx()` function. Replace it with the imported one. Keep the `fetchBusinessEvents` external-user check (which uses `userCtx.userType`).

**For portal/analytics/actions.ts (getScopedDimensionOptions):** Currently looks up `session.user.id` to find scopes. Change to use `getUserCtx()` so impersonation is honored:
```typescript
const userCtx = await getUserCtx();
const userId = userCtx.id;
```

This means when admin impersonates an external user, the portal filter bar shows that user's scoped dimensions.

**Step 1:** Update all 6 files.
**Step 2:** Verify typecheck: `npx tsc --noEmit`
**Step 3:** Run tests: `npx vitest run`
**Step 4:** Commit: `refactor(analytics): adopt shared getUserCtx with impersonation support`

---

## Task 3: Add "Preview as" to user table dropdown

**Files:**
- Modify: `src/components/admin/user-table.tsx`

**What to change:**

1. Import `startImpersonation` and `useRouter`:
```typescript
import { startImpersonation } from "@/app/(app)/settings/users/impersonation-actions";
import { useRouter } from "next/navigation";
```

2. Add router in the component:
```typescript
const router = useRouter();
```

3. Add a handler function:
```typescript
async function handlePreviewAs(targetUser: UserListItem) {
  const result = await startImpersonation(targetUser.id);
  if (result.success) {
    // Look up userType to determine redirect target
    // For now, check if user has external-related role or just redirect to analytics
    toast.success(`Previewing as ${targetUser.name || targetUser.email}`);
    router.push("/analytics/portfolio");
  } else {
    toast.error(result.error ?? "Failed to start preview");
  }
}
```

Note: We redirect to `/analytics/portfolio` (internal analytics). The impersonation banner will show, and the data will be scoped. If the admin wants to see the portal view, they can navigate to `/portal/analytics/portfolio` manually — the middleware allows admins on portal routes.

4. Add "Preview as" menu item in the dropdown, AFTER "Manage scopes" and BEFORE the deactivate/reactivate item. Only show for non-admin, non-banned, non-self users:

```tsx
{!user.banned && user.role !== "admin" && user.id !== currentUserId && (
  <DropdownMenuItem
    onClick={() => handlePreviewAs(user)}
  >
    Preview as
  </DropdownMenuItem>
)}
```

The component needs access to `currentUserId`. Check if the `UserTable` component receives the current user's ID as a prop. If not, add it.

**Step 1:** Add the "Preview as" menu item.
**Step 2:** Verify typecheck.
**Step 3:** Commit: `feat(admin): add "Preview as" button to user table for impersonation`

---

## Task 4: Portal impersonation banner

**Files:**
- Modify: `src/app/portal/analytics/layout.tsx`

**What to change:**

Add impersonation banner to the portal analytics layout, same pattern as the internal analytics layout (`src/app/(app)/analytics/layout.tsx`):

```typescript
import { cookies } from "next/headers";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { ImpersonationBanner } from "@/components/analytics/impersonation-banner";
import { getScopedDimensionOptions } from "./actions";

export default async function PortalAnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const impersonatingUserId = cookieStore.get("impersonating_user_id")?.value;
  const impersonatingUserName = cookieStore.get("impersonating_user_name")?.value;

  return (
    <div className="flex flex-col gap-6">
      {impersonatingUserId && impersonatingUserName && (
        <ImpersonationBanner userName={impersonatingUserName} />
      )}
      <AnalyticsFilterBar fetchOptions={getScopedDimensionOptions} />
      {children}
    </div>
  );
}
```

Note: This layout must become `async` to use `cookies()`.

**Step 1:** Update the layout.
**Step 2:** Verify typecheck.
**Step 3:** Commit: `feat(portal): add impersonation banner to portal analytics layout`

---

## Task 5: Audit dashboard userType filter

**Files:**
- Modify: `src/app/(app)/settings/audit-log/actions.ts`
- Modify: `src/components/audit/audit-table.tsx`

**What to change in actions.ts:**

Add optional `actorUserType` filter to `FetchAuditEntriesParams`:
```typescript
export type FetchAuditEntriesParams = {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorUserType?: "internal" | "external";
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
};
```

In the `fetchAuditEntries` function, when `actorUserType` is provided, join with the `user` table to filter by userType:
```typescript
if (actorUserType) {
  // Subquery: find user IDs matching the userType
  conditions.push(
    sql`${auditLogs.actorId} IN (
      SELECT ${user.id} FROM ${user} WHERE ${user.userType} = ${actorUserType}
    )`
  );
}
```

Import `sql` from drizzle-orm and `user` from `@/db/schema`.

**What to change in audit-table.tsx:**

Add a "User Type" filter select alongside the existing filters (User, Entity Type, Date):
```tsx
<div className="grid gap-1.5">
  <Label htmlFor="filter-user-type">User Type</Label>
  <Select
    value={filters.actorUserType ?? "all"}
    onValueChange={(val) => setFilters(prev => ({ ...prev, actorUserType: val === "all" ? undefined : val }))}
  >
    <SelectTrigger id="filter-user-type"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All</SelectItem>
      <SelectItem value="internal">Internal</SelectItem>
      <SelectItem value="external">External</SelectItem>
    </SelectContent>
  </Select>
</div>
```

Add `actorUserType` to the `FilterState` type and pass it to `fetchAuditEntries()`.

**Step 1:** Update actions.ts with the filter.
**Step 2:** Update audit-table.tsx with the UI.
**Step 3:** Verify typecheck.
**Step 4:** Commit: `feat(audit): add userType filter to audit dashboard`

---

## Task 6: E2E tests for impersonation

**Files:**
- Create: `tests/admin/impersonation.spec.ts`

**Test cases:**

1. **"admin can start impersonation from user table"**
   - Sign in as admin, go to /settings/users
   - Find a non-admin user row, click Actions → Preview as
   - Verify toast "Previewing as ..."
   - Verify impersonation banner appears on analytics page

2. **"impersonation banner shows exit button"**
   - Start impersonation (from test 1)
   - Verify banner text "Viewing as: {name}"
   - Click Exit → banner disappears

3. **"impersonation scopes analytics data"**
   - Create an external user with hotel_group scope (reuse ensureUser pattern)
   - Start impersonation of that user
   - Navigate to /portal/analytics/portfolio
   - Verify banner shows
   - Verify page loads (heading visible)
   - Exit impersonation

**Step 1:** Write the tests.
**Step 2:** Run: `npx playwright test tests/admin/impersonation.spec.ts`
**Step 3:** Commit: `test(admin): add E2E tests for impersonation flow`

---

## Task 7: Full verification

**Step 1:** Typecheck: `npx tsc --noEmit`
**Step 2:** Unit tests: `npx vitest run`
**Step 3:** E2E tests: `npx playwright test`
**Step 4:** Manual smoke test:
- Sign in as admin → Users → find external user → Preview as
- Verify banner + scoped data on portal analytics
- Exit preview → back to admin view with full data
- Audit log → filter by External → see impersonation events
