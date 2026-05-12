---
phase: 10
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/casl/__tests__/ability.test.ts
  - src/lib/casl/__tests__/seed.test.ts
  - src/lib/casl/__tests__/permitted-fields.test.ts
  - src/lib/casl/__tests__/external-invariant.test.ts
  - src/lib/casl/__tests__/deny-wins.test.ts
  - src/lib/casl/__tests__/subjects.test.ts
  - tests/db/casl-ability.integration.test.ts
  - tests/db/custom-role.integration.test.ts
  - tests/db/lockout-guard.integration.test.ts
  - tests/db/better-auth-admin-plugin.integration.test.ts
  - tests/db/migration-0051-backfill.integration.test.ts
  - tests/access-control/role-editor.spec.ts
  - tests/access-control/user-role-assignment.spec.ts
  - tests/access-control/edit-tier.spec.ts
  - tests/access-control/can-component.spec.ts
  - tests/auth/setup.ts
  - tests/helpers/auth.ts
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "Every Wave 0 RED test exists on disk and FAILS for the right reason (missing module / missing table / missing UI)."
    - "tests/auth/setup.ts exposes seeded TEST_OPS_IT and TEST_VIEWER fixtures alongside TEST_ADMIN — Phase 10 specs that need a non-admin login can call signInAs(page, fixture)."
    - "tests/access-control/ exists as a directory and is reachable by `npx playwright test --list tests/access-control/`."
    - "Vitest unit project picks up src/lib/casl/__tests__/*.test.ts; Vitest integration project picks up tests/db/*.integration.test.ts (no config change needed — existing globs already match)."
  artifacts:
    - path: "src/lib/casl/__tests__/ability.test.ts"
      provides: "Unit RED scaffolds: deny-wins, scope merge, system short-circuit, external invariant"
    - path: "src/lib/casl/__tests__/seed.test.ts"
      provides: "Regression bar — seeded Ops-IT/Read-only rule sets reproduce v1.0 redactSensitiveFields output 1:1"
    - path: "src/lib/casl/__tests__/permitted-fields.test.ts"
      provides: "permittedFieldsOf + fieldsFrom callback contract under undefined-fields rules"
    - path: "src/lib/casl/__tests__/external-invariant.test.ts"
      provides: "external-user banking-strip invariant unconditional regardless of rule data"
    - path: "src/lib/casl/__tests__/deny-wins.test.ts"
      provides: "Explicit-deny-wins precedence across multi-role union"
    - path: "src/lib/casl/__tests__/subjects.test.ts"
      provides: "Registry exhaustiveness — every Subject literal has a SUBJECT_TABLES entry"
    - path: "tests/db/casl-ability.integration.test.ts"
      provides: "Per-(user, role) scope conditions integration test against testcontainers DB"
    - path: "tests/db/custom-role.integration.test.ts"
      provides: "Full custom-role roundtrip: create → assign → check ability"
    - path: "tests/db/lockout-guard.integration.test.ts"
      provides: "Path B SQL inside transaction — refuses save when zero effective admins"
    - path: "tests/db/better-auth-admin-plugin.integration.test.ts"
      provides: "Better Auth set-role / impersonate / ban still gate on user.role text after migration"
    - path: "tests/db/migration-0051-backfill.integration.test.ts"
      provides: "Verifies seed + backfill of user_roles + user_scopes.role_id post-0051"
    - path: "tests/access-control/role-editor.spec.ts"
      provides: "Playwright RED happy-path spec for /settings/roles list + drill-in editor"
    - path: "tests/access-control/user-role-assignment.spec.ts"
      provides: "Playwright RED spec for /settings/users/[id] role assignment block"
    - path: "tests/access-control/edit-tier.spec.ts"
      provides: "Playwright RED spec — admin edits Ops-IT, change applies on next request"
    - path: "tests/access-control/can-component.spec.ts"
      provides: "Playwright RED spec — <Can> hides Merge button for viewer-tier user"
    - path: "tests/auth/setup.ts"
      provides: "TEST_ADMIN + TEST_OPS_IT + TEST_VIEWER fixtures + signInAs(page, fixture) helper"
    - path: "tests/helpers/auth.ts"
      provides: "Re-exports signInAsAdmin (existing) + new signInAsOpsIt + signInAsViewer wrappers"
  key_links:
    - from: "src/lib/casl/__tests__/seed.test.ts"
      to: "src/lib/rbac.test.ts"
      via: "Port every existing redactSensitiveFields assertion 1:1 — that file IS the regression bar"
      pattern: "redact.*Sensitive|bankingDetails|maintenanceFee"
    - from: "tests/db/lockout-guard.integration.test.ts"
      to: "tests/db/user-scopes-actions.integration.test.ts"
      via: "Reuses setupTestDb / teardownTestDb / TestDbContext helpers"
      pattern: "setupTestDb|teardownTestDb"
    - from: "tests/access-control/*.spec.ts"
      to: "tests/auth/setup.ts"
      via: "import { TEST_ADMIN, TEST_OPS_IT, TEST_VIEWER, signInAs } from '../auth/setup'"
      pattern: "signInAs|TEST_ADMIN|TEST_VIEWER"
