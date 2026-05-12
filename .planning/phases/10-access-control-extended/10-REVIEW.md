---
phase: 10-access-control-extended
reviewed: 2026-05-10T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src/lib/casl/ability.ts
  - src/lib/casl/ability-context.tsx
  - src/lib/casl/external-invariant.ts
  - src/lib/casl/lockout-guard.ts
  - src/lib/casl/role-mirror.ts
  - src/lib/rbac.ts
  - src/lib/auth/get-user-ctx.ts
  - src/app/(app)/settings/roles/editor-internal.ts
  - src/app/(app)/settings/users/[id]/role-internal.ts
  - src/app/(app)/settings/users/[id]/role-actions.ts
  - src/app/(app)/settings/users/[id]/scopes-internal.ts
  - src/app/(app)/settings/users/[id]/scopes-actions.ts
  - migrations/0050_phase_10_roles_schema.sql
  - migrations/0051_phase_10_seed_and_backfill.sql
  - migrations/0052_phase_10_user_scopes_role_id_required.sql
status: clean
findings:
  critical: 4
  warning: 3
  info: 2
  total: 9
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-10
**Depth:** deep
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 10 introduces a CASL ability builder, role/permission schema, role-assignment UI, scope CRUD, and a lockout guard. The architecture is sound: the server-action split pattern (internal helpers vs. "use server" wrappers) is correct and well-motivated; transactional scope for role revoke is solid; the external-invariant append-last pattern gives correct deny-wins semantics.

Four issues require fixes before this ships:

1. The lockout guard query silently misses all tier-kind roles — any admin whose only system role is removed can lock out the last admin by accident.
2. Migration 0051 has a non-idempotent seed that will duplicate `role_permissions` rows on every re-run because the `ON CONFLICT DO NOTHING` clause has no unique constraint to trigger on.
3. A custom role whose name is literally `"admin"` can be created via the role editor; the role-mirror will write `"admin"` into `user.role`, granting that user full impersonation capability (`get-user-ctx.ts:17`).
4. `_removeScopeForActor` has a TOCTOU race: the "last scope" invariant check and the DELETE are not wrapped in a transaction, so two concurrent removals can both pass the guard and leave an external user with zero scopes.

---

## Critical Issues

### CR-01: Lockout guard silently skips tier-kind "admin" roles

**File:** `src/lib/casl/lockout-guard.ts:47-48`

**Issue:** The doc-comment on line 27 says "effective admin = system-kind OR admin-named role". The WHERE clause implements only `eq(roles.kind, "system")`. Any user whose admin access comes from a tier-kind role named "admin" (the `admin` tier role seeded by 0051 is `kind='system'`, so the current seed is safe) — or from a custom role with `kind='custom'` and any name — is invisible to the guard. More practically, `_replaceRolePermissionsForActor` calls `assertAtLeastOneEffectiveAdmin` INSIDE the transaction: after the DELETE+INSERT of rules, if the surviving system-kind admin set is empty, the guard fires. But if an admin has only a tier-kind role, they are never counted, so the guard may approve a lockout.

Additionally there is no `DISTINCT` on `userId` in the query. A user holding two system-kind roles appears twice in `rows`. The subsequent `remaining.filter` will still leave that user's rows, so the guard won't fire falsely — however the `remaining.length === 0` check is counting rows not users. A user with two system-kind roles contributes count 2 even without an `excludeUserId`. When `excludeUserId` matches one of them, `remaining.length` is 1 (one row), not 0, so the guard correctly does not fire. The duplicate-row issue therefore does not cause a false lockout, but it does make the intent misleading and will cause confusion when debugging.

**Fix:**
```typescript
// lockout-guard.ts — correct the WHERE to match the doc comment and ability builder:
// buildAbility grants "manage all" to both kind='system' AND to any role checked via
// the text mirror path. Mirror the same set here.
.where(
  and(
    or(eq(roles.kind, "system"), eq(roles.name, "admin")),
    eq(user.banned, false),
  ),
)
```

If the intent is strictly "system-kind only" then the doc comment on line 27 must be corrected to match and the caller in `_replaceRolePermissionsForActor` must be aware that tier-kind roles are not protected.

---

### CR-02: Migration 0051 — `role_permissions` seed is not idempotent (duplicate rows on re-run)

