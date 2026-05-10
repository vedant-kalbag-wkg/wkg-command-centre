---
phase: 10
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - src/lib/casl/types.ts
  - src/lib/casl/subjects.ts
  - src/lib/casl/fields.ts
  - src/lib/casl/external-invariant.ts
  - src/lib/casl/seed.ts
  - src/lib/casl/role-mirror.ts
  - src/lib/casl/lockout-guard.ts
  - src/lib/casl/ability.ts
  - src/lib/casl/ability-context.tsx
  - src/lib/auth/get-user-ctx.ts
  - src/lib/scoping/scoped-query.ts
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "buildAbility(userId) is react.cache-wrapped per-request — N RSC islands hit the DB once (per RESEARCH Anti-Patterns #3)."
    - "userType='system' bypasses CASL entirely: ability granted manage all WITHOUT loading rule rows from DB."
    - "External-user invariant is a CODE-LEVEL guard appended LAST in the AbilityBuilder; rule data CANNOT override it."
    - "permittedFieldsOf integration uses fieldsFrom callback that returns getTableColumns(table) keys — auto-derived registry, ZERO drift from schema (per RESEARCH Q2)."
    - "Multi-role union with explicit-deny-wins: rules with inverted=true subtract from union of allows (CASL native behaviour, NOT a custom semantics layer)."
    - "Per-(user, role) scope rows from userScopes drive CASL conditions on each role's rules — admin sees all, ops-it scoped to assigned regions."
    - "refreshUserRoleMirror(userId, tx) keeps user.role text in lock-step with primary-tier user_roles assignment — Better Auth admin plugin continues to function (RESEARCH Q1)."
    - "assertAtLeastOneEffectiveAdmin(tx) runs Path B SQL inside a transaction; throws Error('LOCKOUT_PREVENTION') when zero users have effective manage all."
    - "UserCtx interface in src/lib/scoping/scoped-query.ts gains an `ability: AppAbility` field (consumed by Plan 10-04 shim); existing callers unaware."
    - "AbilityProvider client component memoises createMongoAbility(rules); Plan 10-07 wraps the layout in it for SSR-safe <Can> hydration."
  artifacts:
    - path: "src/lib/casl/types.ts"
      provides: "Action / Subject literal unions; AppAbility = MongoAbility<[Action, Subject]> type alias"
    - path: "src/lib/casl/subjects.ts"
      provides: "SUBJECT_TABLES Drizzle-table registry; assertValidSubject runtime guard; KNOWN_SUBJECTS array"
    - path: "src/lib/casl/fields.ts"
      provides: "fieldsOfSubject(subject) via getTableColumns; readableFields(ability, subject) wrapping permittedFieldsOf with fieldsFrom callback"
    - path: "src/lib/casl/external-invariant.ts"
      provides: "applyExternalUserInvariant(builder, userType) — appends cannot rules for 4 always-sensitive + 4 external-additional keys"
    - path: "src/lib/casl/seed.ts"
      provides: "DEFAULT_ROLE_RULES { admin, opsIt, readOnly } in-memory; buildSeededAbility(role, userType) for unit tests; getDefaultRulesForRole(name) for migration 0051 parity check"
    - path: "src/lib/casl/role-mirror.ts"
      provides: "refreshUserRoleMirror(userId, tx?) — recomputes user.role text from primary-tier user_roles; PRIMARY_TIER_RANK; runs inside tx when tx supplied"
    - path: "src/lib/casl/lockout-guard.ts"
      provides: "LOCKOUT_PREVENTION sentinel; assertAtLeastOneEffectiveAdmin(tx, options?) Path B SQL"
    - path: "src/lib/casl/ability.ts"
      provides: "buildAbility(userId) react.cache-wrapped; loadGrants/loadScopes; deriveScopeConditions; system short-circuit"
    - path: "src/lib/casl/ability-context.tsx"
      provides: "'use client' AbilityProvider with useMemo(createMongoAbility(rules)); Can = createContextualCan(AbilityContext.Consumer)"
    - path: "src/lib/auth/get-user-ctx.ts"
      provides: "Augmented UserCtx with ability field; calls buildAbility post-session"
    - path: "src/lib/scoping/scoped-query.ts"
      provides: "UserCtx interface widened with `ability: AppAbility` field"
  key_links:
    - from: "src/lib/casl/ability.ts buildAbility"
      to: "user_roles + role_permissions + user_scopes (DB tables from Plan 10-02)"
      via: "single-pass JOIN-then-filter SQL — one round-trip per concern"
      pattern: "leftJoin.*rolePermissions|innerJoin.*roles"
    - from: "src/lib/casl/ability.ts buildAbility"
      to: "src/lib/casl/external-invariant.ts applyExternalUserInvariant"
      via: "called LAST in builder before .build() when userType='external'"
      pattern: "applyExternalUserInvariant\\(builder"
    - from: "src/lib/casl/role-mirror.ts refreshUserRoleMirror"
      to: "user.role text column"
      via: "UPDATE user SET role=<primary-tier-text-mirror> per PRIMARY_TIER_RANK"
      pattern: "UPDATE.*user.*SET.*role|update\\(user\\).set\\(\\{ role:"
    - from: "src/lib/casl/lockout-guard.ts assertAtLeastOneEffectiveAdmin"
      to: "role_permissions inverted=false manage/all rows"
      via: "Path B SQL — count distinct user_id with grant rule AND NOT EXISTS deny rule"
      pattern: "EXISTS.*role_permissions.*action = 'manage'.*subject = 'all'"
    - from: "src/lib/auth/get-user-ctx.ts"
      to: "src/lib/casl/ability.ts buildAbility"
      via: "appended to UserCtx in post-session derivation; same react.cache idiom"
      pattern: "buildAbility\\(.*\\.id\\)"
---

<objective>
Implement the CASL ability-builder core: types, registry, fields helpers, external-user invariant, seed rule sets, role-mirror denormalisation helper, lockout-guard, the per-request `buildAbility(userId)` builder itself, and the SSR-safe `<AbilityProvider>` client component. Augment `getUserCtx` to attach the built ability to `UserCtx`. After this plan, `ability.can(...)` is callable from any RSC, server action, or (via the provider) client island.

Purpose: This is the load-bearing core. RESEARCH §Architecture Patterns lines 116-352 specify the exact shape; PATTERNS.md §B1-B6 + C1 ground every file in a verified analog. Wave 3's call-site cutover (Plan 10-04), admin UI (10-05), and user-role assignment (10-06) all depend on the contracts established here.

