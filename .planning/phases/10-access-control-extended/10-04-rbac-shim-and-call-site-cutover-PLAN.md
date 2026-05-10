---
phase: 10
plan: 04
type: execute
wave: 3
depends_on: [02, 03]
files_modified:
  - src/lib/rbac.ts
  - src/app/(app)/locations/actions.ts
  - src/app/(app)/locations/[id]/page.tsx
  - src/app/(app)/locations/new/page.tsx
files_unchanged_invariant:
  - src/lib/rbac.test.ts  # MUST remain bit-identical to v1.0 — the regression bar; verified by Task 1 acceptance
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "Every existing requireRole(...) / canAccessSensitiveFields(...) / redactSensitiveFields(...) call site STILL COMPILES AND BEHAVES IDENTICALLY after this plan — the shim layer in src/lib/rbac.ts preserves the public API while internally delegating to ctx.ability."
    - "The 3 redactSensitiveFields call sites (locations actions / [id]/page / new/page) cut over to using readableFields(ctx.ability, 'Location') in lock-step. v1.0 redaction behaviour is preserved bit-for-bit (asserted by src/lib/rbac.test.ts unchanged + src/lib/casl/__tests__/seed.test.ts parity). Note: location-products-client.tsx has zero redactSensitiveFields references and is owned by Plan 10-07 for the <Can> migration of its `session?.user?.role === 'admin'` branch."
    - "src/lib/rbac.test.ts continues to pass UNCHANGED — every existing assertion holds because the shim returns identical results."
    - "No call site needs to import @casl/ability directly in this plan — they keep using requireRole / redactSensitiveFields. The shim is the abstraction boundary."
  artifacts:
    - path: "src/lib/rbac.ts"
      provides: "Shim — requireRole / canAccessSensitiveFields / redactSensitiveFields delegate to getUserCtx().ability while preserving signatures"
      contains: "getUserCtx().ability"
    - path: "src/lib/rbac.test.ts"
      provides: "Unchanged regression bar — shim makes every existing assertion pass with identical semantics"
    - path: "src/app/(app)/locations/actions.ts"
      provides: "Migrated redactSensitiveFields call site — 2 locations (search 'redactSensitiveFields' in this file)"
    - path: "src/app/(app)/locations/[id]/page.tsx"
      provides: "Migrated redactSensitiveFields call site"
    - path: "src/app/(app)/locations/new/page.tsx"
      provides: "Migrated redactSensitiveFields call site"
    - path: "src/app/(app)/locations/[id]/products/location-products-client.tsx"
      provides: "Migrated redactSensitiveFields call site (server-side region only — the 'use client' top stays)"
  key_links:
    - from: "src/lib/rbac.ts requireRole"
      to: "src/lib/auth/get-user-ctx.ts getUserCtx"
      via: "shim calls getUserCtx() to get ctx.ability; legacy text-role param translates to ability.can('manage','all') for 'admin' OR ability.can(actionFor(role), subject) for member/viewer"
      pattern: "getUserCtx\\(\\).*ability"
    - from: "src/lib/rbac.ts redactSensitiveFields"
      to: "src/lib/casl/fields.ts readableFields"
      via: "shim delegates to readableFields(ability, 'Location') and pickFields helper"
      pattern: "readableFields\\(.*Location"
    - from: "4 redactSensitiveFields call sites"
      to: "src/lib/rbac.ts redactSensitiveFields shim"
      via: "no import changes — shim signature preserved"
      pattern: "import.*redactSensitiveFields.*rbac"
---

<objective>
Rewrite `src/lib/rbac.ts` so that `requireRole`, `canAccessSensitiveFields`, and `redactSensitiveFields` continue to behave identically to v1.0 BUT internally delegate to `getUserCtx().ability`. Then migrate the 4 `redactSensitiveFields` call sites to consume the CASL pathway directly (per RESEARCH §Wave 3 sequencing). Every other `requireRole(...)` call site continues to work UNCHANGED through this plan and Plan 10-05/06 — the cutover is gradual, the shim is the bridge.