**File:** `migrations/0051_phase_10_seed_and_backfill.sql:57` (Delta 2) and `migrations/0051_phase_10_seed_and_backfill.sql:80` (Delta 3)

**Issue:** The migration header claims "Idempotent: every INSERT uses ON CONFLICT DO NOTHING". This is false for Deltas 2 and 3. The `role_permissions` table has no unique constraint on `(role_id, action, subject)` — only a UUID primary key (see `0050:46-55`). `ON CONFLICT DO NOTHING` without a target column triggers on PK conflicts only. Since each INSERT generates a fresh `gen_random_uuid()` PK, there is never a conflict. Every re-run of 0051 adds a full second (third, Nth) copy of the ops-it and read-only rules. After two deployments to the same DB, `buildAbility` will emit duplicate `can()` and `cannot()` rules for these roles; CASL evaluates them all, which is usually harmless for `can()` but produces confusing `permittedFieldsOf` output and wastes query bandwidth.

The `roles` seed (Delta 1) is correctly idempotent via the `name` UNIQUE constraint. The `user_roles` backfill (Delta 4) is idempotent via the `(user_id, role_id)` unique constraint. Only `role_permissions` is broken.

**Fix (Option A — preferred):** Add a unique constraint to `role_permissions` in migration 0050 (or a follow-up migration) and then the `ON CONFLICT DO NOTHING` will work as intended:
```sql
-- in 0050, add after the table creation:
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_action_subject_unique"
  UNIQUE ("role_id", "action", "subject");
```

**Fix (Option B — migration-only, no schema change):** Guard the inserts with an existence check:
```sql
INSERT INTO "role_permissions" (...)
  SELECT ... FROM "roles" r, (VALUES ...) AS rules(...)
    WHERE r.name = 'ops-it'
      AND NOT EXISTS (
        SELECT 1 FROM "role_permissions" rp
          INNER JOIN "roles" r2 ON rp.role_id = r2.id
          WHERE r2.name = 'ops-it'
      );
```

---

### CR-03: Custom role named "admin" grants impersonation capability via role-mirror

**File:** `src/lib/casl/role-mirror.ts:58-60` + `src/lib/auth/get-user-ctx.ts:17`

**Issue:** `refreshUserRoleMirror` at lines 58-60 handles custom roles by storing the raw `name` value into `user.role`:

```typescript
// role-mirror.ts:59-61
} else {
  mirroredRole = assignments[0]?.name ?? null;
}
```

`get-user-ctx.ts:17` gates impersonation on the text value of `user.role`:

```typescript
if (impersonatingId && (session.user.role as string) === "admin") {
```

An admin can create a custom role with `name: "admin"` (the role editor enforces `assertNotSystem` but NOT a name-reservation check — `_createRoleForActor` in `editor-internal.ts` accepts any name). When a non-admin user is assigned this custom role, `refreshUserRoleMirror` writes `"admin"` into their `user.role`. On their next session, `session.user.role === "admin"` is true, and they can set the `impersonating_user_id` cookie to impersonate any user — including impersonating an actual system admin.

The `requireRole("admin")` guard in `scopes-actions.ts` and `role-actions.ts` also passes because it checks `session.user.role` via the same text mirror.

**Fix:** Reserve the name "admin" (and optionally "system") in `_createRoleForActor` and `_cloneRoleForActor`:
```typescript
// editor-internal.ts — add before validateRules():
const RESERVED_ROLE_NAMES = new Set(["admin", "ops-it", "read-only", "system"]);
if (RESERVED_ROLE_NAMES.has(input.name)) {
  throw new Error(`Role name "${input.name}" is reserved and cannot be used for custom roles.`);
}
```

Alternatively (defense-in-depth): in `role-mirror.ts`, never write raw custom role names to `user.role`; instead write `null` for any role that is neither system-kind nor a known tier name:
```typescript
} else {
  // Custom roles never map to a privilege-escalating text value.
  mirroredRole = null;
}
```

---

### CR-04: TOCTOU race in `_removeScopeForActor` — external user can reach zero scopes

**File:** `src/app/(app)/settings/users/[id]/scopes-internal.ts:185-197`

**Issue:** The guard that prevents removing the last scope from an external user (lines 185-195) and the DELETE (line 197) are not inside a transaction. Two concurrent requests to remove different scopes from the same external user with exactly two scopes will both pass the `remaining.length <= 1` check (both see 2 rows), then both proceed to delete, leaving zero scopes.