---

<objective>
Write Wave 0 RED test scaffolds for every Phase 10 verifiable behaviour BEFORE any production code lands. This plan creates the failing-tests harness that Wave 2/3/4 plans drive to GREEN. Plus extends the test-auth fixture set with non-admin seeded users (TEST_OPS_IT, TEST_VIEWER) so e2e specs that need a viewer login can actually sign in — `tests/rbac/viewer-controls.spec.ts` is currently a placeholder because no viewer fixture exists.

Purpose: Per Nyquist validation contract (`workflow.nyquist_validation: true`), every downstream task references an `<automated>` command that points at a test file in scope. Those test files MUST exist before downstream waves run, otherwise the verify gate is "MISSING — Wave 0 must create X first" and the whole plan stalls.

Output: 16 new test files + tests/auth/setup.ts + tests/helpers/auth.ts extensions. None of the 12 test specs PASS — that is correct. They MUST fail for the right reason: missing `@/lib/casl/*` module, missing `roles` table, missing `/settings/roles` route, missing TEST_VIEWER seeded user. All other waves' verify commands point here.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/10-access-control-extended/10-CONTEXT.md
@.planning/phases/10-access-control-extended/10-RESEARCH.md
@.planning/phases/10-access-control-extended/10-PATTERNS.md
@.planning/phases/10-access-control-extended/10-VALIDATION.md

# Existing donor patterns the executor copies from:
@src/lib/rbac.test.ts
@src/lib/scoping/scoped-query.test.ts
@tests/db/user-scopes-actions.integration.test.ts
@tests/db/locations-same-name.integration.test.ts
@tests/auth/setup.ts
@tests/helpers/auth.ts

<interfaces>
<!-- Contracts the executor needs without exploring. Extracted from RESEARCH.md / PATTERNS.md. -->

The shape of buildAbility() that Wave 2 implements (test imports MUST match):

```ts
// src/lib/casl/ability.ts (Wave 2 — does NOT exist yet)
import type { MongoAbility } from "@casl/ability";
export type Action = "manage" | "read" | "create" | "update" | "delete" | "merge" | "impersonate" | "import" | "export" | "silence_alert";
export type Subject = "all" | "Kiosk" | "Location" | "User" | "AuditLog" | "Analytics" | "RolePermission" | "EmailLog" | "LocationProduct" | "Role";
export type AppAbility = MongoAbility<[Action, Subject]>;
export const buildAbility: (userId: string) => Promise<AppAbility>;
```

The shape of fields helpers (Wave 2):

```ts
// src/lib/casl/fields.ts
export function fieldsOfSubject(s: Subject): readonly string[];
export function readableFields(ability: AppAbility, subject: Subject): string[];
```

The shape of external-invariant (Wave 2):

```ts
// src/lib/casl/external-invariant.ts
import { AbilityBuilder } from "@casl/ability";
export function applyExternalUserInvariant(builder: AbilityBuilder<AppAbility>, userType: "internal" | "external" | "system" | string | null): void;
```

The shape of role-mirror (Wave 2):

```ts
// src/lib/casl/role-mirror.ts
type AnyDb = { /* drizzle db shape */ };
export async function refreshUserRoleMirror(userId: string, db?: AnyDb): Promise<void>;
```

The shape of lockout-guard (Wave 2):

```ts
// src/lib/casl/lockout-guard.ts
export const LOCKOUT_PREVENTION = "LOCKOUT_PREVENTION";  // typed sentinel
type AnyDb = { /* drizzle db / tx */ };
export async function assertAtLeastOneEffectiveAdmin(
  db: AnyDb,
  options?: { excludingUserId?: string },
): Promise<void>;  // throws Error(LOCKOUT_PREVENTION) when zero effective admins remain
```

