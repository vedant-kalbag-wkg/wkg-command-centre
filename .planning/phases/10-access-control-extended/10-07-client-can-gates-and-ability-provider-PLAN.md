---
phase: 10
plan: 07
type: execute
wave: 5
depends_on: [03, 06]
files_modified:
  - src/app/(app)/layout.tsx
  - src/components/layout/app-sidebar.tsx
  - src/components/layout/user-menu.tsx
  - src/app/(app)/locations/[id]/products/location-products-client.tsx
autonomous: true
requirements: [AUTH-06]
must_haves:
  truths:
    - "src/app/(app)/layout.tsx wraps children in <AbilityProvider rules={ctx.ability.rules}> using AbilityProvider from src/lib/casl/ability-context.tsx (Plan 10-03 Task 4)."
    - "<Can I=\"manage\" a=\"all\"> replaces {isAdmin && ...} at the 3 client-side role-conditional renders identified by RESEARCH §Q4 audit: app-sidebar.tsx:165, user-menu.tsx:127, location-products-client.tsx:474."
    - "RSC-side admin gates (settings hub tiles + locations/[id] admin panel) STAY server-only with direct ability.can(...) calls (per RESEARCH Q4 'Stay server-only' decision)."
    - "Hydration is consistent — server-rendered visibility matches client <Can> evaluation; no flicker (per RESEARCH Pitfall 3)."
  artifacts:
    - path: "src/app/(app)/layout.tsx"
      provides: "Wraps {children} in <AbilityProvider rules={ctx.ability.rules}>; calls getUserCtx() to access ability"
      contains: "AbilityProvider"
    - path: "src/components/layout/app-sidebar.tsx"
      provides: "Migrated nav-group gate at line 165 to <Can I='manage' a='all'>"
      contains: "<Can"
    - path: "src/components/layout/user-menu.tsx"
      provides: "Migrated admin section gate at line 127 to <Can I='manage' a='all'>"
      contains: "<Can"
    - path: "src/app/(app)/locations/[id]/products/location-products-client.tsx"
      provides: "Migrated admin branch at line 474 from session?.user?.role==='admin' to <Can I='manage' a='LocationProduct'>"
      contains: "<Can"
  key_links:
    - from: "src/app/(app)/layout.tsx"
      to: "src/lib/casl/ability-context.tsx AbilityProvider"
      via: "Server reads getUserCtx().ability.rules; passes RawRule[] across SSR boundary"
      pattern: "AbilityProvider.*rules"
    - from: "3 client gates"
      to: "src/lib/casl/ability-context.tsx Can"
      via: "import { Can } from '@/lib/casl/ability-context'; <Can I=... a=...>...</Can>"
      pattern: "import.*Can.*ability-context"
---

<objective>
Wrap the app's client tree with `<AbilityProvider>` so client islands can use the `<Can>` component for role-conditional rendering, and migrate the 3 specific client-side role gates identified by RESEARCH §Q4 audit. RSC-side gates are intentionally NOT migrated — they use direct `ability.can(...)` calls because RSCs can call `getUserCtx()` server-side without a roundtrip.

Purpose: AUTH-06 SC1 (CASL Ability built in get-user-ctx) is functionally complete after Plan 10-03; this plan extends it to client islands via the SSR-safe rules-as-prop pattern (RESEARCH §Pattern 3). RESEARCH Pitfall 3 ("flickers between server and client") is the load-bearing risk this plan must avoid — the rules passed to AbilityProvider MUST be the same rules the server used.

Output: 4 files modified (1 layout wrap + 3 client gate migrations). Plan 10-01's `tests/access-control/can-component.spec.ts` goes list-clean; full GREEN against preview alias is Plan 10-08.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/10-access-control-extended/10-CONTEXT.md
@.planning/phases/10-access-control-extended/10-RESEARCH.md
@.planning/phases/10-access-control-extended/10-PATTERNS.md