```typescript
// Both requests pass here concurrently (both see remaining.length === 2):
if (remaining.length <= 1) { throw ... }

// Then both reach here and delete their respective row:
await db.delete(userScopes).where(and(eq(userScopes.id, scopeId)));
```

There is no `db.transaction(...)` wrapping this logic.

**Fix:** Wrap the read-check + delete in a single serializable transaction:
```typescript
await db.transaction(async (tx) => {
  const remaining = await tx
    .select({ id: userScopes.id })
    .from(userScopes)
    .where(eq(userScopes.userId, row.userId))
    .for("update"); // row-level lock

  if (remaining.length <= 1) {
    throw new Error(
      "Cannot remove last scope from external user — external users must have at least one scope row",
    );
  }

  await tx.delete(userScopes).where(and(eq(userScopes.id, scopeId)));
});
```

---

## Warnings

### WR-01: Null-unsafe fallback SELECT in `_assignRoleForActor`

**File:** `src/app/(app)/settings/users/[id]/role-internal.ts:175-185`

**Issue:** When `onConflictDoNothing` fires (the `(user_id, role_id)` row already exists), `inserted` is an empty array. The code falls back to a SELECT to retrieve the existing row's ID:

```typescript
const userRoleId =
  inserted[0]?.id ??
  (
    await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1)
  )[0].id;  // ← [0] without null-check; throws TypeError if empty
```

In theory this SELECT should always return the row since it was just confirmed to exist. However under a concurrent DELETE (another admin revokes the role between the failed INSERT and this SELECT), `[0]` is undefined and `.id` throws `TypeError: Cannot read properties of undefined`.

**Fix:**
```typescript
const fallback = await tx
  .select({ id: userRoles.id })
  .from(userRoles)
  .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
  .limit(1);

const userRoleId = inserted[0]?.id ?? fallback[0]?.id;
if (!userRoleId) {
  throw new Error("Failed to obtain userRoleId after upsert — concurrent modification detected");
}
```

---

### WR-02: Non-atomic audit log in `_addScopeForActor` and `_removeScopeForActor`

**File:** `src/app/(app)/settings/users/[id]/scopes-internal.ts:131-144` and `199-215`

**Issue:** Both `_addScopeForActor` and `_removeScopeForActor` call `writeAuditLog(..., db)` with the outer DB connection, not a transaction. If `writeAuditLog` fails (network error, schema mismatch, disk full), the scope change is already committed but goes unrecorded. For `_removeScopeForActor`, this is especially concerning: the scope has been deleted but audit evidence is silently lost.

Compare with `_assignRoleForActor` and `_revokeRoleForActor` in `role-internal.ts` which correctly pass the transaction client `tx` to `writeAuditLog` — both live inside `db.transaction(...)`. The scope helpers lack this wrapper.

**Fix:** Wrap both scope mutation helpers in a `db.transaction(...)` and pass `tx` to `writeAuditLog`, matching the style of `role-internal.ts`:
```typescript
export async function _addScopeForActor(...): Promise<void> {
  // ... auth + validation ...
  await db.transaction(async (tx) => {
    await tx.insert(userScopes).values({...}).onConflictDoNothing({...});
    await writeAuditLog({...}, tx);
  });
}
```

---

### WR-03: `AbilityProvider` reconstructs ability on every render due to array reference inequality

**File:** `src/lib/casl/ability-context.tsx:20-23`

**Issue:** `useMemo` uses `[rules]` as its dependency. `rules` is a `RawRuleOf<AppAbility>[]` array passed from a server component. In Next.js RSC, the server component serializes and deserializes the rules array on every navigation/revalidation — the deserialized array is always a new reference. `useMemo` compares by reference, not deep equality, so the ability is reconstructed on every render cycle where the parent re-renders with fresh rules.

This causes unnecessary work (`createMongoAbility` is not free — it runs rule ordering and indexing) and can cause subtle flicker in UI gates that depend on `Can` if the ability momentarily drops to a stale state mid-hydration.