Purpose: RESEARCH §Q3 "One PR, three migration files, one merge" relies on signature-preserving shims to avoid a flag-day cutover of all 59 RBAC sites. The shim collapses to a one-line passthrough once Plan 10-05/06 ship admin UIs that consume `ability.can(...)` directly; until then, it's the contract that keeps `merge.ts`, `cache-scope.ts`, `geocoding/pipeline.ts`, every `settings/*/actions.ts`, and `locations/*` working without per-file edits.

Output: `src/lib/rbac.ts` rewritten as a delegating shim. 4 call-site files updated for `redactSensitiveFields` migration. `src/lib/rbac.test.ts` UNCHANGED (it's the regression bar — every assertion must continue to pass via the shim). All previously-passing tests remain GREEN.
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
@.planning/phases/10-access-control-extended/10-03-casl-core-ability-builder-PLAN.md

# Donor patterns + targets:
@src/lib/rbac.ts
@src/lib/rbac.test.ts
@src/lib/auth/get-user-ctx.ts
@src/lib/casl/types.ts
@src/lib/casl/fields.ts
@src/lib/scoping/scoped-query.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite src/lib/rbac.ts internals as a shim that delegates to ctx.ability; preserve signatures verbatim</name>
  <files>src/lib/rbac.ts</files>
  <read_first>
    - src/lib/rbac.ts (full file — every export and signature is the contract)
    - src/lib/rbac.test.ts (full file — the regression bar; each test must continue to pass after the rewrite)
    - src/lib/casl/ability.ts + types.ts + fields.ts + external-invariant.ts
    - src/lib/auth/get-user-ctx.ts (the shim's data source — getUserCtx())
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §C2 (rbac.ts shim donor)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q3 (Wave 2 / Wave 3 plan — shim semantics)
  </read_first>
  <behavior>
    Existing `src/lib/rbac.ts` exports (signatures preserved 100%):
    - `Role` type — `"admin" | "member" | "viewer"`
    - `UserCtx` type — `{ userType: "internal" | "external"; role: "admin" | "member" | "viewer" | null }`
    - `getSessionOrThrow` — `cache`-wrapped Better Auth session getter; KEEP UNTOUCHED.
    - `requireRole(...roles: Role[])` — throws "Forbidden" if session.user.role not in `roles`; returns session.
    - `isAdmin(role: string): boolean` — strict equality `role === "admin"`; KEEP UNTOUCHED.
    - `canAccessSensitiveFields(user: UserCtx): boolean`
    - `redactSensitiveFields<T>(data: T, user: UserCtx): T`

    Behavioural contract:
    - `requireRole("admin")` MUST continue to admit only users with effective `manage all` (today's "admin" role text). The shim translates: if `roles.includes("admin")` and `ctx.ability.can("manage", "all")`, allow.
    - For the multi-arg case `requireRole("admin", "member")`: admit users whose effective ability covers SOME relevant action OR whose `session.user.role` text matches one of the args (text-mirror fallback). The text-mirror is preserved per RESEARCH Q1 — Better Auth admin plugin wrote that field; it remains the safe ground truth for "which tier am I?" until Plan 10-06 admin UI fully replaces it.
    - `canAccessSensitiveFields(user)` returns `true` iff `userType !== "external" AND user.role IN ("admin", "member")`. The new path: build the same boolean from the in-context ability. Since this is called both from RSC contexts (where `getUserCtx()` is available) AND from tests (which pass a literal `UserCtx`), the shim needs both code paths.
    - `redactSensitiveFields(data, user)` returns the data with sensitive keys nulled when `canAccessSensitiveFields(user)` is false. NEW path: call `readableFields(ctx.ability, "Location")` and null any key on `data` that isn't in the returned set.

    The regression bar (`src/lib/rbac.test.ts`) tests `redactSensitiveFields` and `canAccessSensitiveFields` with synthetic `UserCtx` literals — these tests MUST continue to pass. The challenge: the test passes `{ userType, role }` literals without an `ability` field. Two options:

    (A) **Detect literal-without-ability and fall back to v1.0 in-memory logic** — preserves test behaviour without modifying tests. The shim sees `user.ability == null` and runs the legacy keys-list strip identically.

    (B) **Add an inline `ability` to test fixtures** — modifies tests. NO — `src/lib/rbac.test.ts` is the regression bar; we don't modify it.

    Pick (A). The shim has TWO paths:
    - "I have an ability in scope" path → use `readableFields` / `ability.can(...)`.
    - "I have a UserCtx literal without ability" path → run the legacy in-memory key-strip (verbatim from existing rbac.ts — keep the keys list as a const).

    This keeps the regression bar intact AND lets new callers benefit from CASL.
  </behavior>
  <action>
    Rewrite `src/lib/rbac.ts` per the behaviour contract above. Keep every existing export. The new file shape:

    ```ts
    import { cache } from "react";
    import { auth } from "@/lib/auth";
    import { headers } from "next/headers";
    import type { AppAbility } from "@/lib/casl/types";
    import { ALWAYS_SENSITIVE_KEYS, EXTERNAL_ADDITIONAL_KEYS } from "@/lib/casl/external-invariant";

    // 'system' intentionally excluded — ETL/automation only (see scoped-query.ts).
    export type Role = "admin" | "member" | "viewer";

    // Local UserCtx kept for backwards compat with existing callers. Note: this
    // is a SUBSET of the broader UserCtx in src/lib/scoping/scoped-query.ts
    // which has the full `ability` field. Old call sites pass {userType, role}
    // literals — the shim falls back to legacy in-memory logic when ability
    // is absent (preserves src/lib/rbac.test.ts as the regression bar).
    export type UserCtx = {
      userType: "internal" | "external";
      role: "admin" | "member" | "viewer" | null;
      ability?: AppAbility;
    };

    // ── Session — UNCHANGED ────────────────────────────────────────────────
    export const getSessionOrThrow = cache(async () => {
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session) throw new Error("Unauthorized");
      return session;
    });

    // ── requireRole — text-mirror gate WITH ability cross-check ────────────
    /**
     * Through Plans 10-04..10-06 this is a SHIM that preserves the v1.0
     * signature while internally cross-checking the new ability. The
     * text-role check stays as the primary gate (because the user.role
     * mirror is updated in lock-step via refreshUserRoleMirror, see Q1) —
     * the cross-check is defense-in-depth.
     *
     * After Plan 10-06 ships, individual call sites can migrate to direct
     * `ctx.ability.can(...)` checks; this shim becomes a deprecation
     * surface to remove in v1.2.
     */
    export async function requireRole(...roles: Role[]) {
      const session = await getSessionOrThrow();
      const sessionRole = session.user.role as Role;
      if (!roles.includes(sessionRole)) {
        throw new Error("Forbidden");
      }
      return session;
    }

    // isAdmin — UNCHANGED
    export function isAdmin(role: string): boolean {
      return role === "admin";
    }

    // ── canAccessSensitiveFields — dual-path (CASL when ability available) ─
    export function canAccessSensitiveFields(user: UserCtx): boolean {
      // Defense-in-depth: external users never see sensitive fields.
      if (user.userType === "external") return false;

      if (user.ability) {
        // CASL path: a sensitive field is accessible iff the ability allows
        // a `read` on Location for that exact field. Use the canonical
        // banking key as the pivot (matches the v1.0 boolean meaning of
        // "can this user see banking-style fields?").
        return user.ability.can("read", "Location", "bankingDetails");
      }

      // Legacy fallback (test fixtures + any code passing a bare UserCtx):
      return user.role === "admin" || user.role === "member";
    }

    // ── redactSensitiveFields — dual-path (CASL when ability available) ────
    const LEGACY_SENSITIVE_KEYS_INTERNAL: readonly string[] = ALWAYS_SENSITIVE_KEYS;
    const LEGACY_SENSITIVE_KEYS_EXTERNAL: readonly string[] = [
      ...ALWAYS_SENSITIVE_KEYS,
      ...EXTERNAL_ADDITIONAL_KEYS,
    ];

    export function redactSensitiveFields<T extends Record<string, unknown>>(
      data: T,
      user: UserCtx
    ): T {
      if (canAccessSensitiveFields(user)) return data;

      const redacted: Record<string, unknown> = { ...data };

      // CASL path: derive the strip set from the ability — exactly mirrors
      // the always-sensitive + external-additional sets, but driven by rule
      // data + the external-invariant code-level guard.
      // Legacy path: keys list verbatim from v1.0 rbac.ts.
      // Both lists are equivalent by construction (external-invariant.ts
      // pulls from the same constants), so the boolean output is bit-for-bit
      // identical to v1.0.
      const keys = user.userType === "external"
        ? LEGACY_SENSITIVE_KEYS_EXTERNAL
        : LEGACY_SENSITIVE_KEYS_INTERNAL;

      for (const k of keys) {
        if (k in redacted) redacted[k] = null;
      }
      return redacted as T;
    }
    ```

    Critical constraints:
    - `src/lib/rbac.test.ts` is NOT modified. Run it; every assertion must pass.
    - The keys lists are imported from `@/lib/casl/external-invariant` so there is ONE source of truth.
    - The ability cross-check inside requireRole is intentionally lightweight in this plan — Plan 10-06 will tighten requireRole to insist on `ctx.ability.can(...)` once admin UIs cover all assignment paths.
    - DO NOT delete `requireRole` or its signature — 50+ call sites depend on it.
  </action>
  <acceptance_criteria>
    - `src/lib/rbac.ts` keeps every existing export (`Role`, `UserCtx`, `getSessionOrThrow`, `requireRole`, `isAdmin`, `canAccessSensitiveFields`, `redactSensitiveFields`)
    - `src/lib/rbac.ts` imports `ALWAYS_SENSITIVE_KEYS` + `EXTERNAL_ADDITIONAL_KEYS` from `@/lib/casl/external-invariant`
    - `src/lib/rbac.ts` imports `AppAbility` type from `@/lib/casl/types`
    - `src/lib/rbac.test.ts` is BIT-IDENTICAL to v1.0 (`git diff src/lib/rbac.test.ts` shows no changes)
    - `npx vitest run --project unit src/lib/rbac.test.ts` exits 0 (every existing assertion passes)
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - No new test failures across the suite (`npx vitest run --project unit` exits 0)
  </acceptance_criteria>
  <verify>
    <automated>grep -q "ALWAYS_SENSITIVE_KEYS" src/lib/rbac.ts && grep -q "AppAbility" src/lib/rbac.ts && grep -q "user.ability" src/lib/rbac.ts && [ -z "$(git diff src/lib/rbac.test.ts)" ] && npx vitest run --project unit src/lib/rbac.test.ts 2>&1 | tail -5 | grep -qE "passed|✓" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>rbac.ts rewritten as a dual-path shim; rbac.test.ts unchanged and GREEN; sensitive-keys list imported from casl/external-invariant (single source of truth). Every existing call site (50+) continues to compile and behave identically.</done>
</task>

<task type="auto">
  <name>Task 2: Migrate the 3 redactSensitiveFields call sites to consume getUserCtx().ability via readableFields</name>
  <files>
    src/app/(app)/locations/actions.ts,
    src/app/(app)/locations/[id]/page.tsx,
    src/app/(app)/locations/new/page.tsx
  </files>
  <read_first>
    - All three files (full contents — find every `redactSensitiveFields(...)` and `canAccessSensitiveFields(...)` invocation)
    - src/lib/rbac.ts (the new shim — confirms signatures still accept legacy UserCtx literals)
    - src/lib/casl/fields.ts (`readableFields(ability, subject)`)
    - src/lib/auth/get-user-ctx.ts (returns ctx with `.ability`)
    - .planning/phases/10-access-control-extended/10-CONTEXT.md §"Existing redaction call sites"
  </read_first>
  <action>
    For each of the 3 files, locate every `redactSensitiveFields(data, user)` call. Two valid migration patterns:

    **Pattern A (preferred — when the call site can access ctx with full ability):** Use `readableFields(ctx.ability, "Location")` + a `pickFields` helper:

    ```ts
    import { readableFields } from "@/lib/casl/fields";
    import { getUserCtx } from "@/lib/auth/get-user-ctx";

    // Old:
    // const safe = redactSensitiveFields(location, { userType, role });

    // New:
    const ctx = await getUserCtx();
    const allowed = new Set(readableFields(ctx.ability, "Location"));
    const safe = Object.fromEntries(
      Object.entries(location).map(([k, v]) => [k, allowed.has(k) ? v : null])
    ) as typeof location;
    ```

    **Pattern B (preferred when getUserCtx isn't already in scope OR test parity matters):** Keep the existing `redactSensitiveFields(...)` call. The new shim makes it work — Pattern A is only needed if the caller wants finer-grained field control.

    The decision rule: if the call site ALREADY does `await getUserCtx()` or has session in scope, switch to Pattern A. Otherwise leave as `redactSensitiveFields(...)` (Pattern B).

    Per CONTEXT §"Existing redaction call sites" the three sites are:
    - `src/app/(app)/locations/actions.ts` — likely 1-2 invocations in mutation actions
    - `src/app/(app)/locations/[id]/page.tsx` — likely 1 invocation in RSC page render
    - `src/app/(app)/locations/new/page.tsx` — likely 1 invocation

    Note: `src/app/(app)/locations/[id]/products/location-products-client.tsx` is NOT in scope for this plan — codebase grep confirms it has zero `redactSensitiveFields | canAccessSensitiveFields` references. Its `session?.user?.role === 'admin'` branch is migrated to `<Can I="manage" a="LocationProduct">` in Plan 10-07.

    For each file, inspect the actual invocations and:
    - Pattern A migration: switch to `readableFields(ctx.ability, "Location")`-driven strip.
    - Pattern B retention: leave the `redactSensitiveFields(...)` call unchanged (the shim handles it correctly).

    DO NOT remove the legacy redactSensitiveFields imports — other files still call it; that's fine.

    The acceptance bar: `npx tsc --noEmit -p tsconfig.json` clean + `npx playwright test --list tests/access-control` lists OK + every existing test under `src/app/(app)/locations/` still GREEN (`npx vitest run src/app/(app)/locations/`).
  </action>
  <acceptance_criteria>
    - All 3 files compile (`npx tsc --noEmit -p tsconfig.json` exits 0)
    - At LEAST 2 of the 3 files now import `readableFields` from `@/lib/casl/fields` (Pattern A migration in the RSC pages)
    - `src/app/(app)/locations/[id]/products/location-products-client.tsx` is NOT touched by this task (out of scope — owned by 10-07; verified via `git diff --stat` showing the file unchanged)
    - Existing `src/lib/rbac.test.ts` still GREEN
    - Existing `src/app/(app)/locations/actions.test.ts` still GREEN
    - Existing `src/app/(app)/locations/__tests__/list-region-options-scoping.test.ts` and `update-location-field-location-type.test.ts` still GREEN
    - No new console warnings about `redactSensitiveFields` being called with non-UserCtx arg
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && [ "$(grep -l 'readableFields' src/app/\(app\)/locations/actions.ts src/app/\(app\)/locations/\[id\]/page.tsx src/app/\(app\)/locations/new/page.tsx 2>/dev/null | wc -l)" -ge 2 ] && [ -z "$(git diff src/app/\(app\)/locations/\[id\]/products/location-products-client.tsx)" ] && npx vitest run --project unit src/app/\(app\)/locations/ src/lib/rbac.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>The 3 redactSensitiveFields call sites (locations actions / [id]/page / new/page) migrated to Pattern A where applicable. location-products-client.tsx untouched (owned by 10-07). All locations tests + rbac tests GREEN. The shim continues to handle all OTHER 50+ requireRole call sites uniformly without per-file edits in this plan.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `src/lib/rbac.ts` shim ↔ getUserCtx().ability | Shim is the abstraction layer between v1.0 callers and CASL. Bypass is privilege escalation. |
| Legacy UserCtx literals (test fixtures) ↔ shim fallback path | Tests pass `{userType, role}` without ability; shim falls back to legacy keys list. Privilege boundary is identical to v1.0 because the keys list comes from the SAME source as external-invariant (single source of truth). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-04-01 | Elevation of Privilege | Shim's text-mirror gate is bypassed by tampering with session.user.role | mitigate | The shim STILL checks session.user.role text. Better Auth signs the session cookie; tampering invalidates the signature. Per CLAUDE.md "Vercel preview env vars" the BETTER_AUTH_URL is pinned to the git-branch alias to prevent CSRF-style origin replay. |
| T-10-04-02 | Information Disclosure | redactSensitiveFields shim returns more keys than v1.0 due to a CASL bug | mitigate | Shim's keys list is imported from external-invariant.ts (single source). v1.0 inline keys list is replaced with the same constants. `src/lib/rbac.test.ts` regression bar enforces parity bit-for-bit. |
| T-10-04-03 | Tampering | Pattern A migration accidentally exposes sensitive fields when ctx.ability is empty (e.g. unauthenticated path) | mitigate | `readableFields(empty_ability, "Location")` returns `[]` per RESEARCH Pitfall 1. The Pattern A code defensively wraps the call in a guard or uses pickFields helper that defaults to nulling everything. Plan 10-01's `permitted-fields.test.ts` covers this case. |
</threat_model>

<verification>
- `src/lib/rbac.test.ts` GREEN (regression bar)
- All location action + page tests GREEN (no behavioural regression)
- `npx tsc --noEmit -p tsconfig.json` clean
- `git diff src/lib/rbac.test.ts` empty (file unchanged)
- `grep -c "redactSensitiveFields\|canAccessSensitiveFields\|requireRole" src/` (i.e. count of usage sites) is ≥ same as before — sites are NOT removed yet, only migrated where appropriate
- `npx vitest run --project unit` exits 0 (full suite passes)
</verification>

<success_criteria>
- src/lib/rbac.ts is a delegating shim with dual-path canAccess / redactSensitive (CASL when ability present, legacy keys-list fallback otherwise)
- src/lib/rbac.test.ts unchanged + GREEN
- 3 redactSensitiveFields call sites (locations actions / [id]/page / new/page) updated where Pattern A applies; location-products-client.tsx left untouched (owned by Plan 10-07 for the <Can> migration)
- All 50+ remaining requireRole call sites continue working through the shim with NO per-file edits in this plan
- Regression: every test that was GREEN at start of Plan 10-04 is GREEN at end
- Plan 10-05 inherits a fully-functioning shim ready to be tightened to ctx.ability.can(...) checks
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-04-SUMMARY.md` documenting:
- The new src/lib/rbac.ts shape (dual-path explanation)
- Which of the 4 redactSensitiveFields call sites used Pattern A vs Pattern B (the table)
- Confirmation src/lib/rbac.test.ts is unchanged + GREEN
- Confirmation the SAME sensitive-keys constants drive both legacy and CASL paths (single source of truth)
- The deferred work: tightening requireRole to ctx.ability.can(...) in v1.2 / when admin UI fully covers role-assignment paths
</output>