The shape of role server actions (Wave 3):

```ts
// src/app/(app)/settings/roles/actions.ts (Wave 3)
export type RoleListItem = { id: string; name: string; kind: "system" | "tier" | "custom"; displayName: string; description: string | null; assignedUserCount: number; };
export type RoleDetail = { id: string; name: string; kind: "system" | "tier" | "custom"; displayName: string; description: string | null; rules: RawRule[]; };
export type RawRule = { id?: string; action: string; subject: string; fields: string[] | null; conditions: Record<string, unknown> | null; inverted: boolean; };
export async function listRoles(): Promise<{ roles: RoleListItem[] } | { error: string }>;
export async function getRole(roleId: string): Promise<{ role: RoleDetail } | { error: string }>;
export async function createRole(input: { name: string; displayName: string; description?: string; rules: RawRule[]; }): Promise<{ success: true; id: string } | { error: string }>;
export async function replaceRolePermissions(roleId: string, rules: RawRule[]): Promise<{ success: true; impactedUserCount: number } | { error: string } | { status: "lockout_prevention" }>;
export async function deleteRole(roleId: string): Promise<{ success: true } | { error: string } | { status: "lockout_prevention" }>;
```

The shape of user-role server actions (Wave 3):

```ts
// src/app/(app)/settings/users/[id]/role-actions.ts (Wave 3)
export type UserRoleAssignment = { userRoleId: string; roleId: string; roleName: string; roleDisplayName: string; assignedAt: Date; scopes: Array<{ id: string; dimensionType: string; dimensionId: string }>; };
export async function listUserRoles(userId: string): Promise<UserRoleAssignment[]>;
export async function assignRole(userId: string, roleId: string, scopes: Array<{ dimensionType: string; dimensionId: string }>): Promise<{ success: true } | { error: string }>;
export async function revokeRole(userRoleId: string): Promise<{ success: true } | { error: string } | { status: "lockout_prevention" }>;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend tests/auth/setup.ts and tests/helpers/auth.ts with non-admin fixtures</name>
  <files>tests/auth/setup.ts, tests/helpers/auth.ts</files>
  <read_first>
    - tests/auth/setup.ts (full file — donor)
    - tests/helpers/auth.ts (full file — donor; signInAsAdmin lives here)
    - tests/rbac/viewer-controls.spec.ts (existing placeholder; the new fixtures unblock it)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §"Critical Reversals & Gotchas" item 6
  </read_first>
  <action>
    Add the following constants alongside the existing TEST_ADMIN export in `tests/auth/setup.ts` (preserve every existing line):

    ```ts
    export const TEST_OPS_IT = {
      email: process.env.TEST_OPS_IT_EMAIL ?? "ops-it.test@weknowgroup.com",
      password: process.env.TEST_OPS_IT_PASSWORD ?? "OpsItTest!2026",
      name: "Test Ops-IT",
      role: "member" as const,
    };
    export const TEST_VIEWER = {
      email: process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com",
      password: process.env.TEST_VIEWER_PASSWORD ?? "ViewerTest!2026",
      name: "Test Viewer",
      role: "viewer" as const,
    };
    export type TestUserFixture = typeof TEST_ADMIN | typeof TEST_OPS_IT | typeof TEST_VIEWER;
    ```

    Then in `tests/helpers/auth.ts` add new wrappers that mirror the existing `signInAsAdmin` shape (per D-XX scope binding decision — these helpers serve the per-user-role scope tests in Wave 2/3):

    ```ts
    import { TEST_OPS_IT, TEST_VIEWER, type TestUserFixture } from "../auth/setup";

    export async function signInAs(page: Page, fixture: TestUserFixture): Promise<void> {
      // Same flow as signInAsAdmin but parametrised by fixture.email/password.
      // Copy signInAsAdmin's body, replace TEST_ADMIN with fixture.
    }
    export const signInAsOpsIt = (page: Page) => signInAs(page, TEST_OPS_IT);
    export const signInAsViewer = (page: Page) => signInAs(page, TEST_VIEWER);
    ```

    Document at the top of `tests/auth/setup.ts` that the seeding of these fixture rows happens via the migration 0051 backfill (Plan 10-02) — these constants are CONTRACTS the seed must satisfy. The Better Auth credential row creation for these two test users is a separate Wave 1 concern (Plan 10-02 task 5 seeds them via `scripts/seed-test-users.ts` against the test/preview DB only).

    Per CLAUDE.md "Vercel preview env vars": for Playwright runs against the preview alias these credentials must be added to `.env.test` (already supported by signInAsAdmin path); Plan 10-08 documents the operator handoff for adding them to Vercel preview env.

    Do NOT modify any spec file in this task — only the helpers. Specs in subsequent tasks will use these helpers.
  </action>
  <acceptance_criteria>
    - `grep -c "TEST_OPS_IT\|TEST_VIEWER" tests/auth/setup.ts` ≥ 4 (each constant declared + exported)
    - `grep -c "signInAsViewer\|signInAsOpsIt" tests/helpers/auth.ts` ≥ 2
    - `npx tsc --noEmit -p tsconfig.json` passes (no type errors introduced)
    - Existing `tests/rbac/viewer-controls.spec.ts` no longer needs the placeholder comment "no seeded viewer user" — file imports compile
  </acceptance_criteria>
  <verify>
    <automated>grep -v '^//' tests/auth/setup.ts | grep -c "TEST_OPS_IT\|TEST_VIEWER" && grep -v '^//' tests/helpers/auth.ts | grep -c "signInAsViewer\|signInAsOpsIt" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Two new fixture constants exported from setup.ts, two new helper wrappers in helpers/auth.ts, TypeScript clean. The constants are CONTRACTS that Plan 10-02's seed migration must populate.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Write 6 unit-test RED scaffolds in src/lib/casl/__tests__/</name>
  <files>
    src/lib/casl/__tests__/ability.test.ts,
    src/lib/casl/__tests__/seed.test.ts,
    src/lib/casl/__tests__/permitted-fields.test.ts,
    src/lib/casl/__tests__/external-invariant.test.ts,
    src/lib/casl/__tests__/deny-wins.test.ts,
    src/lib/casl/__tests__/subjects.test.ts
  </files>
  <read_first>
    - src/lib/rbac.test.ts (the regression bar — port every assertion to seed.test.ts)
    - src/lib/scoping/scoped-query.test.ts (matrix shape donor)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Common Pitfalls" + §"Code Examples" + §"Validation Architecture > Phase Requirements → Test Map" rows where File Exists = ❌ Wave 0
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §H1 (Unit test matrix excerpt)
  </read_first>
  <behavior>
    Each test file imports from `@/lib/casl/*` modules that DO NOT YET EXIST. These imports MUST fail at load time with a clear "Cannot find module '@/lib/casl/ability'" — that IS the RED signal for Wave 2's GREEN.

    File-by-file behavioural contracts (write tests that EXPRESS these — implementation is Wave 2):

    1. **ability.test.ts** (per RESEARCH §Architecture Patterns Pattern 1):
       - Test: `buildAbility(userId)` for a user with userType='system' returns an ability where `ability.can('manage', 'all')` is true (system short-circuit).
       - Test: A user assigned the seeded 'admin' role gets `manage all` regardless of scope rows (kind='system' bypass).
       - Test: A user assigned only the seeded 'read-only' role cannot `update Location`.
       - Test: `react.cache` memoisation — calling `buildAbility(userId)` twice in the same React render context returns the same ability object reference (use `cache` from React's testing utilities or assert via spy on the underlying DB call count).
       - All tests use vitest's `describe`/`it`/`expect`. Mock the `@/db` import OR use the integration test for DB-touching cases (the integration coverage lives in `tests/db/casl-ability.integration.test.ts`).

    2. **seed.test.ts** — THE REGRESSION BAR:
       - Port every assertion from `src/lib/rbac.test.ts` 1:1. Each `redactSensitiveFields(data, user)` call becomes:
         ```ts
         const ability = buildAbilityFromSeed(role, userType);  // helper that bypasses DB and uses casl/seed.ts directly
         const fields = readableFields(ability, "Location");
         const redacted = pickFields(sampleLocation, fields);
         expect(redacted).toEqual(legacyRedactSensitiveFields(sampleLocation, { role, userType }));
         ```
       - Fixtures: same sample location as rbac.test.ts (4 sensitive keys: bankingDetails, contractValue, contractTerms, contractDocuments + 4 external-additional keys).
       - Roles tested: admin/internal, member/internal, viewer/internal, viewer/external, member/external, admin/external (the full matrix from rbac.test.ts).

    3. **permitted-fields.test.ts** (per RESEARCH §Common Pitfalls #1):
       - Test: with NO can('read', 'Location') rule, `readableFields(ability, 'Location')` returns `[]` (multiplicative behaviour).
       - Test: with `can('read', 'Location')` (undefined fields), `readableFields` returns ALL columns from `getTableColumns(locations)` via the fieldsFrom callback.
       - Test: with `can('read', 'Location')` + `cannot('read', 'Location', ['bankingDetails'])`, `readableFields` returns all columns MINUS bankingDetails.

    4. **external-invariant.test.ts** (per RESEARCH §Common Pitfalls #5):
       - Test: an ability for userType='external' user, even with rule data `can('read', 'Location', ['bankingDetails'])`, MUST return `ability.can('read', { __caslSubjectType__: 'Location' }, 'bankingDetails') === false` after `applyExternalUserInvariant` is applied.
       - Test: same for other sensitive keys: contractValue, contractTerms, contractDocuments, keyContactName, keyContactEmail, financeContact, maintenanceFee.
       - Test: internal users are NOT affected by `applyExternalUserInvariant` (no extra cannot rules appended).

    5. **deny-wins.test.ts** (per RESEARCH §"Code Examples" + Q3 explicit-deny-wins):
       - Test: build an ability with two roles: role A grants `can('update', 'Kiosk')`; role B grants `cannot('update', 'Kiosk', ['outletCode'])`. The union ability MUST allow update on most fields but DENY update on outletCode.
       - Test: deny-wins works across (user, role) pairs, not just within one role.

    6. **subjects.test.ts** (per RESEARCH Q2):
       - Test: every Subject literal in the union has a `SUBJECT_TABLES` entry — iterate `KNOWN_SUBJECTS` array, expect `SUBJECT_TABLES` to have the property.
       - Test: every entry resolves to a Drizzle PgTable — `getTableColumns(table)` returns at least 1 column.
       - Test: `assertValidSubject('NotASubject')` throws with the expected error message shape.

    Imports for ALL six files (will fail in RED — that is the point):
    ```ts
    import { describe, it, expect } from "vitest";
    import { buildAbility, type AppAbility, type Subject, type Action } from "@/lib/casl/ability";
    import { fieldsOfSubject, readableFields } from "@/lib/casl/fields";
    import { applyExternalUserInvariant } from "@/lib/casl/external-invariant";
    import { SUBJECT_TABLES, assertValidSubject } from "@/lib/casl/subjects";
    import { buildSeededAbility } from "@/lib/casl/seed";  // helper for non-DB ability construction in seed.test.ts
    ```

    Failure shape verification: `npx vitest run --project unit src/lib/casl/__tests__/` MUST exit non-zero with errors of the shape "Cannot find module '@/lib/casl/ability'" or "buildAbility is not a function". DO NOT try to make these pass — Wave 2 (Plan 10-03) makes them pass.
  </behavior>
  <action>
    Create all 6 test files following the behavioural contracts above. Use `src/lib/scoping/scoped-query.test.ts:1-103` as the matrix-shape donor and `src/lib/rbac.test.ts:1-164` as the assertion donor for seed.test.ts.

    Convention: each file has a top-level `describe()` named after the module under test. Use `describe.each` / `it.each` for the role × userType matrices (idiom matches `scoped-query.test.ts:32-90`).

    No `vi.mock` of `@/db` in this task — tests are pure-unit and only exercise the ability builder's reasoning over fixture data. The integration tests (Task 3) cover the DB roundtrip. For seed.test.ts, the helper `buildSeededAbility(roleName, userType)` (Wave 2 will export this from `@/lib/casl/seed`) returns an ability built from the in-memory seed rule sets WITHOUT any DB call.

    Failure mode is correct when `npx vitest run --project unit src/lib/casl/__tests__/` exits with code 1 AND every error message references a missing module under `@/lib/casl/`.
  </action>
  <acceptance_criteria>
    - All 6 files exist under `src/lib/casl/__tests__/`
    - Each file has at least 1 `it(...)` block
    - `seed.test.ts` mirrors every test case from `src/lib/rbac.test.ts` (count match: `grep -c "^  \(it\|test\)(" src/lib/rbac.test.ts` ≤ `grep -c "^  \(it\|test\)(" src/lib/casl/__tests__/seed.test.ts`)
    - `npx vitest run --project unit src/lib/casl/__tests__/` exits non-zero (RED)
    - Failure messages all reference missing `@/lib/casl/*` modules — NO syntax errors, NO assertion-style failures yet
  </acceptance_criteria>
  <verify>
    <automated>ls src/lib/casl/__tests__/*.test.ts | wc -l | grep -q "^6$" && (npx vitest run --project unit src/lib/casl/__tests__/ 2>&1 | grep -qE "Cannot find module|Failed to load url.*casl" && echo OK) || echo "FAIL: tests are not failing for the right reason (missing @/lib/casl/* module)"</automated>
  </verify>
  <done>6 RED unit-test scaffolds committed. They fail at module-load time, NOT assertion time. Wave 2 (Plan 10-03) will create the modules and the assertions become the GREEN bar.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Write 5 integration-test RED scaffolds + 4 Playwright RED specs</name>
  <files>
    tests/db/casl-ability.integration.test.ts,
    tests/db/custom-role.integration.test.ts,
    tests/db/lockout-guard.integration.test.ts,
    tests/db/better-auth-admin-plugin.integration.test.ts,
    tests/db/migration-0051-backfill.integration.test.ts,
    tests/access-control/role-editor.spec.ts,
    tests/access-control/user-role-assignment.spec.ts,
    tests/access-control/edit-tier.spec.ts,
    tests/access-control/can-component.spec.ts
  </files>
  <read_first>
    - tests/db/user-scopes-actions.integration.test.ts (the canonical setupTestDb pattern — donor for all 5 integration files)
    - tests/db/locations-same-name.integration.test.ts (DDL/state-assertion shape)
    - tests/settings/business-events.spec.ts (Playwright spec donor)
    - tests/settings/users.spec.ts (action-button assertion donor)
    - tests/access-control/ — directory does NOT exist; create it as part of this task
    - tests/rbac/viewer-controls.spec.ts (the placeholder this task replaces with real specs)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §H2/H3/H4 (test pattern excerpts)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Validation Architecture
  </read_first>
  <behavior>
    Five integration test files (Vitest integration project — DB via testcontainers) and four Playwright specs.

    **tests/db/casl-ability.integration.test.ts** (per RESEARCH §Q1 + AUTH-06 SC1):
    - Setup: seed user, roles (admin/ops-it/read-only via the 0051 seed SQL or programmatic equivalent), user_roles assignment, userScopes per-(user, role).
    - Test: admin user → `buildAbility(adminId)` returns `ability.can('manage', 'all') === true`.
    - Test: ops-it user with userScopes (region=south-west) → `ability.can('read', { __caslSubjectType__: 'Location', regionId: 'south-west' }) === true`, `ability.can('read', { ..., regionId: 'north' }) === false`.
    - Test: viewer user → `ability.can('update', 'Location') === false`.

    **tests/db/custom-role.integration.test.ts** (per AUTH-07 SC4):
    - Setup: admin actor + target user.
    - Test: full roundtrip — create custom role with explicit rules → assign to target user with scope → buildAbility for target user returns those exact rules + scope conditions.

    **tests/db/lockout-guard.integration.test.ts** (per RESEARCH §Q6):
    - Setup: testcontainers DB with one admin user, one non-admin.
    - Test: `assertAtLeastOneEffectiveAdmin(tx)` returns silently when ≥1 admin exists.
    - Test: `revokeRole(adminUserRoleId)` (the only admin's only admin grant) throws `LOCKOUT_PREVENTION` and the transaction rolls back (verify user_roles row still exists).
    - Test: Path B query returns 1 when a custom role grants `manage all`; returns 0 when same role has both `manage all` allow AND inverted `manage all` deny on same role_id.

    **tests/db/better-auth-admin-plugin.integration.test.ts** (per RESEARCH §Q1 backwards-compat):
    - Setup: seed admin user with user.role text='admin' AND user_roles row pointing at the system Admin role.
    - Test: `auth.api.userHasPermission({ body: { userId, permissions: { user: ['set-role'] } }, ...})` returns true (Better Auth reads user.role text).
    - Test: after `assignRole(userId, opsItRoleId)` and `revokeRole(userId, adminRoleId)` (in correct lock-out-safe order on a non-last admin), `user.role` text mirror is updated to 'member' inside the same transaction.
    - Test: removing a user's only admin grant when they are the last admin throws LOCKOUT_PREVENTION; after the throw, `user.role` text is UNCHANGED (mirror update was rolled back).

    **tests/db/migration-0051-backfill.integration.test.ts** (per RESEARCH §"Migration ordering" + Plan 10-02):
    - Setup: testcontainers DB with migration 0050 + 0051 applied, plus pre-seeded users with old `user.role` text values ('admin', 'member', 'viewer').
    - Test: `roles` table contains exactly 3 seed rows (admin/system, ops-it/tier, read-only/tier).
    - Test: `role_permissions` rows exist for ops-it and read-only (count > 0); admin (kind='system') has zero rule rows because it short-circuits.
    - Test: every pre-existing user has a corresponding `user_roles` row pointing at the role matching their old user.role text.
    - Test: `userScopes.role_id` is populated for every pre-existing scope row (zero rows where role_id IS NULL).

    **tests/access-control/role-editor.spec.ts** (per AUTH-07 SC4 — Playwright):
    - signInAsAdmin → goto `/settings/roles` → `expect(getByRole('heading', { level: 1, name: 'Roles' }))` → click "Create role" → fill form (display name, description, single rule: read Location) → submit → assert toast "Role created" → assert new row in role list.

    **tests/access-control/user-role-assignment.spec.ts** (per AUTH-07 — Playwright):
    - signInAsAdmin → goto `/settings/users/{TEST_VIEWER.userId}` (need lookup helper) → assert role-assignment block visible → click "Assign role" → pick Ops-IT → add scope (region=south-west) → submit → assert assignment row appears.

    **tests/access-control/edit-tier.spec.ts** (per AUTH-06 SC2 — Playwright):
    - signInAsAdmin → goto `/settings/roles/{ops-it-id}` → modify a rule (remove read Kiosk) → confirm diff modal → assert "X user(s) impacted" → click Save → assert toast "Saved" → log out → signInAsOpsIt → goto `/kiosks` → assert UI affordance reflects denied access.
    - Note: this spec is the load-bearing "edit-tier-applies-without-deploy" check (SC2). It needs a tear-down step that restores the Ops-IT rules so subsequent specs aren't poisoned.

    **tests/access-control/can-component.spec.ts** (per AUTH-06 SC4 + RESEARCH Q4):
    - signInAsViewer → goto `/locations/{some-existing-location}` → assert `<button>Merge</button>` is NOT visible (Can-component hides it).
    - signInAsAdmin → same URL → assert `<button>Merge</button>` IS visible.
    - signInAsViewer → goto sidebar → assert "Configure" nav-group is NOT visible.

    All Playwright specs include a `pageerror` listener and final `expect(pageErrors).toEqual([])` per the canonical pattern in `tests/settings/business-events.spec.ts:1-18`.

    All 9 specs MUST FAIL at this point — integration ones fail because tables/modules don't exist; Playwright ones fail because routes/components don't exist. That is the RED bar.
  </behavior>
  <action>
    Create `tests/access-control/` directory. Create all 9 files using:
    - `tests/db/user-scopes-actions.integration.test.ts:1-100` as the donor for the 5 integration files (`setupTestDb`, `teardownTestDb`, `beforeAll(120_000)` timeout, `actor` shape, `await ctx.db.insert(...)` seed pattern).
    - `tests/settings/business-events.spec.ts:1-18` and `tests/settings/users.spec.ts:1-23` as donors for the 4 Playwright specs (`signInAsAdmin` import, `pageerror` listener, `getByRole('heading', { level: 1 })` heading assertion, `expect(pageErrors).toEqual([])` final assertion).

    For Playwright specs that need a lookup of TEST_VIEWER's `userId`: use a small helper `getUserIdByEmail(page, email)` defined inline at the top of `user-role-assignment.spec.ts` that hits the existing `/api/admin/users` (or whichever admin endpoint is exposed; if none, hit `auth.api.listUsers` via a server-action through Playwright's `page.request.fetch`). If lookup is genuinely impossible without server-side seed help, leave a TODO and assert via `process.env.TEST_VIEWER_USER_ID` — Plan 10-08 documents the env handoff.

    Do NOT delete `tests/rbac/viewer-controls.spec.ts` — keep it as the v1.0 redaction-parity bar; the new `tests/access-control/can-component.spec.ts` is additive.

    Verify failure mode: `npx vitest run --project integration tests/db/casl-ability.integration.test.ts` exits non-zero with messages mentioning missing `@/lib/casl/*` or missing `roles` table. `npx playwright test --list tests/access-control/` lists 4 specs (lists, doesn't run yet — running comes in Plan 10-08 against the preview alias).
  </action>
  <acceptance_criteria>
    - `tests/access-control/` directory exists with exactly 4 `.spec.ts` files
    - `tests/db/{casl-ability,custom-role,lockout-guard,better-auth-admin-plugin,migration-0051-backfill}.integration.test.ts` all exist
    - `npx playwright test --list tests/access-control/` outputs at least 4 test names with no parse errors
    - `npx vitest run --project integration tests/db/casl-ability.integration.test.ts 2>&1 | head -30` shows missing-module errors (NOT syntax errors)
    - Each Playwright spec has `page.on("pageerror", ...)` and `expect(pageErrors).toEqual([])` (`grep -c "pageerror" tests/access-control/*.spec.ts` ≥ 4)
  </acceptance_criteria>
  <verify>
    <automated>ls tests/access-control/*.spec.ts | wc -l | grep -q "^4$" && ls tests/db/{casl-ability,custom-role,lockout-guard,better-auth-admin-plugin,migration-0051-backfill}.integration.test.ts >/dev/null 2>&1 && npx playwright test --list tests/access-control/ 2>&1 | grep -q "tests/access-control" && (grep -lc "pageerror" tests/access-control/*.spec.ts | wc -l | grep -q "^4$")</automated>
  </verify>
  <done>9 RED specs (5 integration + 4 Playwright) committed. Integration specs fail at module-load or table-not-found; Playwright specs parse and `--list` cleanly but will fail when run because routes/components don't exist yet. Plan 10-08 runs them GREEN against the preview alias as the merge gate.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test fixtures → seeded credential rows | TEST_OPS_IT / TEST_VIEWER passwords seeded in test/preview DBs. Must NOT leak into prod. |
| Playwright `page.request.fetch` → server actions | Specs hit RSC actions during e2e runs; auth gates must hold. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-01-01 | Information Disclosure | TEST_OPS_IT_PASSWORD / TEST_VIEWER_PASSWORD constants | mitigate | Defaults are obvious test values (`OpsItTest!2026`); production uses env vars only via `process.env.TEST_*`; never committed alongside real secrets. Per CLAUDE.md "Aftercare", document in 10-HUMAN-UAT.md that operator must set these via Vercel preview env, not in `.env.local`. |
| T-10-01-02 | Elevation of Privilege | Seeded test users on preview env | accept | Test users live on preview/test DBs only, never prod. Plan 10-02's seed migration explicitly runs only against test/preview connection strings (gate on `process.env.NODE_ENV !== 'production'`). |
| T-10-01-03 | Tampering | Wave 0 RED tests committed before code | accept | RED tests by design fail; CI must allow this until Wave 2 lands. The phase branch `gsd/phase-10-access-control-extended` is not deployed to prod until full GREEN. |
</threat_model>

<verification>
Per VALIDATION.md sampling rate:
- After this plan commits: every test file in `src/lib/casl/__tests__/` and `tests/db/casl-*.integration.test.ts` and `tests/access-control/` MUST be present and FAIL for the right reasons (missing module / missing route — NEVER syntax errors).
- `npx tsc --noEmit -p tsconfig.json` passes despite RED tests (TypeScript is strict — missing-module errors mean tests fail at runtime, not compile).
- `npx playwright test --list tests/access-control/` lists ≥ 4 tests cleanly.
- `nyquist_compliant: true` becomes ACHIEVABLE after this plan; downstream plans can reference these test paths.
</verification>

<success_criteria>
- All 16 test files committed under their canonical paths
- Vitest unit project picks up `src/lib/casl/__tests__/*.test.ts` (RED, NOT broken)
- Vitest integration project picks up `tests/db/casl-*.integration.test.ts` + `tests/db/migration-0051-backfill.integration.test.ts` + `tests/db/lockout-guard.integration.test.ts` + `tests/db/better-auth-admin-plugin.integration.test.ts` (RED, NOT broken)
- Playwright recognises `tests/access-control/` (`--list` returns 4 specs, no parse errors)
- `tests/auth/setup.ts` exports TEST_OPS_IT + TEST_VIEWER; `tests/helpers/auth.ts` exports signInAsOpsIt + signInAsViewer + signInAs(page, fixture)
- `npx tsc --noEmit -p tsconfig.json` clean
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-01-SUMMARY.md` documenting:
- All 16 test files created (paths + brief description of what each tests)
- Confirmation that each fails for the right reason (missing module / missing table / missing route)
- The contract that Plans 10-02..10-08 satisfy by making each test GREEN
- Updates to `tests/auth/setup.ts` + `tests/helpers/auth.ts`
- Note: `nyquist_compliant: true` is now achievable for downstream plans because every `<verify><automated>` will reference an existing test file
</output>