Output: 9 new files in `src/lib/casl/`, plus 2 augmentations (`getUserCtx` + `UserCtx` type widen). All 6 of Plan 10-01's `src/lib/casl/__tests__/*.test.ts` RED tests go GREEN. Integration tests `tests/db/casl-ability.integration.test.ts`, `custom-role.integration.test.ts`, `lockout-guard.integration.test.ts`, `better-auth-admin-plugin.integration.test.ts` go GREEN against testcontainers.
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
@.planning/phases/10-access-control-extended/10-01-wave-0-test-scaffolds-PLAN.md
@.planning/phases/10-access-control-extended/10-02-schema-migrations-and-audit-extension-PLAN.md

# Donor patterns:
@src/lib/auth/get-user-ctx.ts
@src/lib/scoping/scoped-query.ts
@src/lib/audit.ts
@src/lib/rbac.ts
@src/lib/location-merge.ts
@src/components/theme-provider.tsx

<interfaces>
<!-- Types and exports the executor implements; Plans 10-04/05/06/07 import these. -->

```ts
// src/lib/casl/types.ts
import type { MongoAbility } from "@casl/ability";

export const ACTIONS = ["manage", "read", "create", "update", "delete", "merge", "impersonate", "import", "export", "silence_alert"] as const;
export type Action = typeof ACTIONS[number];

export const SUBJECTS = ["all", "Kiosk", "Location", "User", "AuditLog", "Analytics", "RolePermission", "EmailLog", "LocationProduct", "Role"] as const;
export type Subject = typeof SUBJECTS[number];

export type AppAbility = MongoAbility<[Action, Subject]>;

// JSON-serializable rule shape — must match what's stored in role_permissions.
export type RawRule = {
  action: Action | string;     // string allows future-proofing; assertValidAction at write time
  subject: Subject | string;   // same
  fields?: string[] | null;
  conditions?: Record<string, unknown> | null;
  inverted?: boolean;
};
```

```ts
// src/lib/casl/subjects.ts
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { kiosks, locations, user, auditLogs, locationProducts, emailLog, roles, rolePermissions } from "@/db/schema";

export const SUBJECT_TABLES = {
  Kiosk: kiosks,
  Location: locations,
  User: user,
  AuditLog: auditLogs,
  LocationProduct: locationProducts,
  EmailLog: emailLog,
  Role: roles,
  RolePermission: rolePermissions,
  // Analytics has no single backing table — handled specially in fields.ts.
} as const satisfies Partial<Record<Subject, AnyPgTable>>;

export const KNOWN_SUBJECTS = SUBJECTS;
export function assertValidSubject(value: string): asserts value is Subject {
  if (!(SUBJECTS as readonly string[]).includes(value)) {
    throw new Error(`Invalid subject: ${value}. Must be one of: ${SUBJECTS.join(", ")}`);
  }
}
export function assertValidAction(value: string): asserts value is Action {
  if (!(ACTIONS as readonly string[]).includes(value)) {
    throw new Error(`Invalid action: ${value}. Must be one of: ${ACTIONS.join(", ")}`);
  }
}
```

```ts
// src/lib/casl/fields.ts
export function fieldsOfSubject(subject: Subject): readonly string[];
export function readableFields(ability: AppAbility, subject: Subject): string[];
```

```ts
// src/lib/casl/external-invariant.ts
import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility } from "./types";

export const ALWAYS_SENSITIVE_KEYS = ["bankingDetails", "contractValue", "contractTerms", "contractDocuments"] as const;
export const EXTERNAL_ADDITIONAL_KEYS = ["keyContactName", "keyContactEmail", "financeContact", "maintenanceFee"] as const;

export function applyExternalUserInvariant(
  builder: AbilityBuilder<AppAbility>,
  userType: "internal" | "external" | "system" | string | null,
): void;
```

```ts
// src/lib/casl/seed.ts
export const DEFAULT_ROLE_RULES: { admin: RawRule[]; opsIt: RawRule[]; readOnly: RawRule[] };

// For unit tests (non-DB) AND for the migration parity check.
export function buildSeededAbility(roleName: "admin" | "ops-it" | "read-only", userType: "internal" | "external"): AppAbility;

// Used by the parity test to confirm 0051 SQL seed matches in-memory rules.
export function getDefaultRulesForRole(roleName: "admin" | "ops-it" | "read-only"): RawRule[];
```

```ts
// src/lib/casl/role-mirror.ts
type AnyDb = { /* drizzle db | tx */ };
export const PRIMARY_TIER_RANK: Record<string, number> = { admin: 0, "ops-it": 1, "read-only": 2 };
export async function refreshUserRoleMirror(userId: string, db?: AnyDb): Promise<void>;
```

```ts
// src/lib/casl/lockout-guard.ts
export const LOCKOUT_PREVENTION = "LOCKOUT_PREVENTION";  // exported sentinel string
type AnyDb = { /* drizzle db | tx */ };
export async function assertAtLeastOneEffectiveAdmin(
  db: AnyDb,
  options?: { excludingUserId?: string },
): Promise<void>;  // throws Error(LOCKOUT_PREVENTION) on violation
```

```ts
// src/lib/casl/ability.ts
import { cache } from "react";
export const buildAbility: (userId: string) => Promise<AppAbility>;
```

```ts
// src/lib/casl/ability-context.tsx
"use client";
import { type RawRuleOf } from "@casl/ability";
export const AbilityContext: React.Context<AppAbility>;
export const Can: ReturnType<typeof createContextualCan>;
export function AbilityProvider(props: { rules: RawRuleOf<AppAbility>[]; children: React.ReactNode }): JSX.Element;
```

UserCtx widen (src/lib/scoping/scoped-query.ts):