**Fix:** Stabilize the rules reference with JSON-comparison memoization, or pass a stable JSON string instead of the array:
```typescript
// Option A: JSON string prop (serialize once on server, parse once on client)
export function AbilityProvider({
  rulesJson,
  children,
}: {
  rulesJson: string;
  children: ReactNode;
}) {
  const ability = useMemo(
    () => createMongoAbility<AppAbility>(JSON.parse(rulesJson)),
    [rulesJson],  // string comparison is reference-stable
  );
  ...
}

// Option B: deep-compare via useRef
const rulesRef = useRef<RawRuleOf<AppAbility>[]>([]);
const abilityRef = useRef<AppAbility>(createMongoAbility([]));
const rulesJson = JSON.stringify(rules);
const prevJson = useRef<string>("");
if (prevJson.current !== rulesJson) {
  prevJson.current = rulesJson;
  rulesRef.current = rules;
  abilityRef.current = createMongoAbility<AppAbility>(rules);
}
```

---

## Info

### IN-01: Dead `void defaultDb` / `void user` suppression is a code smell

**File:** `src/app/(app)/settings/users/[id]/role-internal.ts:321-323` and `src/app/(app)/settings/roles/editor-internal.ts:395-397`

**Issue:** Both files import `defaultDb` / `user` and then suppress the "unused import" lint warning with `void defaultDb` / `void user`. The comment in `role-internal.ts` states "import is needed for type compatibility in schema operations even when not referenced directly" — this is unlikely to be true in TypeScript since type-only imports (`import type`) do not affect runtime behavior and do not need to be used to satisfy the runtime. These are runtime imports (not `import type`) that are included purely to avoid linter noise, which is the wrong fix.

**Fix:** Remove the import and `void` statement if it truly is unused at runtime. If it is needed to trigger side effects or to keep Drizzle's column type inference working, document that explicitly. Consider `import type` for type-only dependencies.

---

### IN-02: `ability.ts:22` — unknown user silently defaults to `userType="internal"` before null-check

**File:** `src/lib/casl/ability.ts:22`

**Issue:** `const userType = (u?.userType ?? "internal")` runs before the `if (!u)` null-check on line 32. If `u` is `undefined` (user not found in DB), `userType` is set to `"internal"`. The code then reaches `if (!u)` at line 32 and applies `applyExternalUserInvariant(builder, "external")` — correctly treating the unknown user as external. However the system check at line 27 evaluates `userType === "system"` on the `"internal"` default, which is correctly false. The observable behavior is correct, but the `"internal"` default for an unknown user makes the code misleading: the variable says internal but the null-guard path overrides it to external semantics.

**Fix:** Move the null-check before the `userType` assignment, or use `undefined` (not `"internal"`) as the fallback to make the intent unambiguous:
```typescript
if (!u) {
  applyExternalUserInvariant(builder, "external");
  return builder.build();
}
const userType = u.userType as "internal" | "external" | "system";
// system short-circuit
if (userType === "system" || (u.role as string) === "system") {
  builder.can("manage", "all");
  return builder.build();
}
```

---

---

## Fix Log

All 9 findings resolved. Commits below (branch `worktree-agent-a0ecb202ede2f15bf`, merged to `gsd/phase-10-access-control-extended`):

| Finding | Description | Commit |
|---------|-------------|--------|
| CR-01 | Widen lockout-guard predicate to `system-kind OR name='admin'` | `3b9530b` |
| CR-02 | Add `UNIQUE(role_id,action,subject)` to `role_permissions` via migration 0053 | `2998eec` |
| CR-03 | Reserve role names to block privilege escalation via custom `admin` role | `7bdd50a` |
| CR-04 | Wrap scope removal guard and DELETE in transaction with `FOR UPDATE` | `d355ddb` |
| WR-01 | Add null guard for fallback `userRoleId` after upsert | `c4fffae` |
| WR-02 | Wrap scope audit log in transaction (fixed as part of CR-04) | `d355ddb` |
| WR-03 | Stabilise `AbilityProvider` `useMemo` via JSON string key | `0b3af6d` |
| IN-01 | Remove dead `void` import suppressions (fixed as part of CR-03/WR-01) | `7bdd50a`, `c4fffae` |
| IN-02 | Move null guard before `userType` assignment in `buildAbility` | `6018190` |

_Reviewed: 2026-05-10_
_Reviewer: Claude (adversarial code review — gsd/phase-10-access-control-extended)_
_Depth: deep_
_Fixed: 2026-05-10_
_Fixer: Claude (gsd-code-fixer)_