@src/app/(app)/layout.tsx
@src/components/layout/app-sidebar.tsx
@src/components/layout/user-menu.tsx
@src/app/(app)/locations/[id]/products/location-products-client.tsx
@src/lib/casl/ability-context.tsx
@src/lib/auth/get-user-ctx.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wrap src/app/(app)/layout.tsx with AbilityProvider; pass ability.rules from getUserCtx</name>
  <files>src/app/(app)/layout.tsx</files>
  <read_first>
    - src/app/(app)/layout.tsx (full file — current shape)
    - src/lib/casl/ability-context.tsx (AbilityProvider props shape from Plan 10-03 Task 4)
    - src/lib/auth/get-user-ctx.ts (returns UserCtx with ability field — Plan 10-03 Task 3)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Pattern 3: SSR-safe Ability serialization" (lines 320-358)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §G (layout.tsx augmentation)
  </read_first>
  <action>
    Find the existing layout shape (per PATTERNS §G — current shape: `auth.api.getSession` → `<AppShellV2>`). Augment to:

    1. Add `import { AbilityProvider } from "@/lib/casl/ability-context";` and `import { getUserCtx } from "@/lib/auth/get-user-ctx";`
    2. Inside the async layout function, AFTER the existing session check, call `const ctx = await getUserCtx();`
    3. Wrap the existing `<AppShellV2>...</AppShellV2>` JSX with `<AbilityProvider rules={ctx.ability.rules}>...</AbilityProvider>`.

    Critical caveat per RESEARCH §Pitfall 3: `ctx.ability.rules` MUST be the EXACT rules the server used. Do not rebuild the ability or fetch rules from anywhere else — use `ctx.ability.rules` directly. The server-rendered HTML must match what the client computes from these rules; otherwise the gated nav flickers visible-then-hidden during hydration.

    Skeleton (preserve every existing prop on AppShellV2):

    ```tsx
    import { headers } from "next/headers";
    import { redirect } from "next/navigation";
    import { auth } from "@/lib/auth";
    import { getUserCtx } from "@/lib/auth/get-user-ctx";
    import { AbilityProvider } from "@/lib/casl/ability-context";
    import { AppShellV2 } from "@/components/layout/app-shell-v2";

    export default async function AppLayout({ children }: { children: React.ReactNode }) {
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session?.user) {
        redirect("/auth/sign-in");
      }

      const ctx = await getUserCtx();

      return (
        <AbilityProvider rules={ctx.ability.rules}>
          <AppShellV2 user={session.user} userType={ctx.userType} role={ctx.role}>
            {children}
          </AppShellV2>
        </AbilityProvider>
      );
    }
    ```

    AppShellV2's prop shape may differ — preserve every existing prop (it likely already takes `isAdmin` boolean derived from session role). The ONLY structural change is the `<AbilityProvider>` wrapper around `<AppShellV2>`. Do NOT remove or rename existing props.

    Per RESEARCH §Pitfall 3 verification: rendering the page once with admin and once with viewer should produce SSR HTML where the sidebar admin nav-group is present for admin and absent for viewer — no flicker on hydration. The Plan 10-08 Playwright runs verify this against the preview alias.
  </action>
  <acceptance_criteria>
    - `src/app/(app)/layout.tsx` imports `AbilityProvider` from `@/lib/casl/ability-context`
    - File imports `getUserCtx` from `@/lib/auth/get-user-ctx`
    - File renders `<AbilityProvider rules={ctx.ability.rules}>` wrapping the existing app-shell tree
    - Existing AppShellV2 props are preserved
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx next build` does not error on the new layout (full type-check)
  </acceptance_criteria>
  <verify>
    <automated>grep -q "AbilityProvider" src/app/\(app\)/layout.tsx && grep -q "getUserCtx" src/app/\(app\)/layout.tsx && grep -q "ctx.ability.rules" src/app/\(app\)/layout.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Layout wraps app shell with AbilityProvider; rules pass-through from getUserCtx. Client islands now have AbilityContext available for the 3 gates in Tasks 2 and 3.</done>
</task>

<task type="auto">
  <name>Task 2: Migrate the 2 layout-component <Can> gates (sidebar nav group + user-menu admin section)</name>
  <files>
    src/components/layout/app-sidebar.tsx,
    src/components/layout/user-menu.tsx
  </files>
  <read_first>
    - src/components/layout/app-sidebar.tsx (full file — find the `{isAdmin && <NavGroup ...>}` block at line ~165)
    - src/components/layout/user-menu.tsx (full file — find the `{isAdmin && (<>...</>)}` block at line ~127)
    - src/lib/casl/ability-context.tsx (Can export)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §G (verbatim diffs)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q4 (audit decisions: both files Migrate to <Can>)
  </read_first>
  <action>
    **app-sidebar.tsx** at line 165: replace `{isAdmin && <NavGroup label="Configure" items={configure} pathname={pathname} />}` with:

    ```tsx
    <Can I="manage" a="all">
      <NavGroup label="Configure" items={configure} pathname={pathname} />
    </Can>
    ```

    Add the import at the top: `import { Can } from "@/lib/casl/ability-context";`

    **user-menu.tsx** at line 127: replace the `{isAdmin && (<>...</>)}` block (containing `<M3DropdownMenuSeparator />`, `<M3DropdownMenuLabel>Admin</M3DropdownMenuLabel>`, and `{systemAdminItems.map(...)}`) with:

    ```tsx
    <Can I="manage" a="all">
      <M3DropdownMenuSeparator />
      <M3DropdownMenuLabel>Admin</M3DropdownMenuLabel>
      {systemAdminItems.map(/* ... preserve existing inner shape ... */)}
    </Can>
    ```

    Add the import at the top: `import { Can } from "@/lib/casl/ability-context";`

    **DO NOT** remove the `isAdmin` prop from either component's props interface — it may still be used elsewhere (for instance, RSCs that drill it down for direct conditional rendering in NON-Can-gated places). The `isAdmin` prop becomes unused at the migrated call sites only; ESLint/TypeScript will flag it if the entire prop is dead code (in which case remove the prop drilling). Run `npx tsc --noEmit -p tsconfig.json` after the change and inspect for unused-prop warnings; if `isAdmin` is dead in BOTH files entirely, delete the prop and update the parent passing it. Otherwise leave intact.

    Per RESEARCH §Pitfall 3: because the layout (Task 1) wraps the tree with the same rules used server-side, hydration is consistent — no flicker.

    Per RESEARCH §Q4: these are HIGH-TRAFFIC client gates. Migration is correct because:
    - sidebar drives whether the operator sees admin tooling at all
    - user-menu drives the admin section in the dropdown
    - Both rerender when impersonation changes (server rebuilds ability for impersonated identity → fresh rules → client rerenders correctly)
  </action>
  <acceptance_criteria>
    - Both files import `Can` from `@/lib/casl/ability-context`
    - Each file contains at least one `<Can I="manage" a="all">` element
    - Each file no longer has the `{isAdmin && ...}` conditional render at the migrated location (search the original line range; should be replaced)
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx next build` does not error
    - `grep -c "{isAdmin &&" src/components/layout/app-sidebar.tsx src/components/layout/user-menu.tsx` is reduced (at minimum, the line-165 / line-127 occurrences are replaced)
  </acceptance_criteria>
  <verify>
    <automated>grep -q 'import { Can }' src/components/layout/app-sidebar.tsx && grep -q 'import { Can }' src/components/layout/user-menu.tsx && grep -q '<Can I="manage" a="all">' src/components/layout/app-sidebar.tsx && grep -q '<Can I="manage" a="all">' src/components/layout/user-menu.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Sidebar admin nav-group + user-menu admin section both gated via <Can I="manage" a="all">. Layout's AbilityProvider supplies the rules. Hydration is consistent because server and client use the same rules snapshot.</done>