```ts
import type { AppAbility } from "@/lib/casl/types";
export type UserCtx = {
  id: string;
  userType: "internal" | "external";
  role: "admin" | "system" | "member" | "viewer" | null;  // text mirror — kept for Better Auth + legacy callers
  ability: AppAbility;  // ← NEW (Plan 10-03)
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create src/lib/casl/{types,subjects,fields,external-invariant,seed}.ts (pure modules — no DB)</name>
  <files>
    src/lib/casl/types.ts,
    src/lib/casl/subjects.ts,
    src/lib/casl/fields.ts,
    src/lib/casl/external-invariant.ts,
    src/lib/casl/seed.ts
  </files>
  <read_first>
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Recommended File Structure" + §"Pattern 1/2" + §Q2 + §"Common Pitfalls" + §"Code Examples"
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §B2/B5 (external-invariant + subjects donor patterns)
    - src/lib/rbac.ts (verbatim sensitive-key list to port into external-invariant.ts ALWAYS_SENSITIVE_KEYS / EXTERNAL_ADDITIONAL_KEYS)
    - src/lib/scoping/scoped-query.ts (literal-union + assertValidDimensionType pattern donor)
    - src/db/schema.ts (the SUBJECT_TABLES registry must reference real tables — verify each entry exists)
  </read_first>
  <behavior>
    Plan 10-01 RED tests these 5 files cover (must turn GREEN after this task):
    - `src/lib/casl/__tests__/subjects.test.ts` — registry exhaustiveness + assertValidSubject throw
    - `src/lib/casl/__tests__/external-invariant.test.ts` — banking strip unconditional for external; internal unaffected
    - `src/lib/casl/__tests__/permitted-fields.test.ts` — fieldsFrom callback contract; deny-wins field-by-field
    - `src/lib/casl/__tests__/seed.test.ts` — full role × userType matrix from rbac.test.ts; ports every assertion
    - `src/lib/casl/__tests__/deny-wins.test.ts` — explicit-deny across multi-role union
  </behavior>
  <action>
    **types.ts** (verbatim from <interfaces> block above): export `ACTIONS`, `Action`, `SUBJECTS`, `Subject`, `AppAbility`, `RawRule`. Per PATTERNS §B5 — `as const` array → `(typeof X)[number]` literal union pattern (matches `scoped-query.ts:35-50`).

    **subjects.ts** (verbatim from <interfaces>): import `SUBJECTS` + needed Drizzle tables; build `SUBJECT_TABLES`; export `KNOWN_SUBJECTS`, `assertValidSubject`, `assertValidAction`. Note: `Analytics` has no single table — leave it OUT of `SUBJECT_TABLES` and special-case in fields.ts. Note: D-XX (CONTEXT) decision lists `RolePermission` as a Subject — bind to `rolePermissions` table (added in Plan 10-02).

    **fields.ts** (per RESEARCH §Pattern 2 lines 280-317):

    ```ts
    import { getTableColumns } from "drizzle-orm";
    import { permittedFieldsOf } from "@casl/ability/extra";
    import type { AppAbility } from "./types";
    import type { Subject } from "./types";
    import { SUBJECT_TABLES } from "./subjects";

    // Auto-derived from Drizzle introspection — single source of truth.
    // Computed once at module-load time; getTableColumns is pure.
    const FIELDS_BY_SUBJECT: Partial<Record<Subject, readonly string[]>> = Object.fromEntries(
      Object.entries(SUBJECT_TABLES).map(([k, t]) => [k, Object.freeze(Object.keys(getTableColumns(t)))]),
    );
    // Analytics has no backing table — empty allowlist; rule must specify fields explicitly.
    FIELDS_BY_SUBJECT.Analytics = Object.freeze([]);

    export function fieldsOfSubject(subject: Subject): readonly string[] {
      return FIELDS_BY_SUBJECT[subject] ?? [];
    }

    export function readableFields(ability: AppAbility, subject: Subject): string[] {
      return permittedFieldsOf(ability, "read", subject, {
        fieldsFrom: (rule) => rule.fields ?? [...fieldsOfSubject(subject)],
      });
    }
    ```

    **external-invariant.ts** — port the verbatim sensitive-key list from `src/lib/rbac.ts:50-62`:

    ```ts
    import type { AbilityBuilder } from "@casl/ability";
    import type { AppAbility, Subject } from "./types";

    export const ALWAYS_SENSITIVE_KEYS = ["bankingDetails", "contractValue", "contractTerms", "contractDocuments"] as const;
    export const EXTERNAL_ADDITIONAL_KEYS = ["keyContactName", "keyContactEmail", "financeContact", "maintenanceFee"] as const;

    // Subjects whose rows can carry these keys. Currently 'Location'.
    const SUBJECTS_WITH_SENSITIVE_KEYS: readonly Subject[] = ["Location"];

    export function applyExternalUserInvariant(
      builder: AbilityBuilder<AppAbility>,
      userType: "internal" | "external" | "system" | string | null,
    ): void {
      if (userType !== "external") return;
      const stripped: string[] = [...ALWAYS_SENSITIVE_KEYS, ...EXTERNAL_ADDITIONAL_KEYS];
      for (const subj of SUBJECTS_WITH_SENSITIVE_KEYS) {
        builder.cannot("read", subj, stripped);
        builder.cannot("update", subj, stripped);
      }
    }
    ```

    Per PATTERNS §B2 + RESEARCH Pitfall 5 — these `cannot` rules are appended LAST in `buildAbility` so deny-wins applies. Defense-in-depth: an admin cannot grant external users banking access via the role editor.

    **seed.ts** — define `DEFAULT_ROLE_RULES` matching migration 0051's seed verbatim (parity test relies on this):

    ```ts
    import { createMongoAbility, AbilityBuilder } from "@casl/ability";
    import type { AppAbility, RawRule } from "./types";
    import { applyExternalUserInvariant } from "./external-invariant";

    export const DEFAULT_ROLE_RULES = {
      // Admin (kind='system') has no rule rows — buildAbility short-circuits with manage all.
      admin: [] as RawRule[],

      // Ops-IT (kind='tier') — mirrors v1.0 internal/member behaviour from rbac.ts.
      opsIt: [
        { action: "read",   subject: "Location",        inverted: false },
        { action: "update", subject: "Location",        inverted: false },
        { action: "read",   subject: "Kiosk",           inverted: false },
        { action: "update", subject: "Kiosk",           inverted: false },
        { action: "create", subject: "Kiosk",           inverted: false },
        { action: "read",   subject: "User",            fields: ["id", "name", "email", "role", "userType", "createdAt"], inverted: false },
        { action: "read",   subject: "AuditLog",        inverted: false },
        { action: "read",   subject: "Analytics",       inverted: false },
        { action: "read",   subject: "EmailLog",        inverted: false },
        { action: "read",   subject: "LocationProduct", inverted: false },
        { action: "update", subject: "LocationProduct", inverted: false },
        { action: "merge",  subject: "Location",        inverted: false },
        { action: "import", subject: "Location",        inverted: false },
        { action: "export", subject: "Analytics",       inverted: false },
        { action: "silence_alert", subject: "Location", inverted: false },
      ],

      // Read-only (kind='tier') — mirrors v1.0 internal/viewer behaviour.
      readOnly: [
        { action: "read", subject: "Location",        inverted: false },
        { action: "read", subject: "Location",        fields: ["bankingDetails", "contractValue", "contractTerms", "contractDocuments"], inverted: true },
        { action: "read", subject: "Kiosk",           inverted: false },
        { action: "read", subject: "User",            fields: ["id", "name", "email", "userType", "createdAt"], inverted: false },
        { action: "read", subject: "AuditLog",        inverted: false },
        { action: "read", subject: "Analytics",       inverted: false },
        { action: "read", subject: "EmailLog",        inverted: false },
        { action: "read", subject: "LocationProduct", inverted: false },
      ],
    } as const;

    export function getDefaultRulesForRole(roleName: "admin" | "ops-it" | "read-only"): RawRule[] {
      if (roleName === "admin") return DEFAULT_ROLE_RULES.admin;
      if (roleName === "ops-it") return DEFAULT_ROLE_RULES.opsIt;
      return DEFAULT_ROLE_RULES.readOnly;
    }

    // For unit tests — builds an ability without any DB call. Mirrors the
    // builder logic in src/lib/casl/ability.ts but takes the rules directly.
    export function buildSeededAbility(
      roleName: "admin" | "ops-it" | "read-only",
      userType: "internal" | "external",
    ): AppAbility {
      const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
      if (roleName === "admin") {
        builder.can("manage", "all");
      } else {
        const rules = getDefaultRulesForRole(roleName);
        for (const r of rules) {
          const target = r.inverted ? builder.cannot : builder.can;
          target.bind(builder)(
            r.action as never,
            r.subject as never,
            r.fields ?? undefined,
            (r.conditions as never) ?? undefined,
          );
        }
      }
      applyExternalUserInvariant(builder, userType);
      return builder.build();
    }
    ```

    The opsIt + readOnly rule arrays MUST match migration 0051 Delta 2/3 EXACTLY — Plan 10-04 includes a parity test (`src/lib/casl/__tests__/seed.test.ts`'s migration-parity case) that compares this in-memory list to the rows the migration would insert.
  </action>
  <acceptance_criteria>
    - All 5 files exist under `src/lib/casl/`
    - `src/lib/casl/types.ts` exports `ACTIONS`, `SUBJECTS`, `Action`, `Subject`, `AppAbility`, `RawRule`
    - `src/lib/casl/subjects.ts` exports `SUBJECT_TABLES`, `KNOWN_SUBJECTS`, `assertValidSubject`, `assertValidAction`
    - `src/lib/casl/external-invariant.ts` exports `ALWAYS_SENSITIVE_KEYS` (4 entries) + `EXTERNAL_ADDITIONAL_KEYS` (4 entries) + `applyExternalUserInvariant`
    - `src/lib/casl/seed.ts` exports `DEFAULT_ROLE_RULES` + `getDefaultRulesForRole` + `buildSeededAbility`
    - All 5 Plan 10-01 unit tests covering these modules go GREEN: `subjects.test.ts`, `external-invariant.test.ts`, `permitted-fields.test.ts`, `seed.test.ts`, `deny-wins.test.ts`
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `grep -c "bankingDetails\|contractValue\|contractTerms\|contractDocuments" src/lib/casl/external-invariant.ts` ≥ 4 (the always-sensitive set)
    - `grep -c "keyContactName\|keyContactEmail\|financeContact\|maintenanceFee" src/lib/casl/external-invariant.ts` ≥ 4
  </acceptance_criteria>
  <verify>
    <automated>ls src/lib/casl/{types,subjects,fields,external-invariant,seed}.ts >/dev/null 2>&1 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project unit src/lib/casl/__tests__/subjects.test.ts src/lib/casl/__tests__/external-invariant.test.ts src/lib/casl/__tests__/permitted-fields.test.ts src/lib/casl/__tests__/seed.test.ts src/lib/casl/__tests__/deny-wins.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>5 pure-module files committed; 5 of 6 Wave-0 unit tests GREEN; tsc clean; the only RED unit test left is `ability.test.ts` (waits on Task 3 — buildAbility itself).</done>
</task>

<task type="auto">
  <name>Task 2: Create src/lib/casl/role-mirror.ts + src/lib/casl/lockout-guard.ts (DB helpers)</name>
  <files>
    src/lib/casl/role-mirror.ts,
    src/lib/casl/lockout-guard.ts
  </files>
  <read_first>
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q1 (refreshUserRoleMirror exact code shape) + §Q6 (lockout-guard Path B SQL)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §B3 (role-mirror analog: audit.ts AnyDb pattern) + §B4 (lockout-guard analog: location-merge sentinel pattern)
    - src/lib/audit.ts (`AnyDb` type pattern + optional db arg with default = singleton)
    - src/lib/location-merge.ts:355-357 (sentinel-throw inside tx pattern)
    - src/app/(app)/locations/merge-action.ts:42-79 (LOCATION_MERGE_LOCK_CONTENTION sentinel handling)
  </read_first>
  <action>
    **role-mirror.ts** (per RESEARCH Q1 lines 634-685 verbatim):

    ```ts
    import { db as defaultDb } from "@/db";
    import { user, roles, userRoles } from "@/db/schema";
    import { eq } from "drizzle-orm";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnyDb = any;

    // Primary-tier ranking — Admin first, then alphabetical. Used to pick the
    // single text mirror value when a user has multiple tier assignments.
    export const PRIMARY_TIER_RANK: Record<string, number> = {
      admin: 0,
      "ops-it": 1,
      "read-only": 2,
    };

    /**
     * Recompute user.role text from the user's primary user_roles assignment.
     *
     * Per RESEARCH.md §Q1: Better Auth's admin plugin reads session.user.role
     * text in 12 endpoint handlers. We keep user.role as the denormalised
     * mirror of the user's PRIMARY tier (admin > ops-it > read-only).
     *
     * Mapping back to Better Auth-compatible text:
     *   Admin (system) → 'admin'
     *   Ops-IT (tier)  → 'member'
     *   Read-only (tier) → 'viewer'
     *   no tier role   → 'member' (Better Auth defaultRole fallback)
     *
     * MUST be called inside the same transaction as any user_roles INSERT/DELETE
     * by passing the transaction handle as the second arg.
     */
    export async function refreshUserRoleMirror(userId: string, db: AnyDb = defaultDb): Promise<void> {
      const grants = await db
        .select({ name: roles.name, kind: roles.kind })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId));

      const tiers = grants
        .filter((g: { kind: string }) => g.kind === "system" || g.kind === "tier")
        .sort((a: { name: string }, b: { name: string }) =>
          (PRIMARY_TIER_RANK[a.name] ?? 99) - (PRIMARY_TIER_RANK[b.name] ?? 99),
        );

      const top = tiers[0]?.name;
      const mirror =
        top === "admin" ? "admin"
        : top === "ops-it" ? "member"
        : top === "read-only" ? "viewer"
        : "member";

      await db.update(user).set({ role: mirror }).where(eq(user.id, userId));
    }
    ```

    **lockout-guard.ts** (per RESEARCH Q6 lines 919-1000 — Path B SQL):

    ```ts
    import { db as defaultDb } from "@/db";
    import { sql } from "drizzle-orm";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnyDb = any;

    // Sentinel error message — callers catch and translate to result envelope
    // `{ status: "lockout_prevention" }`. Mirrors LOCATION_MERGE_LOCK_CONTENTION
    // pattern from src/app/(app)/locations/merge-action.ts.
    export const LOCKOUT_PREVENTION = "LOCKOUT_PREVENTION";

    /**
     * Refuse to commit any operation that would leave the system with zero
     * users having effective `manage all`.
     *
     * Path B SQL (RESEARCH.md §Q6): handles the case where a custom role
     * grants `manage all`. Returns DISTINCT user IDs whose role grants
     * an inverted=false manage/all rule AND has no overriding inverted=true
     * manage/all rule on the same role.
     *
     * Use options.excludingUserId when checking BEFORE a user-deletion
     * (Plan 10-06's removeUser wrap) so the to-be-deleted user does NOT
     * count toward the residual admin coverage.
     *
     * Throws Error(LOCKOUT_PREVENTION) on violation. Callers catch and
     * translate to { status: "lockout_prevention" }.
     */
    export async function assertAtLeastOneEffectiveAdmin(
      db: AnyDb = defaultDb,
      options: { excludingUserId?: string } = {},
    ): Promise<void> {
      const excluding = options.excludingUserId;
      const result = await db.execute(sql`
        SELECT COUNT(DISTINCT ur.user_id)::int AS n
        FROM user_roles ur
        WHERE EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = ur.role_id
            AND rp.action = 'manage' AND rp.subject = 'all' AND rp.inverted = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp2
          WHERE rp2.role_id = ur.role_id
            AND rp2.action = 'manage' AND rp2.subject = 'all' AND rp2.inverted = true
        )
        ${excluding ? sql`AND ur.user_id <> ${excluding}` : sql``}
      `);

      // Driver-portable result extraction — handles postgres-js (rows) vs
      // node-postgres (rows array on `.rows`). Matches existing audit.ts pattern.
      const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown[]);
      const first = (rows as Array<{ n: number }>)[0];
      if (!first || first.n === 0) {
        throw new Error(LOCKOUT_PREVENTION);
      }
    }
    ```

    The driver-portable rows extraction is the same shape as `tests/db/locations-same-name.integration.test.ts` uses — `ctx.pool.query(...).rows` for testcontainers + `db.execute(sql\`...\`)` for prod. The conditional inclusion of the `AND ur.user_id <> ...` clause via `sql\`\`` is the standard Drizzle-pattern for conditional SQL fragments.

    Per PATTERNS §B4: every server action that could reduce admin coverage wraps its DB write inside `db.transaction(async (tx) => { ... assertAtLeastOneEffectiveAdmin(tx); ... })`, and catches the LOCKOUT_PREVENTION sentinel string in the action wrapper to return `{ status: "lockout_prevention" }`.
  </action>
  <acceptance_criteria>
    - `src/lib/casl/role-mirror.ts` exports `refreshUserRoleMirror`, `PRIMARY_TIER_RANK`
    - `src/lib/casl/lockout-guard.ts` exports `assertAtLeastOneEffectiveAdmin`, `LOCKOUT_PREVENTION`
    - Both files use `AnyDb = any` + `db: AnyDb = defaultDb` second-arg pattern (port of audit.ts pattern per PATTERNS §B3)
    - Path B SQL contains `inverted = false` in the EXISTS clause AND `inverted = true` in the NOT EXISTS clause (the deny-wins precondition)
    - Path B SQL conditionally appends `AND ur.user_id <> $1` when `options.excludingUserId` is provided
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `tests/db/lockout-guard.integration.test.ts` GREEN against testcontainers (Plan 10-01 RED scaffold)
    - `tests/db/better-auth-admin-plugin.integration.test.ts` GREEN — refreshUserRoleMirror keeps user.role text in sync after assignRole/revokeRole
  </acceptance_criteria>
  <verify>
    <automated>test -f src/lib/casl/role-mirror.ts && test -f src/lib/casl/lockout-guard.ts && grep -q "export const LOCKOUT_PREVENTION" src/lib/casl/lockout-guard.ts && grep -q "PRIMARY_TIER_RANK" src/lib/casl/role-mirror.ts && grep -q "inverted = false" src/lib/casl/lockout-guard.ts && grep -q "inverted = true" src/lib/casl/lockout-guard.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project integration tests/db/lockout-guard.integration.test.ts tests/db/better-auth-admin-plugin.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>role-mirror + lockout-guard committed; both DB helpers exposed with AnyDb override; Path B SQL with deny-wins precondition + excludingUserId support; tests/db/lockout-guard + better-auth-admin-plugin integration tests GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create src/lib/casl/ability.ts (the buildAbility builder); augment getUserCtx + UserCtx type</name>
  <files>
    src/lib/casl/ability.ts,
    src/lib/auth/get-user-ctx.ts,
    src/lib/scoping/scoped-query.ts
  </files>
  <read_first>
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Architecture Patterns Pattern 1 (lines 194-273 — the verbatim shape) + §"Common Pitfalls" + §Anti-Patterns
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §B1 (analog donor: getUserCtx react.cache + dynamic @/db imports) + §C1 (getUserCtx augmentation diff)
    - src/lib/auth/get-user-ctx.ts (the augmentation target)
    - src/lib/scoping/scoped-query.ts:51-65 (UserCtx interface — widen with ability field)
    - src/lib/casl/types.ts + subjects.ts + external-invariant.ts (types this builder imports)
  </read_first>
  <behavior>
    Plan 10-01 RED tests covered:
    - `src/lib/casl/__tests__/ability.test.ts` — system short-circuit, react.cache memoisation, build with multi-role + scope merge.
    - `tests/db/casl-ability.integration.test.ts` — admin sees all, ops-it scoped to assigned regions, viewer cannot update.
    - `tests/db/custom-role.integration.test.ts` — full custom-role roundtrip.

    Implementation MUST satisfy all of:
    - `react.cache` wrapper (per-request memo — the integration test asserts DB-call count = 1 for N invocations).
    - System short-circuit: userType='system' OR role-text='system' returns `manage all` ability WITHOUT querying user_roles.
    - Admin shortcut: if any of the user's user_roles points at a role with `kind='system'`, grant `manage all` and SKIP iterating user-defined rule rows.
    - Scope merge: per-(user, role) scope rows from `user_scopes` are merged into the rule's `conditions` only for rules from THAT role's permission set. Different roles for the same user get DIFFERENT conditions.
    - External invariant: `applyExternalUserInvariant(builder, userType)` is called LAST before `.build()` — deny-wins guarantees it cannot be overridden by rule data.
  </behavior>
  <action>
    **src/lib/casl/ability.ts** (per RESEARCH lines 194-273):

    ```ts
    import { cache } from "react";
    import { createMongoAbility, AbilityBuilder } from "@casl/ability";
    import type { AppAbility, Action, Subject } from "./types";
    import { applyExternalUserInvariant } from "./external-invariant";

    // Per-request memoisation — N RSC islands hit the DB once per render pass.
    // Same idiom as getUserCtx, getSessionOrThrow, scopedSalesCondition.
    export const buildAbility = cache(async (userId: string): Promise<AppAbility> => {
      // Dynamic imports keep RSC tree-shake intact; matches getUserCtx style.
      const { db } = await import("@/db");
      const { user: userTable, userRoles, rolePermissions, roles, userScopes } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      // 1. Load user (for userType + system bypass).
      const [u] = await db
        .select({ id: userTable.id, userType: userTable.userType, role: userTable.role })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);

      const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
      const userType = (u?.userType ?? "internal") as string;

      // 2. System short-circuit (userType OR text-mirror == 'system'). ETL
      //    cron and scripts pass through here when running with a system
      //    identity; they always get manage all without DB roundtrip.
      if (userType === "system" || (u?.role as string) === "system") {
        builder.can("manage", "all");
        return builder.build();
      }

      if (!u) {
        // Unknown user — empty ability + external invariant for safety
        applyExternalUserInvariant(builder, "external");
        return builder.build();
      }

      // 3. Single-pass load: grants (one row per (user_role, rule)) + scopes.
      const grants = await db
        .select({
          roleId: userRoles.roleId,
          roleKind: roles.kind,
          action: rolePermissions.action,
          subject: rolePermissions.subject,
          fields: rolePermissions.fields,
          conditions: rolePermissions.conditions,
          inverted: rolePermissions.inverted,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .where(eq(userRoles.userId, userId));

      const scopeRows = await db
        .select({
          roleId: userScopes.roleId,
          dim: userScopes.dimensionType,
          id: userScopes.dimensionId,
        })
        .from(userScopes)
        .where(eq(userScopes.userId, userId));

      // 4. System-role short-circuit at the rule-set level — if ANY of the
      //    user's roles is kind='system' (Admin), grant manage all and skip
      //    rule iteration.
      if (grants.some((g) => g.roleKind === "system")) {
        builder.can("manage", "all");
      } else {
        for (const g of grants) {
          if (!g.action || !g.subject) continue;  // role with zero rules
          const target = g.inverted ? builder.cannot : builder.can;
          // Per-(user, role) scope merge — only this role's rules carry this
          // role's scope conditions. Different roles for the same user get
          // different scope shapes.
          const scopeCond = deriveScopeConditions(
            g.subject as Subject,
            scopeRows.filter((s) => s.roleId === g.roleId),
          );
          const mergedConditions =
            scopeCond || g.conditions
              ? { ...((g.conditions as Record<string, unknown>) ?? {}), ...(scopeCond ?? {}) }
              : undefined;
          target.bind(builder)(
            g.action as Action,
            g.subject as Subject,
            (g.fields as string[] | null) ?? undefined,
            mergedConditions as never,
          );
        }
      }

      // 5. External-user invariant — appended LAST so deny-wins applies.
      //    Defense-in-depth: an admin cannot grant external users banking
      //    access via the role editor; this strip is unconditional.
      applyExternalUserInvariant(builder, userType);

      return builder.build();
    });

    // Subject-aware mapping: scope rows → CASL conditions.
    // - Region scope on Location: { regionId: { $in: [...] } }
    // - Region scope on Kiosk: { regionId: { $in: [...] } } (kiosk denormalises regionId via assigned location)
    // - HotelGroup scope on Location: { hotelGroupId: { $in: [...] } }
    // - Location scope on Kiosk: { locationId: { $in: [...] } }
    // - Other dimensions follow same shape — see SCOPE_DIMENSION_TO_FIELD.
    const SCOPE_DIMENSION_TO_FIELD: Partial<Record<Subject, Partial<Record<string, string>>>> = {
      Location:        { region: "regionId",        hotel_group: "hotelGroupId", location: "id",         location_group: "locationGroupId" },
      Kiosk:           { region: "regionId",        hotel_group: "hotelGroupId", location: "locationId", product: "productId",        provider: "providerId" },
      LocationProduct: { product: "productId",     location: "locationId" },
      Analytics:       { region: "regionId",        hotel_group: "hotelGroupId", location: "locationId" },
      // Subjects with no scoped fields (User, AuditLog, EmailLog, Role, RolePermission)
      // do not appear here — their rules carry no scope merge.
    };

    function deriveScopeConditions(
      subject: Subject,
      scopes: Array<{ dim: string | null; id: string }>,
    ): Record<string, unknown> | null {
      const subjMap = SCOPE_DIMENSION_TO_FIELD[subject];
      if (!subjMap || scopes.length === 0) return null;
      // Group by dimension type, emit one $in per dimension.
      const grouped: Record<string, string[]> = {};
      for (const s of scopes) {
        if (!s.dim) continue;
        const field = subjMap[s.dim];
        if (!field) continue;
        (grouped[field] ??= []).push(s.id);
      }
      if (Object.keys(grouped).length === 0) return null;
      const cond: Record<string, unknown> = {};
      for (const [field, ids] of Object.entries(grouped)) {
        cond[field] = { $in: ids };
      }
      return cond;
    }
    ```

    **Augment src/lib/auth/get-user-ctx.ts** (per PATTERNS §C1):

    Append to BOTH return paths (the impersonation branch + the default branch):

    ```ts
    // After: const target = await db.select(...) ... in impersonation branch
    if (target) {
      const { buildAbility } = await import("@/lib/casl/ability");
      const ability = await buildAbility(target.id);
      return {
        id: target.id,
        userType: (target.userType ?? "internal") as "internal" | "external",
        role: (target.role ?? null) as "admin" | "system" | "member" | "viewer" | null,
        ability,  // ← NEW
      };
    }

    // Default branch
    const { buildAbility } = await import("@/lib/casl/ability");
    const ability = await buildAbility(session.user.id);
    return {
      id: session.user.id,
      userType: ((session.user as unknown as { userType: "internal" | "external" }).userType ?? "internal"),
      role: (session.user.role ?? null) as "admin" | "system" | "member" | "viewer" | null,
      ability,  // ← NEW
    };
    ```

    Use dynamic `await import("@/lib/casl/ability")` to mirror the existing dynamic `await import("@/db")` pattern (preserves RSC tree-shake; auth/sign-in flows that don't render content avoid pulling CASL).

    **Widen UserCtx in src/lib/scoping/scoped-query.ts:**

    Locate the `UserCtx` type definition (around line 51). Add the new field:

    ```ts
    import type { AppAbility } from "@/lib/casl/types";

    export type UserCtx = {
      id: string;
      userType: "internal" | "external";
      role: "admin" | "system" | "member" | "viewer" | null;
      ability: AppAbility;  // ← NEW (Plan 10-03)
    };
    ```

    Existing callers do NOT need changes yet — they ignore the new field. Plan 10-04's shim cutover starts consuming it.

    **Caveat:** if any existing test fixture creates a `UserCtx` literal without `ability`, that test will break at compile time. The fix is: add `ability: createMongoAbility([])` to the fixture (an empty ability — denies everything). Document any such fixes in the SUMMARY. Search-and-fix pattern: `grep -rn "userType.*role.*null\b" --include="*.test.ts" src/` to find candidates.
  </action>
  <acceptance_criteria>
    - `src/lib/casl/ability.ts` exports `buildAbility` wrapped in `cache()` from React
    - File contains the system short-circuit on `userType === "system"`
    - File contains the kind='system' short-circuit on grants
    - File calls `applyExternalUserInvariant(builder, userType)` immediately before `builder.build()`
    - File contains `SCOPE_DIMENSION_TO_FIELD` registry with at least Location, Kiosk, LocationProduct, Analytics entries
    - `src/lib/auth/get-user-ctx.ts` calls `buildAbility(...)` and includes `ability` in BOTH return paths (impersonation + default)
    - `src/lib/scoping/scoped-query.ts` UserCtx widened with `ability: AppAbility`
    - `npx tsc --noEmit -p tsconfig.json` exits 0 (any test fixture lacking `ability` is fixed in this same task)
    - All 6 Plan 10-01 unit tests in `src/lib/casl/__tests__/` GREEN
    - `tests/db/casl-ability.integration.test.ts` and `tests/db/custom-role.integration.test.ts` GREEN
    - Existing `src/lib/scoping/scoped-query.test.ts` and `src/lib/rbac.test.ts` still GREEN (no regression)
  </acceptance_criteria>
  <verify>
    <automated>test -f src/lib/casl/ability.ts && grep -q "export const buildAbility = cache" src/lib/casl/ability.ts && grep -q "applyExternalUserInvariant" src/lib/casl/ability.ts && grep -q "SCOPE_DIMENSION_TO_FIELD" src/lib/casl/ability.ts && grep -q "buildAbility" src/lib/auth/get-user-ctx.ts && grep -q "ability: AppAbility" src/lib/scoping/scoped-query.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project unit src/lib/casl/__tests__/ 2>&1 | tail -5 | grep -qE "6 passed|all.*passed" && npx vitest run --project integration tests/db/casl-ability.integration.test.ts tests/db/custom-role.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>buildAbility wired with react.cache + system short-circuits + scope merge + external invariant; getUserCtx populates ability in both return paths; UserCtx widened. All 6 unit tests + 2 of the 5 integration tests GREEN. Plan 10-04 inherits a working ability for shim cutover.</done>
</task>

<task type="auto">
  <name>Task 4: Create src/lib/casl/ability-context.tsx ('use client' AbilityProvider for SSR-safe Can hydration)</name>
  <files>src/lib/casl/ability-context.tsx</files>
  <read_first>
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Architecture Patterns Pattern 3 (lines 320-352 — verbatim shape) + §Q4
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §B6 (analog: src/components/theme-provider.tsx — only existing 'use client' provider)
    - src/components/theme-provider.tsx (donor)
  </read_first>
  <action>
    Verbatim port of RESEARCH §Pattern 3:

    ```tsx
    "use client";

    import { createContext, useMemo, type ReactNode } from "react";
    import { createMongoAbility, type RawRuleOf } from "@casl/ability";
    import { createContextualCan } from "@casl/react";
    import type { AppAbility } from "./types";

    // Default ability denies everything — used until the provider initialises.
    export const AbilityContext = createContext<AppAbility>(createMongoAbility([]));

    // <Can I="manage" a="all">...</Can> — consumes from AbilityContext.
    // Re-export so callers import { Can } from "@/lib/casl/ability-context".
    export const Can = createContextualCan(AbilityContext.Consumer);

    /**
     * Wraps the client tree with an Ability built from the rules the RSC
     * server-rendered. Per RESEARCH.md Pitfall 3: the rules MUST be the same
     * snapshot the server used, otherwise <Can> flickers between server-render
     * (visible) and hydration (hidden).
     *
     * Plan 10-07 wraps src/app/(app)/layout.tsx in this provider, passing
     * ctx.ability.rules from getUserCtx().
     */
    export function AbilityProvider({
      rules,
      children,
    }: {
      rules: RawRuleOf<AppAbility>[];
      children: ReactNode;
    }) {
      const ability = useMemo(() => createMongoAbility<AppAbility>(rules), [rules]);
      return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>;
    }
    ```

    The `useMemo` on `[rules]` is load-bearing — without it, the client rebuilds the ability on every render even when rules haven't changed. RESEARCH §Anti-Patterns flags per-island re-derivation as a regression risk.

    Per PATTERNS §B6: theme-provider.tsx is a minimal pass-through; this file extends with the `useMemo` over `createMongoAbility(rules)` per RESEARCH Pattern 3.
  </action>
  <acceptance_criteria>
    - `src/lib/casl/ability-context.tsx` exists with `"use client";` directive at the top
    - File exports `AbilityContext`, `Can`, `AbilityProvider`
    - `Can` is created via `createContextualCan(AbilityContext.Consumer)`
    - `AbilityProvider` uses `useMemo(() => createMongoAbility<AppAbility>(rules), [rules])`
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx next build` (or equivalent type-check that exercises 'use client' boundaries) does not error on the new file
    - Plan 10-07 (Wave 4) can import `{ Can, AbilityProvider } from "@/lib/casl/ability-context"`
  </acceptance_criteria>
  <verify>
    <automated>test -f src/lib/casl/ability-context.tsx && head -1 src/lib/casl/ability-context.tsx | grep -q '"use client"' && grep -q "createContextualCan" src/lib/casl/ability-context.tsx && grep -q "useMemo" src/lib/casl/ability-context.tsx && grep -q "createMongoAbility<AppAbility>(rules)" src/lib/casl/ability-context.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>AbilityProvider client component shipped per RESEARCH Pattern 3; useMemo over rules; Can re-exported via createContextualCan(Consumer). Plan 10-07 layer-wraps the app layout with this provider in Wave 4.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `getUserCtx().ability.can(...)` | Per-request capability check; every server action MUST call this. Bypass is privilege escalation. |
| `applyExternalUserInvariant` LAST in builder | Deny-wins guarantees no allow-rule overrides. Reordering is a Sev-1. |
| `react.cache(buildAbility)` | Per-request memo. Skipping the cache means N DB hits per render — perf, not security. |
| `refreshUserRoleMirror` inside tx | Lock-step with user_roles writes. Skipping leaves user.role text stale → Better Auth admin endpoints break. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-03-01 | Elevation of Privilege | External user gains banking access via custom role rule data | mitigate | `applyExternalUserInvariant` is appended LAST in `buildAbility` after rule iteration. CASL deny-wins guarantees no allow can override. Unit test `external-invariant.test.ts` enforces the invariant against rule data attempting the bypass. |
| T-10-03-02 | Spoofing | Stale ability after role assignment change mid-session | mitigate | `react.cache` is per-request, not per-session. Next request after assignRole/revokeRole rebuilds ability fresh. Documented in 10-HUMAN-UAT.md operator note: "role changes take effect on next request, not mid-render". |
| T-10-03-03 | Information Disclosure | RawRule[] sent to client via SSR contains scope IDs (UUIDs) | accept | Scope IDs are not secret; the user already knows their own scope from page renders. Audit-log captures any rule changes (Plan 10-05). |
| T-10-03-04 | Tampering | Client tampers with rules in the AbilityProvider context | accept | Server actions ALWAYS re-check ability on the server. Client-side `<Can>` is UX, never security. RESEARCH §Threat Patterns "Server-action bypass via direct fetch (skipping `<Can>` UI gate)" — every action calls `requireRole`/`getUserCtx().ability.can(...)` server-side. |
| T-10-03-05 | Repudiation | Ability built from stale `react.cache` due to deployment-time bug | mitigate | Cache is per-request via React.cache; bound to a single render pass. Across deploys (which terminate the runtime), there is no shared cache. Verified by Plan 10-01's `ability.test.ts` reference-equality assertion. |
| T-10-03-06 | Denial of Service | buildAbility runs on every RSC island instead of once per request | mitigate | `cache(...)` wrapper from React. Plan 10-01's `ability.test.ts` includes a counter on the underlying DB query to assert at-most-1 hit per request. |
| T-10-03-07 | Tampering | refreshUserRoleMirror not called inside tx, leading to user.role drift on rollback | mitigate | Plan 10-06 server actions wrap user_roles writes inside `db.transaction(async (tx) => { ... refreshUserRoleMirror(userId, tx); ... })`. Tests/db/better-auth-admin-plugin.integration.test.ts asserts mirror is rolled back on lockout-throw. |
</threat_model>

<verification>
- All 6 Plan 10-01 unit tests in `src/lib/casl/__tests__/*.test.ts` GREEN
- `tests/db/casl-ability.integration.test.ts`, `custom-role.integration.test.ts`, `lockout-guard.integration.test.ts`, `better-auth-admin-plugin.integration.test.ts` GREEN
- `npx tsc --noEmit -p tsconfig.json` exits 0
- Existing `src/lib/scoping/scoped-query.test.ts` + `src/lib/rbac.test.ts` still GREEN (UserCtx widen is backwards-compatible — old fixtures must be updated to include `ability: createMongoAbility([])` for compile)
- `grep -c "applyExternalUserInvariant" src/lib/casl/ability.ts` ≥ 1 AND it appears AFTER all rule-iteration loops (verify by line numbers)
- `grep -c "cache(" src/lib/casl/ability.ts` ≥ 1 (react.cache wrapping)
</verification>

<success_criteria>
- 9 new files in `src/lib/casl/`: types, subjects, fields, external-invariant, seed, role-mirror, lockout-guard, ability, ability-context
- `getUserCtx` populates `ability` in both impersonation and default return paths
- `UserCtx` interface widened in `scoped-query.ts`
- All 6 Plan 10-01 unit tests + 4 of the 5 integration tests GREEN (the 5th, `migration-0051-backfill`, was made GREEN by Plan 10-02)
- `npx tsc --noEmit -p tsconfig.json` clean
- Existing test fixtures updated where needed to include the new `ability` field
- No regression in scoping, rbac, or auth tests
- Plan 10-04 has a working `ctx.ability` to wire the shim against
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-03-SUMMARY.md` documenting:
- 9 new files in `src/lib/casl/` with brief role descriptions
- The `UserCtx` widen with `ability: AppAbility`
- The `getUserCtx` augmentation diff (both return paths)
- List of any test fixtures updated to include `ability: createMongoAbility([])`
- Status of Plan 10-01's RED tests: 6 unit GREEN, 4 of 5 integration GREEN; the only RED tests left are the 4 Playwright specs in `tests/access-control/` (depend on Plan 10-05/06/07 UI)
- Confirmation of the THREE load-bearing invariants:
  1. external-invariant appended LAST in builder (line number)
  2. react.cache wrapper around buildAbility (line number)
  3. system userType OR system role short-circuits BEFORE any rule iteration (line numbers)
</output>