</task>

<task type="auto">
  <name>Task 3: Migrate location-products-client.tsx admin branch from useSession-style check to <Can I="manage" a="LocationProduct">; remove the now-stale role read</name>
  <files>src/app/(app)/locations/[id]/products/location-products-client.tsx</files>
  <read_first>
    - src/app/(app)/locations/[id]/products/location-products-client.tsx (full file — find the role check at line ~474)
    - src/lib/casl/ability-context.tsx (Can export)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §G (verbatim diff: location-products line 474)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q4 (audit decision: this site MIGRATES — currently reads stale session client-side; migrating to <Can> makes it correct under impersonation)
  </read_first>
  <action>
    At line ~474 the existing code is approximately `session?.user?.role === "admin" && (...)` (or `session?.user?.role === "admin" ? ... : ...`). Replace with `<Can I="manage" a="LocationProduct">...</Can>`.

    Add the import at the top of the file: `import { Can } from "@/lib/casl/ability-context";`

    If the existing branch is using `session?.user?.role` from a `useSession()` hook for OTHER purposes (e.g. displaying the user's name in the UI), DO NOT remove the `useSession()` call entirely — only remove the role-based conditional. If the role is ONLY used for the gate at line 474, remove the now-stale read AND the `useSession()` call (or its associated `const { data: session } = useSession()` line) to keep the file lean.

    Per RESEARCH §Q4 rationale: the v1.0 code reads `session?.user?.role` from `useSession()` which is stale on impersonation (the client cookie says admin, but the impersonated user is not). Migrating to `<Can>` reads from `AbilityContext` which is built off `ctx.ability.rules` — and those rules are derived from the IMPERSONATED user's user_roles via `getUserCtx`'s impersonation branch (Plan 10-03 Task 3). Result: correct gating under impersonation.

    Server-side action handlers in the same file (or the actions.ts it calls) already gate via `requireRole('admin')` shim → ability check (Plan 10-04). Client-side `<Can>` is UX, not security; the shim remains the security boundary.
  </action>
  <acceptance_criteria>
    - `src/app/(app)/locations/[id]/products/location-products-client.tsx` imports `Can` from `@/lib/casl/ability-context`
    - File contains `<Can I="manage" a="LocationProduct">` (or equivalent admin-action attr; the original site was an admin gate)
    - The line-474 region no longer has `session?.user?.role === "admin"` style check
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - Existing tests for location-products (if any) still GREEN: `npx vitest run --project unit src/app/\(app\)/locations/\[id\]/products/`
  </acceptance_criteria>
  <verify>
    <automated>grep -q 'import { Can }' src/app/\(app\)/locations/\[id\]/products/location-products-client.tsx && grep -q '<Can I=' src/app/\(app\)/locations/\[id\]/products/location-products-client.tsx && ! grep -q 'session?.user?.role === "admin"' src/app/\(app\)/locations/\[id\]/products/location-products-client.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Location-products admin branch migrated to <Can I="manage" a="LocationProduct">. Stale useSession-role read eliminated. Impersonation now correctly gates the admin affordance. Plan 10-01 can-component.spec.ts list-clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Server-built rules → client AbilityContext | Server-side rules cross the SSR boundary as JSON. Same snapshot used for SSR render + client hydration. Mismatch = flicker. |
| Client `<Can>` UI gate ↔ server-action ability check | `<Can>` is UX only. Actions ALWAYS re-check on the server. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-07-01 | Spoofing | Stale `<Can>` evaluation under impersonation (uses real session role, not impersonated) | mitigate | Layout calls `getUserCtx()` which picks up the impersonating_user_id cookie (Plan 10-03 Task 3) — ability is built off the IMPERSONATED user. Rules-as-prop pattern means client sees the same impersonated rules. |
| T-10-07-02 | Tampering | Browser tampering with rules in AbilityContext | accept | Server-action calls always re-check via `requireRole`/`getUserCtx().ability` server-side. Client `<Can>` is UX, never security. |
| T-10-07-03 | Information Disclosure | Rules JSON in SSR HTML reveals role permission structure | accept | Rules are not secret — the user already knows their own permissions from interacting with the UI. Audit-log captures any role mutations. No PII in rules. |
| T-10-07-04 | Denial of Service | Hydration flicker on every page load (RESEARCH Pitfall 3) | mitigate | Pass `ctx.ability.rules` from server (NOT a fresh client-side fetch). Server SSRs with the same rules. Plan 10-01's `can-component.spec.ts` Playwright assertions catch this. |
</threat_model>

<verification>
- `npx tsc --noEmit -p tsconfig.json` clean
- `npx next build` clean (full type-check on layout + client gates)
- `npx playwright test --list tests/access-control/can-component.spec.ts` lists cleanly
- Manual smoke: dev server, sign in as admin → see Configure nav-group + Admin section in user menu; sign in as TEST_VIEWER → both hidden; navigate `/locations/{id}/products` and observe admin branch hidden for viewer
- Existing tests (rbac, scoping, locations) still GREEN
</verification>

<success_criteria>
- 4 files modified (1 layout wrap + 3 client gate migrations)
- Layout wraps app shell with `<AbilityProvider rules={ctx.ability.rules}>`
- 3 client gates migrated to `<Can>`: app-sidebar.tsx:165, user-menu.tsx:127, location-products-client.tsx:474
- RSC-side gates (settings hub tiles + locations/[id] admin panel) NOT migrated — they use direct `ability.can(...)` per RESEARCH §Q4
- No hydration flicker (rules passed from server match what client builds)
- `npx tsc --noEmit -p tsconfig.json` clean
- Plan 10-01's can-component.spec.ts list-clean (full GREEN against preview is Plan 10-08)
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-07-SUMMARY.md` documenting:
- 4 files modified
- The 3 client gates migrated + the 5+ RSC sites left as direct `ability.can(...)` (per RESEARCH §Q4 audit decisions)
- Confirmation rules-as-prop pattern from layout matches client AbilityContext (no hydration flicker)
- Status of Plan 10-01 RED tests: can-component.spec.ts list-clean; full GREEN against preview is Plan 10-08
</output>
