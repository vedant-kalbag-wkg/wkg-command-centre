# Phase 10: Access Control Extended — Research

**Researched:** 2026-05-10
**Domain:** RBAC migration to CASL with DB-backed JSON rules + admin authoring UI
**Confidence:** HIGH (verified against installed Better Auth 1.5.5, CASL 6.8.1/6.0.0 source on npm, codebase grep of all 59 RBAC call sites)

## Summary

The phase has three load-bearing technical risks the planner must address up-front: (1) Better Auth's `admin` plugin reads `user.role` text in 11+ endpoint handlers (`set-role`, `impersonate`, `ban`, `userHasPermission`, every endpoint that gates on `adminRoles`), so dropping `user.role` mid-phase would break invite/role-set/impersonation flows; (2) `permittedFieldsOf` is NOT field-aware on its own — CASL requires the caller to provide a `fieldsFrom` callback that returns the universe of fields when a rule lacks an explicit `fields` list, which means we MUST maintain a `subject → fields[]` registry; (3) every one of the 59 files using `requireRole` / `redactSensitiveFields` / `canAccessSensitiveFields` must either be migrated in lock-step with the schema cutover OR receive temporary signature-preserving shims that delegate to the new Ability internally.

The IAM-style multi-role model with explicit-deny-wins is natively supported by CASL (rules with `inverted: true` are evaluated last and subtract from the allow set), so no custom semantics layer is needed. `userScopes` evolves to per-(user, role, dimension) and is loaded once per request, then translated to CASL `conditions` (e.g. `{ regionId: { $in: [...] } }`) per role inside the Ability builder. The existing `scopedSalesCondition` / `scopedLocationsCondition` SQL-emitting helpers stay — they're the source of truth for the analytics WHERE clauses; CASL `conditions` are an adjacent representation for non-SQL gates (`ability.can('read', kiosk)` on a hydrated row).

**Primary recommendation:** Land in three Drizzle migrations within one PR (schema → seed/backfill → drop old behaviour), preserve `user.role` text as a denormalised mirror authoritative-by-`user_roles`, and migrate all 59 call sites in the same PR via a temporary re-export shim layer in `src/lib/rbac.ts` that delegates to `getUserCtx().ability` so the working tree never has both APIs live.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ability building (rule load + scope merge) | API / Backend (`src/lib/auth/get-user-ctx.ts`) | — | Per-request derivation; needs DB access; React.cache wraps once-per-render |
| Permission check at server actions | API / Backend | — | Every existing `requireRole` site; never trust client-side gates |
| Permission check at RSC pages | Frontend Server (RSC) | — | RSC can call `getUserCtx()` directly — same-process, no client roundtrip |
| Permission check at client islands (`<Can>` gates) | Browser / Client | API / Backend (rules serialized via SSR) | Hide UI affordances; server still re-checks on action |
| Rule storage | Database (`role_permissions` jsonb) | — | Editable without deploy is the success criterion |
| Role authoring UI (`/settings/roles`) | Frontend Server (RSC for list) + Browser (form) | API / Backend (server actions write rules) | Same pattern as `/settings/outlet-types` etc. |
| User → role assignment + scope binding | API / Backend (server action) | Browser (form) | Lives on `/settings/users/[id]` (currently has no page.tsx — to be created) |
| Better Auth admin endpoints (set-role, impersonate, ban) | API / Backend (Better Auth plugin) | — | Plugin reads `user.role` text — `user.role` MUST stay populated |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Rules persistence:**
- Hybrid schema: `roles(id, name, kind: 'system'|'tier'|'custom', display_name, description)` + `role_permissions(role_id, action, subject, fields jsonb, conditions jsonb, inverted bool)`.
- Edit semantics: replace-all on save (DELETE + INSERT in one transaction). Whole-set diff captured in `auditLogs`.
- Conditions wiring: **Option B** — rule rows are scope-agnostic; the Ability builder layers in derived scope rules from per-(user, role) scope assignments.
- Subject + action taxonomy: CRUD + named domain actions: `{ read, create, update, delete, merge, impersonate, import, export, silence_alert }`. Subjects PascalCase (`Kiosk`, `Location`, `User`, `AuditLog`, `Analytics`, `RolePermission`, `EmailLog`, ...).

**Default tier mapping + role identity:**
- Admin = `kind='system'`, uneditable, always grants `manage all`.
- Ops-IT and Read-only ship as `kind='tier'` editable seed rows.
- Replace `user.role` text column with `user.role_id` FK in one migration. Backfill: `'admin' → Admin`, `'member' → Ops-IT`, `'viewer' → Read-only`. **OVERRIDDEN BELOW BY RESEARCH FINDINGS — see Q1 / Q3.**
- `system` userType bypasses CASL entirely (`getUserCtx` short-circuits).
- External-user invariant is a code-level guard in the Ability builder, NOT in rule data.

**Custom-role assignment model:**
- IAM-style multi-role: `user_roles(user_id, role_id, assigned_at, assigned_by)`.
- Scope attaches at assignment time. `userScopes` evolves to per-(user, role, dimension): `(user_id, role_id, dimension_type, dimension_id)`.
- Conflict resolution: explicit-deny-wins (rules with `inverted: true` subtract from union of allows).

**Admin-UI authoring shape:**
- Form-driven GUI; no raw JSON editor in v1.1.
- Page at `/settings/roles`, sibling to `/settings/users`. List view → drill into role for rule editor. User-to-role assignment stays on `/settings/users/[id]`.
- Save safety: diff preview + impacted-users count + confirmation modal.

### Claude's Discretion
- Concrete Drizzle migration ordering inside the PR (research recommends three sequential SQL files; see Q3).
- Concrete shape of `role_permissions.fields` and `.conditions` jsonb (see "Drizzle JSONB shape" below).
- The `subject → fields[]` registry implementation (research recommends auto-derived via `getTableColumns`; see Q2).
- `<Can>` migration scope (research recommends 5 client-side gates migrate; the rest stay server-only — see Q4).
- Concrete audit-log `details` jsonb shapes (see Q5).
- Lock-out validation query implementation (see Q6).

### Deferred Ideas (OUT OF SCOPE)
- Raw JSON rule editor (form-driven only in v1.1).
- Impersonation simulator preview.
- UI-layer protected-tier guards beyond `kind='system'` data-layer enforcement.
- Group / hierarchy / role-inheritance.
- Multi-tenant role isolation (per-`hotel_group` role authoring scope).
- Better Auth plugin authoring (a custom CASL Better Auth plugin).
- SSO / external IdP.
- Time-bound role grants (`assigned_until`).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-06 | Configurable Ops/IT/Read-only RBAC tiers via CASL. Rules stored as JSON in DB; admin UI for editing tier permissions without deploy. `redactSensitiveFields` migrates to `permittedFieldsOf(ability, 'read', subject)`. Existing `userScopes` preserved (feeds CASL `conditions`). | Standard Stack (CASL 6.8.1 verified npm-current); Architecture Patterns (Ability builder); Code Examples (`createMongoAbility`, `permittedFieldsOf`, `getTableColumns`); Atomicity migration plan (Q3). |
| AUTH-07 | Custom granular roles authorable in admin UI. Per-role rule set (subjects × actions × fields × conditions). Role assignment per-user; UI for creating/editing/cloning roles. | Architecture Patterns (`/settings/roles` page tree); Code Examples (form-driven rule editor shape); Audit-log shapes (Q5); Lock-out validation (Q6). |

## Standard Stack

### Core (verified against npm registry 2026-05-10)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@casl/ability` | `^6.8.1` | Build per-request `Ability` from JSON rules; native `fields` + `conditions` | [VERIFIED: `npm view @casl/ability version` → `6.8.1`]; only sane lib for runtime-configurable RBAC with field-level + conditional rules. Already locked at v1.1 scoping (`REQUIREMENTS.md` D-row). |
| `@casl/react` | `^6.0.0` | `<Can>` component + `createContextualCan` factory + `useAbility` hook for client gates | [VERIFIED: `npm view @casl/react version` → `6.0.0`]; peer-dep `react: ^18.0.0 \|\| ^19.0.0` confirms React 19 support. |

### Already installed (reused — no new dep)
| Library | Version | Purpose |
|---------|---------|---------|
| `better-auth` | `^1.5.5` | Session + admin plugin (set-role, ban, impersonate, userHasPermission) |
| `drizzle-orm` | `^0.45.1` | Schema, migrations, `getTableColumns` introspection |
| `react-hook-form` | `^7.71.2` | Admin role editor form state |
| `zod` | `^4.3.6` | Server-action input validation |

### Alternatives Considered (rejected)
| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `@casl/ability` | `casbin` | Policy DSL hostile to non-engineer admin authoring (per `.planning/research/v1.1-rbac-model.md`). |
| `@casl/ability` | `accesscontrol-js` | Stale (no release in 2+ years); flat attribute filters; no native conditions. |
| `@casl/ability` | hand-rolled `can()` | Re-creates CASL badly; locks AUTH-06 behind code deploy. |
| `customSession` plugin | augment Better Auth session | Not needed — CASL Ability is built post-session in `getUserCtx`, never serialized into session cookie. Keeps the integration boundary thin. |
| `@casl/mongoose` | — | Wrong DB; we use Drizzle + Postgres. The MongoDB-style condition language is a CASL-internal detail (`@ucast/mongo2js`), not a Mongo dependency. |

**Installation (single command, no peer-dep gotchas, no lockfile risk on macOS — these have no native bindings):**
```bash
npm install @casl/ability@^6.8.1 @casl/react@^6.0.0
```

**Verification of latest stable (run before locking version in `package.json`):**
```bash
npm view @casl/ability version  # expect 6.8.1 (or newer patch); check publish date
npm view @casl/react version    # expect 6.0.0
```

## Architecture Patterns

### System Architecture Diagram

```
HTTP request (cookie session)
        │
        ▼
   Better Auth getSession()  ──► reads user.role TEXT (admin plugin needs it)
        │                           │
        ▼                           ▼
   getUserCtx() [react.cache]   Better Auth admin endpoints (set-role/ban/impersonate)
        │                           gated on adminRoles: ["admin"] vs user.role
        │
        ▼
   buildAbility(userId)  ──► query user_roles → role_permissions → userScopes
        │                    │
        │                    ├── for each (user_role) row:
        │                    │   - load role.permissions (raw rules)
        │                    │   - load (user, role)-bound userScopes rows
        │                    │   - emit derived scope-condition rules
        │                    │
        │                    ├── apply external-user invariant (code-level)
        │                    │   strip {bankingDetails, contractValue, ...} from rules
        │                    │
        │                    └── new AbilityBuilder(createMongoAbility) → ability
        ▼
   UserCtx { id, userType, role, ability }   [cached for the request]
        │
        ├──► server action: ability.can('update', kiosk, 'pipelineStage')   → boolean
        ├──► server action: permittedFieldsOf(ability, 'read', 'Location', { fieldsFrom }) → string[]
        ├──► RSC page: <Can I="merge" a="Location" ability={ability}>...</Can>
        │
        └──► client island: ability.rules JSON serialized via SSR boundary
                                     │
                                     ▼
                            <AbilityProvider value={createMongoAbility(rules)}>
                              <Can ability={...} I="merge" a="Location">{...}</Can>
                            </AbilityProvider>
```

### Recommended File Structure
```
src/lib/casl/
├── ability.ts              # buildAbility(userId, db) — main builder
├── subjects.ts             # PascalCase subjects + Drizzle table registry
├── fields.ts               # auto-derived field lists via getTableColumns
├── external-invariant.ts   # hardcoded sensitive-key set + applyExternalUserInvariant()
├── seed.ts                 # default rules for Admin / Ops-IT / Read-only tiers
├── ability-context.tsx     # 'use client' AbilityProvider + Can = createContextualCan
└── __tests__/
    ├── ability.test.ts     # builder unit tests (deny-wins, scope merge, external invariant)
    └── seed.test.ts        # tier defaults match v1.0 behaviour (regression bar)

src/lib/rbac.ts             # KEPT: signatures preserved as shims delegating to ability
src/lib/auth/get-user-ctx.ts # AUGMENTED: appends ability to UserCtx

src/app/(app)/settings/roles/
├── page.tsx                # role list (RSC)
├── role-list-client.tsx    # client island: list + clone button
├── [id]/
│   ├── page.tsx            # role detail (RSC; loads rules)
│   ├── role-editor-client.tsx  # form-driven editor (react-hook-form)
│   ├── actions.ts          # 'use server' wrappers (requireRole replacement)
│   └── editor-internal.ts  # extracted helpers (Turbopack-server-action shape)
└── new/
    └── page.tsx            # create role flow

src/app/(app)/settings/users/[id]/
├── page.tsx                # NEW — currently missing; user-edit lands here
├── role-assignment-client.tsx  # multi-role + scope-per-assignment picker
├── role-actions.ts         # 'use server' assign/revoke wrappers
└── role-internal.ts        # extracted helpers (matches scopes-internal.ts pattern)
```

### Pattern 1: Per-request Ability with React.cache

```ts
// src/lib/casl/ability.ts
import { cache } from "react";
import { createMongoAbility, AbilityBuilder, type MongoAbility } from "@casl/ability";
import { db } from "@/db";
import { userRoles, rolePermissions, roles, userScopes, user as userTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { applyExternalUserInvariant } from "./external-invariant";

export type AppAbility = MongoAbility<[string, string]>;

export const buildAbility = cache(async (userId: string): Promise<AppAbility> => {
  // 1. Load user (for userType)
  const [u] = await db
    .select({ id: userTable.id, userType: userTable.userType })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!u) throw new Error("User not found");

  // 2. Short-circuit: system userType bypasses CASL
  if (u.userType === "system") {
    const { build, can } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("manage", "all");
    return build();
  }

  // 3. Load (role, scope) pairs in one round-trip.
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
    .select({ roleId: userScopes.roleId, dim: userScopes.dimensionType, id: userScopes.dimensionId })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));

  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);

  // 4. System role short-circuit at the rule-set level
  if (grants.some((g) => g.roleKind === "system")) {
    builder.can("manage", "all");
  } else {
    for (const g of grants) {
      if (!g.action) continue;  // role with no rules
      const target = g.inverted ? builder.cannot : builder.can;
      // Merge per-(user, role) scopes into rule conditions
      const scopeCond = deriveScopeConditions(g.subject, scopeRows.filter((s) => s.roleId === g.roleId));
      target.bind(builder)(
        g.action,
        g.subject,
        g.fields ?? undefined,
        { ...(g.conditions ?? {}), ...scopeCond },
      );
    }
  }

  // 5. External-user invariant: defense-in-depth, NOT in rule data
  applyExternalUserInvariant(builder, u.userType);

  return builder.build();
});

function deriveScopeConditions(subject: string, scopes: Array<{ dim: string; id: string }>) {
  // Subject-aware mapping; 'Location' → `{ id: { $in } }` for location-dim,
  // 'Kiosk' → join via assigned location, etc. Implementation in Q1 below.
  // ...
  return {};
}
```

**Why this shape:**
- `react.cache` matches `getSessionOrThrow`, `getUserCtx`, `scopedSalesCondition` idiom — one DB hit per request even when N RSC islands invoke it.
- Single SQL fan-out (one query per concern: grants + scopes); avoid N round-trips per role.
- Builder mutation is local; result is immutable for the request.

### Pattern 2: `redactSensitiveFields` → `permittedFieldsOf` migration

```ts
// src/lib/casl/fields.ts
import { getTableColumns } from "drizzle-orm";
import { locations, kiosks, user, /* ... */ } from "@/db/schema";

// Subject → Drizzle table registry. Single source of truth used by:
//   1. Admin UI field picker (autocomplete in role editor)
//   2. permittedFieldsOf fieldsFrom callback (resolves rule.fields=undefined)
//   3. Build-time exhaustiveness check (test ensures every Subject has a table)
const SUBJECT_TABLES = {
  Location: locations,
  Kiosk: kiosks,
  User: user,
  // ... add as schema grows
} as const;

export type Subject = keyof typeof SUBJECT_TABLES;

const FIELDS_BY_SUBJECT: Record<Subject, readonly string[]> = Object.fromEntries(
  Object.entries(SUBJECT_TABLES).map(([k, t]) => [k, Object.keys(getTableColumns(t))]),
) as Record<Subject, readonly string[]>;

export function fieldsOfSubject(s: Subject): readonly string[] {
  return FIELDS_BY_SUBJECT[s];
}

// Wired into permittedFieldsOf at call sites:
import { permittedFieldsOf } from "@casl/ability/extra";
export function readableFields(ability: AppAbility, subject: Subject): string[] {
  return permittedFieldsOf(ability, "read", subject, {
    fieldsFrom: (rule) => rule.fields ?? [...fieldsOfSubject(subject)],
  });
}
```

**Why auto-derived via `getTableColumns`:** [VERIFIED: `node_modules/drizzle-orm/utils.d.ts:37`] Drizzle exposes `getTableColumns<T>(table): T['_']['columns']` — `Object.keys(...)` gives every camelCase column name. No drift: a new Drizzle column appears automatically. The hand-maintained map alternative requires a developer to remember to update `subjects.ts` every time they add a column — a tax we already pay (and forget) for `EDITABLE_LOCATION_FIELDS`-style allow-lists. See Q2 for the full decision.

### Pattern 3: SSR-safe Ability serialization

```tsx
// src/app/(app)/layout.tsx (RSC)
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { AbilityProvider } from "@/lib/casl/ability-context";

export default async function AppLayout({ children }) {
  const ctx = await getUserCtx();
  // ability.rules is a serializable RawRule[] — safe to cross the SSR boundary.
  return <AbilityProvider rules={ctx.ability.rules}>{children}</AbilityProvider>;
}

// src/lib/casl/ability-context.tsx
"use client";
import { createContext, useMemo } from "react";
import { createMongoAbility, type RawRuleOf } from "@casl/ability";
import { createContextualCan } from "@casl/react";
import type { AppAbility } from "./ability";

export const AbilityContext = createContext<AppAbility>(createMongoAbility([]));
export const Can = createContextualCan(AbilityContext.Consumer);

export function AbilityProvider({
  rules,
  children,
}: {
  rules: RawRuleOf<AppAbility>[];
  children: React.ReactNode;
}) {
  const ability = useMemo(() => createMongoAbility(rules), [rules]);
  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>;
}
```

**Why this works on React 19 / Next 16 App Router:**
- `ability.rules` is a plain `RawRuleOf<AppAbility>[]` — JSON-serializable.
- The RSC reads ability server-side; the client island re-builds it from the rules.
- `<AbilityContext.Consumer>` is the contract `createContextualCan` expects — present on React 19 contexts.

### Anti-Patterns to Avoid

- **Hand-maintained `subject → fields[]` map** that drifts from Drizzle schema. Use `getTableColumns` (Pattern 2). Drift = invisible permission bugs.
- **`ability.can()` checks at the database driver layer (BYPASS).** Scripts and Inngest functions that talk to the DB directly never go through `getUserCtx` — they're `system`-tier by convention. Don't bolt CASL onto `db.select()`; CASL is a request-scoped check, not a DB middleware.
- **Building the Ability per-call instead of per-request.** Without `react.cache`, an RSC tree with 10 islands hits the DB 10× per render. Every helper that takes a `UserCtx` reuses the cached ability.
- **Putting external-user invariants into rule data.** The CONTEXT decision is explicit: `userType='external'` field-strip is a code-level guard. An admin must NOT be able to grant `bankingDetails` to an external user via the UI. Defense-in-depth.
- **Storing `ability` in the session cookie.** Better Auth's session is signed but not large; rules can grow. Build per-request from DB; one cached round-trip is cheaper than the cookie-size budget.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Which fields can this user read on Location?" | Custom field-allow-list per role | `permittedFieldsOf(ability, 'read', subject, { fieldsFrom })` | Native CASL; handles inverted rules + condition matching |
| "Convert rules to a Postgres WHERE clause" | New SQL emitter | Keep `scopedSalesCondition` / `scopedLocationsCondition`; `userScopes` is the source. CASL `conditions` are for runtime row-checks, not SQL filtering | The two layers serve different purposes — don't unify them |
| "Pack rules for transit between server and client" | Hand-write JSON shape | `ability.rules` IS the wire format; `packRules` / `unpackRules` from `@casl/ability/extra` if you want compactness | Already JSON-serializable; verified in `permittedFieldsOf.mjs` source |
| "Serialize Ability across SSR boundary" | Build per-island on the client (round-trip per gate) | `AbilityProvider` (Pattern 3) — RSC builds once, client rebuilds from rules | Avoids N client builds; rules are the SSR-stable representation |
| "Multi-role precedence with explicit deny" | Custom semantics layer | CASL native: rules with `inverted: true` are evaluated last; `cannot` subtracts from `can` | Explicit-deny-wins (CONTEXT decision) is the default CASL `cannot` semantics — not a custom feature |
| "Field list for admin UI autocomplete" | Hand-maintained map | `getTableColumns(table)` introspection | Single source of truth with the DB schema |
| "Audit log for role edits" | New audit substrate | `writeAuditLog` (existing); add new entityType + actions | One audit substrate; existing assertions on shape stay valid |

## Drizzle JSONB shape for `role_permissions`

```ts
// src/db/schema.ts (additions)
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),                  // 'admin' | 'ops-it' | 'read-only' | custom slug
  kind: text("kind", { enum: ["system", "tier", "custom"] }).notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    action: text("action").notNull(),     // 'read' | 'create' | ... — open string, validated app-side
    subject: text("subject").notNull(),   // 'Kiosk' | 'Location' | ... — registry-validated
    // CASL accepts string[] for fields; null = "all fields of subject" (filled by fieldsFrom)
    fields: jsonb("fields").$type<string[] | null>(),
    // CASL conditions: free-form $-prefixed mongo-style query.
    // Example: { regionId: { $in: ["uuid1", "uuid2"] } }
    conditions: jsonb("conditions").$type<Record<string, unknown> | null>(),
    inverted: boolean("inverted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRole: index("role_permissions_role_idx").on(t.roleId),
  }),
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    assignedBy: text("assigned_by").references(() => userTable.id),
  },
  (t) => ({
    uniq: unique().on(t.userId, t.roleId),
    byUser: index("user_roles_user_idx").on(t.userId),
  }),
);

// userScopes EVOLVES: add roleId column. Rows pre-cutover have roleId NULL,
// backfilled to the user's primary role in the same migration. After backfill,
// roleId becomes NOT NULL with a CHECK or just by app-layer invariant.
export const userScopes = pgTable(
  "user_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
    // NEW: bind scope to a specific role assignment (per-(user, role, dim))
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
    dimensionType: text("dimension_type", { enum: [/* ... */] }).notNull(),
    dimensionId: text("dimension_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by").references(() => userTable.id),
  },
  (t) => ({
    uniq: unique().on(t.userId, t.roleId, t.dimensionType, t.dimensionId),
    byUser: index("user_scopes_user_idx").on(t.userId),
  }),
);
```

**Indexing rationale:** `role_permissions_role_idx` covers the per-request rule fetch (one query per request). `user_roles_user_idx` covers the per-request `WHERE user_id = ?`. `userScopes` already has `byUser`; no further index needed. JSONB columns are not indexed — we never `WHERE conditions ?? '$.foo'`; we read the whole rule blob and let CASL evaluate it.

**Defaults / nullability:**
- `fields`: nullable (NULL = "all fields"; resolved at query-time via `fieldsFrom`).
- `conditions`: nullable (NULL = "no conditions"; rule applies unconditionally).
- `inverted`: `NOT NULL DEFAULT FALSE`.

## Migration ordering (atomicity — see Q3)

**Recommended:** ALL of the following land in one PR with three sequential migration files. Justification + alternative below.

```
migrations/0050_phase_10_roles_schema.sql
  - CREATE TABLE roles
  - CREATE TABLE role_permissions
  - CREATE TABLE user_roles
  - ALTER TABLE user_scopes ADD COLUMN role_id uuid (nullable)

migrations/0051_phase_10_seed_and_backfill.sql  (data-only)
  - INSERT INTO roles (Admin/system, Ops-IT/tier, Read-only/tier)
  - INSERT INTO role_permissions for Ops-IT + Read-only (mirrors v1.0 behaviour)
  - INSERT INTO user_roles backfilling from user.role text:
      'admin'  → user_roles(role=Admin)
      'member' → user_roles(role=Ops-IT)
      'viewer' → user_roles(role=Read-only)
  - UPDATE user_scopes SET role_id = (lookup primary role) WHERE role_id IS NULL

migrations/0052_phase_10_user_scopes_role_id_required.sql
  - ALTER TABLE user_scopes ALTER COLUMN role_id SET NOT NULL
  - ALTER TABLE user_scopes ADD CONSTRAINT user_scopes_userrole_fk
      FOREIGN KEY (user_id, role_id) REFERENCES user_roles(user_id, role_id)
      — actually skip this; user_roles has its own (user_id, role_id) unique
        but cascading FKs across composite keys are awkward. Rely on app-level
        invariant: deleting a user_role row deletes the matching user_scopes.
```

**`user.role` text is NOT dropped.** It stays as a denormalised mirror of the primary tier (defined as the alphabetically-first non-custom role assigned, or simply "Admin if assigned else Ops-IT if assigned else Read-only"). This is a hard requirement of Better Auth integration — see Q1.

**Three files, not one,** because Drizzle's migration runner applies files transactionally per-file but not across files (this is a known Drizzle behaviour, confirmed by the project's house style: 0048 is a NOT-NULL flip operator-gated separately from 0047). Splitting at the `SET NOT NULL` boundary lets the seed/backfill commit cleanly even if the constraint flip later needs operator intervention. All three sit in the same PR — the cutover is atomic at the PR level, just not at the SQL-transaction level.

## Runtime State Inventory (rename / refactor / migration)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `user.role` text values: `'admin'`, `'member'`, `'viewer'` (any other value would be a bug). `userScopes` rows: ~N per external user, will gain `role_id` (backfilled). | Backfill in migration 0051 (above). `user.role` text PRESERVED as denormalised mirror — see Q1. |
| Live service config | None. Vercel env vars (`BETTER_AUTH_URL`, `RESEND_API_KEY`, etc.) do not encode role names. Inngest functions don't reference role text. | None — verified by grep of `vercel env ls` history + Inngest fn source. |
| OS-registered state | None. No Task Scheduler / launchd / systemd registrations carry role text. | None. |
| Secrets / env vars | None reference role text. | None. |
| Build artifacts / installed packages | `@casl/ability` and `@casl/react` are NEW deps — lockfile must be regenerated **inside Linux/amd64 Docker container per CLAUDE.md**. Both packages are pure-JS (no native bindings); risk is low but the project rule applies uniformly. | Run the canonical Docker regen from `CLAUDE.md` after `npm install @casl/ability @casl/react`; commit `package-lock.json` from the container's output. Do NOT regen on macOS host. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old API cached, stored, or registered?* — Answer: nothing. CASL is a code-only addition; rule rows are seeded by migration 0051. There is no external system holding `requireRole('admin')`-style strings.

## Common Pitfalls

### Pitfall 1: `permittedFieldsOf` returns empty when no rules grant the subject
**What goes wrong:** Caller wraps `permittedFieldsOf(ability, 'read', 'Location', { fieldsFrom: (r) => r.fields ?? ALL })`. If there's no `can('read', 'Location')` rule at all, the result is `[]`. UI renders the location with every sensitive field redacted, including non-sensitive ones.
**Why it happens:** `permittedFieldsOf` is multiplicative: it returns the UNION of `fieldsFrom(rule)` over every matching `can` rule, minus every matching `cannot` rule. No `can` rule ⇒ empty union.
**How to avoid:** Always pair `permittedFieldsOf` with a guard `if (ability.cannot('read', subject)) return null` to surface a proper 403 instead of a stripped-everything dance. Verified by reading `permittedFieldsOf.mjs` source.
**Warning signs:** Locations page renders with `name` set but every other field nulled.

### Pitfall 2: Better Auth admin endpoints break if `user.role` is dropped
**What goes wrong:** `adminUpdateUser`, `setRole`, `impersonate`, `ban` return 403 because `ctx.context.session.user.role` is empty.
**Why it happens:** Better Auth admin plugin (`node_modules/better-auth/dist/plugins/admin/routes.mjs`) reads `session.user.role` in 11+ places to gate `adminRoles: ["admin"]`.
**How to avoid:** Keep `user.role` text. Maintain it in lock-step with the user's primary role assignment via a transaction wrapper around `assignRole` / `revokeRole` actions. See Q1.
**Warning signs:** invite-user / set-role / impersonation server actions return "Forbidden" after migration. CI smoke test for `/settings/users` admin actions catches this.

### Pitfall 3: `<Can>` flickers between server and client because rules differ
**What goes wrong:** RSC renders "Merge" button as visible (server ability allows). Client hydrates with `<Can>` evaluating against a DIFFERENT ability (because the SSR didn't pass rules through), button disappears for 200ms.
**Why it happens:** Two ability instances built from different rule snapshots — server reads from DB, client builds from a stale or empty default.
**How to avoid:** Pass `ability.rules` from the RSC layout into `<AbilityProvider>`. The client's `createMongoAbility(rules)` MUST receive the same rules the server used. Don't fetch rules client-side — that's a hydration mismatch.
**Warning signs:** Visible flash of permission-gated UI on page load.

### Pitfall 4: Lock-out — admin demotes themselves and saves a state with zero `manage all` users
**What goes wrong:** Admin edits their own user, removes Admin role, leaves Ops-IT only. Save succeeds. No one can edit roles anymore.
**Why it happens:** No write-time invariant.
**How to avoid:** Validation gate in `assignRole` / `revokeRole` server action — see Q6 for the concrete query.
**Warning signs:** Test fixture: try to revoke the last admin's last admin assignment → server action MUST return error.

### Pitfall 5: External-user invariant bypassed by an admin granting `bankingDetails` via the UI
**What goes wrong:** Admin creates a custom role "External Auditor" and grants `read: Location, fields: ['bankingDetails']`. Assigns to a `userType='external'` user. They see banking.
**Why it happens:** Rule data is the source of truth at evaluation time.
**How to avoid:** Code-level invariant in `applyExternalUserInvariant(builder, userType)` — appends `cannot('read', SubjectX, ['bankingDetails', ...])` LAST when `userType === 'external'`. Because deny-wins, it overrides any allow rule. CONTEXT decision (Section 2.Q2.3): defense-in-depth, NOT in rule data.
**Warning signs:** Test: admin creates custom role with `bankingDetails`, assigns to external user, fetch shows nulled — assertion catches regression.

### Pitfall 6: Drizzle migration applies `SET NOT NULL` before backfill completes (Phase 9.1 lesson)
**What goes wrong:** 0051 (backfill) and 0052 (NOT NULL) merge into one file → if backfill row count is large and a single transaction times out, partial state.
**Why it happens:** Drizzle runs each migration file as one transaction by default.
**How to avoid:** Three sequential files (above). Phase 9.1 used the same pattern (0048 NOT-NULL flip operator-gated). Match the house style.
**Warning signs:** Migration 0052 fails on prod with "column contains nulls".

## Code Examples

Verified patterns from `node_modules/@casl/ability/dist/`:

### Building an Ability with allow + deny
```ts
import { AbilityBuilder, createMongoAbility } from "@casl/ability";

const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
can("read", "Location");
can("update", "Kiosk", ["pipelineStage", "outletCode"]);
cannot("read", "Location", ["bankingDetails"]);  // explicit deny — wins
const ability = build();

ability.can("read", "Location");                    // true
ability.can("read", "Location", "bankingDetails"); // false (deny rule)
```
Source: `node_modules/@casl/ability/dist/types/AbilityBuilder.d.ts` + observed CASL semantics in `permittedFieldsOf.mjs:28-31` (deny iterates LAST, removes from set).

### `permittedFieldsOf` with field-list registry
```ts
import { permittedFieldsOf } from "@casl/ability/extra";
import { fieldsOfSubject } from "@/lib/casl/fields";

const fields = permittedFieldsOf(ability, "read", "Location", {
  fieldsFrom: (rule) => rule.fields ?? [...fieldsOfSubject("Location")],
});
// → ['name', 'address', 'pipelineStage', ...]   (no bankingDetails because cannot rule applied)
```
Source: `node_modules/@casl/ability/dist/types/extra/permittedFieldsOf.d.ts:9` + the `fieldsFrom` callback contract (caller-provided per CASL design).

### Conditions for scoped reads
```ts
can("read", "Kiosk", { regionId: { $in: ["uuid1", "uuid2"] } });
ability.can("read", { regionId: "uuid1", __caslSubjectType__: "Kiosk" });   // true
ability.can("read", { regionId: "uuid9", __caslSubjectType__: "Kiosk" });   // false
```
Conditions use `@ucast/mongo2js` syntax (transitive dep of `@casl/ability`). Verified by `node_modules/@casl/ability/package.json` dependencies.

### Drizzle `getTableColumns` introspection
```ts
import { getTableColumns } from "drizzle-orm";
import { locations } from "@/db/schema";

const cols = Object.keys(getTableColumns(locations));
// → ['id', 'name', 'normalisedName', 'address', 'latitude', 'longitude', ...]
```
Source: `node_modules/drizzle-orm/utils.d.ts:37` — returns `T['_']['columns']`, a `Record<string, AnyColumn>`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `requireRole('admin', 'member')` text-role gate | `ability.can('action', 'Subject')` | Phase 10 (this phase) | All 59 files migrate; signatures preserved temporarily as shims |
| `redactSensitiveFields(data, user)` per-call hand-rolled key strip | `permittedFieldsOf(ability, 'read', subject, { fieldsFrom })` | Phase 10 | Drop-in at 4 call sites (locations new, locations [id], locations actions ×2) |
| `user.role` text as authoritative | `user_roles` join table authoritative; `user.role` text = denormalised mirror | Phase 10 | Better Auth admin plugin keeps reading `user.role` text — backwards-compat preserved |
| Single role per user | IAM-style multi-role per user | Phase 10 | New `user_roles` link table |
| `userScopes(user_id, dim, dim_id)` | `userScopes(user_id, role_id, dim, dim_id)` | Phase 10 | New role_id column, backfilled |

**Deprecated/outdated:**
- `Role` type (`'admin' \| 'member' \| 'viewer'`) — replaced by role IDs; type stays only as a shim for `user.role` text mirror reads.
- `canAccessSensitiveFields(user)` — replaced by `ability.can('read', subject, 'fieldName')`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drizzle migrations across multiple files in the same PR are not transactionally atomic, so split-file migration ordering matters. | Migration ordering | LOW — confirmed by Phase 9.1 pattern (0048 NOT-NULL flip separate from 0047), but not by reading drizzle-kit source in this session. |
| A2 | Better Auth's `customSession` plugin can run in addition to the `admin` plugin without conflict. | Q1 alternative | MEDIUM — mitigated by recommending we DO NOT use customSession; CASL is built post-session. |
| A3 | `permittedFieldsOf` semantics handle `inverted: true` rules correctly when `fields` is `undefined` (i.e. deny-wins applies field-by-field). | Pitfall 1 + Q4 | LOW — verified by reading `permittedFieldsOf.mjs:28-31` source (deny path calls `delete` on the set). |
| A4 | The Better Auth admin plugin will continue to function correctly when `user.role` is set from a denormalised mirror logic rather than direct user input. | Q1 | LOW — admin plugin reads `user.role` as a text field; doesn't care how it got there. Verified by reading `routes.mjs` (no plugin-internal write barrier). |
| A5 | The `system` userType (per `getUserCtx`'s short-circuit branch) will continue to bypass CASL entirely; no script/cron uses `requireRole`. | Architecture | LOW — verified by grep: `requireRole` only appears in user-facing server actions; no Inngest function or `scripts/` path uses it. |
| A6 | The 5 client-side role gates (Q4) are exhaustive — no other component reads `user.role` for client-side conditional rendering. | Q4 | MEDIUM — based on grep of `session.user.role`, `session?.user?.role`, `user.role ===`, `isAdmin` in `*.tsx` files. Possible miss: dynamic role lookups via destructuring, e.g. `const { role } = session.user`. |

## Open Questions (RESOLVED)

1. **Should the `users/[id]` page be created in this phase?** Currently `src/app/(app)/settings/users/[id]/` has only `scopes-actions.ts` + `scopes-internal.ts` (no `page.tsx`). Per CONTEXT, user-to-role assignment "stays on `/settings/users/[id]`" — implying the page exists. It does not. Plan must include creating it as part of AUTH-07.
   - **RESOLVED:** included in Plan 10-06 Task 2. The RSC page + `role-assignment-client.tsx` ship together; verified via Plan 10-06 acceptance `test -f src/app/(app)/settings/users/[id]/page.tsx`.

2. **`userScopes.role_id`: should it be `NOT NULL` or stay nullable to allow legacy unscoped admin user_roles rows?** Admin role grants `manage all` and historically has zero `userScopes` rows. So `userScopes.role_id` can be nullable (and is nullable per the recommended schema above) — no admin user has scope rows to backfill.
   - **RESOLVED:** Plan 10-02 ships `role_id` nullable in migration 0050; the operator-gated NOT-NULL flip is migration 0052 (verbatim 0048-style guard) and runs only after 0051 backfill verifies zero `role_id IS NULL` rows. Admin invariant (zero scope rows) verified by `tests/db/casl-ability.integration.test.ts`.

3. **Audit-log entityType extension.** `auditLogs.entityType` currently has a fixed enum with no `role`. Plan must include extending the enum (`'role' | 'role_permission' | 'user_role'`) — see Q5.
   - **RESOLVED:** Plan 10-02 Task 2 widens `src/lib/audit.ts` TS literal unions (no SQL ALTER — the column is text in Postgres; the TypeScript union is the gate) to add `'role' | 'role_permission' | 'user_role'` entityTypes plus `'permissions_replace' | 'assign' | 'revoke' | 'scope_update'` actions. Verified via Plan 10-02-T2 grep `'"role"' src/lib/audit.ts && '"permissions_replace"' src/lib/audit.ts`.

---

# Open research questions — answered

## Q1: Better Auth role-plugin compatibility

**Decision:** **Keep `user.role` text as a denormalised mirror.** Authoritative source for permissions is `user_roles` (IAM-style). Better Auth admin plugin continues to read `user.role` text for its endpoint gates.

**Concrete code shape:**

```ts
// src/lib/casl/role-mirror.ts — single point of truth for the denormalisation
import { db } from "@/db";
import { user, roles, userRoles } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

// Mirror the user's "primary tier" into user.role text.
// Primary = Admin if assigned, else Ops-IT if assigned, else Read-only,
// else NULL (no roles → user is effectively locked out, which Better Auth
// treats as 'member' fallback).
const PRIMARY_TIER_RANK: Record<string, number> = {
  admin: 0,        // Admin (kind='system') wins
  "ops-it": 1,
  "read-only": 2,
};

export async function refreshUserRoleMirror(userId: string): Promise<void> {
  const grants = await db
    .select({ name: roles.name, kind: roles.kind })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const tiers = grants
    .filter((g) => g.kind === "system" || g.kind === "tier")
    .sort((a, b) => (PRIMARY_TIER_RANK[a.name] ?? 99) - (PRIMARY_TIER_RANK[b.name] ?? 99));

  // Map back to Better Auth-compatible text:
  //   Admin (system)  → 'admin'
  //   Ops-IT (tier)   → 'member'
  //   Read-only (tier)→ 'viewer'
  //   no tier role    → 'member' fallback (Better Auth defaultRole)
  const mirror =
    tiers[0]?.name === "admin" ? "admin"
    : tiers[0]?.name === "ops-it" ? "member"
    : tiers[0]?.name === "read-only" ? "viewer"
    : "member";

  await db.update(user).set({ role: mirror }).where(eq(user.id, userId));
}
```

**Wired in:** `assignRole(userId, roleId)` and `revokeRole(userId, roleId)` server actions call `refreshUserRoleMirror(userId)` inside the same transaction as the `user_roles` write.

**Why this beats the customSession alternative:**
1. `customSession` would require us to write a function that runs on EVERY session read — adds latency to every request, including paths that never check permissions.
2. Better Auth admin plugin's `setRole` endpoint would still write to `user.role` text directly, conflicting with a customSession-derived value.
3. Two write paths (Better Auth's `setRole` AND our `assignRole`) is a footgun. Keeping `user.role` as the primary-tier mirror means our `assignRole` is the only writer; we deprecate `setRole` from being called by app code (Better Auth's internal use of it on createUser stays intact and writes the default `'member'`, which is fine).

**Migration ordering implication:** `user.role` column is NEVER dropped. The CONTEXT.md decision "Replace `user.role` text column with `user.role_id`" is **REVISED** by this research — we add `user_roles` link table, keep `user.role` text as denormalised mirror. Update CONTEXT.md or document the revision in the plan. (This is the most important reversal in the research; the planner must surface it.)

[VERIFIED: `node_modules/better-auth/dist/plugins/admin/routes.mjs` reads `session.user.role` at lines 153, 217, 225, 285, 358, 401, 453, 506, 614, 657, 700, 747 — 12 distinct call sites.]

## Q2: Field-list registry derivation

**Decision:** **Auto-derived at request-time via `getTableColumns`** — single source of truth, zero drift.

**Concrete code shape:** see Pattern 2 above (`src/lib/casl/fields.ts`). Two layers:

1. **`SUBJECT_TABLES`** — hand-maintained `Record<Subject, Table>` map. Adding a new subject = one entry. This is the only manually-maintained surface.
2. **`FIELDS_BY_SUBJECT`** — derived by `Object.entries(SUBJECT_TABLES).map(([k, t]) => [k, Object.keys(getTableColumns(t))])`. Adding a new column to an existing subject = zero changes here.

**New-table drift protection:** Add a build-time exhaustiveness test:

```ts
// src/lib/casl/__tests__/subjects.test.ts
import { SUBJECT_TABLES } from "../subjects";

const KNOWN_SUBJECTS: Subject[] = ["Kiosk", "Location", "User", "AuditLog", "Analytics", "RolePermission", "EmailLog"];

test("every Subject literal has a SUBJECT_TABLES entry", () => {
  for (const s of KNOWN_SUBJECTS) {
    expect(SUBJECT_TABLES).toHaveProperty(s);
  }
});

test("every entry resolves to a Drizzle PgTable with columns", () => {
  for (const [subject, table] of Object.entries(SUBJECT_TABLES)) {
    const cols = getTableColumns(table);
    expect(Object.keys(cols).length).toBeGreaterThan(0);
  }
});
```

**Why NOT a hand-maintained `subject → string[]` map (Option B):**
- The project already has scars from this pattern — see `EDITABLE_LOCATION_FIELDS` in `locations/actions.ts:295`. It drifts.
- Drizzle introspection is a one-line lookup; the cost is one `Object.keys` per subject per request, dwarfed by the SQL roundtrip.
- The admin UI's field picker reads from the SAME registry, so what an admin can pick = what `permittedFieldsOf` honours. No "field allowed in DB but not in UI" gap.

[VERIFIED: `node_modules/drizzle-orm/utils.d.ts:37` exports `getTableColumns<T>`; the project already uses Drizzle's column introspection elsewhere (commission_ledger, sales_records).]

## Q3: Atomicity of the migration PR

**Decision:** **One PR, three migration files, one merge.** All call-site rewrites land in the same PR. `user.role` text is NOT dropped (per Q1) — the question of when-to-drop is moot.

**Sequencing:**

1. **Wave 0 (test scaffolds):** Unit tests for the Ability builder; integration tests for the server actions. RED stage.
2. **Wave 1 (code adds, no behaviour change yet):**
   - Install CASL deps (Docker-regen lockfile per CLAUDE.md).
   - Add `src/lib/casl/*` (ability.ts, subjects.ts, fields.ts, external-invariant.ts, seed.ts, ability-context.tsx).
   - Augment `getUserCtx` to attach `ability` to `UserCtx`.
   - Migration 0050 — schema additions (roles, role_permissions, user_roles, user_scopes.role_id nullable).
   - **NO call sites touched yet.** Old `requireRole`/`redactSensitiveFields` continue to work.
3. **Wave 2 (data + cutover prep):**
   - Migration 0051 — seed Admin/Ops-IT/Read-only + role_permissions + backfill user_roles + populate user_scopes.role_id.
   - Refresh `user.role` mirror for every user (`refreshUserRoleMirror` for each).
   - Update `src/lib/rbac.ts` — `requireRole` and `redactSensitiveFields` keep their signatures but now delegate to `ability` internally. No call site changes yet.
4. **Wave 3 (call-site rewrites, batch by area):**
   - 4a. Rewrite `redactSensitiveFields` call sites (4 files): `locations/[id]/page.tsx`, `locations/new/page.tsx`, `locations/actions.ts`, `locations/[id]/products/location-products-client.tsx`.
   - 4b. Rewrite `requireRole` call sites batch 1 (settings/* — 18 files).
   - 4c. Rewrite `requireRole` call sites batch 2 (locations/* + kiosks/* + installations/* + lib/merge.ts + lib/geocoding/pipeline.ts + analytics — remaining ~37 files).
   - 4d. Add admin UI (`/settings/roles` + `/settings/users/[id]/page.tsx`).
   - 4e. Migrate the 5 client-side role gates to `<Can>`.
5. **Wave 4 (constraint flip + cleanup):**
   - Migration 0052 — `user_scopes.role_id SET NOT NULL` (or skip if Q-OQ-2 says nullable forever).
   - Drop `Role` type re-exports that are no longer used.
   - Final unit + integration test green.

**Why one PR, not split:**
- The `requireRole` signature is preserved as a delegating shim through Wave 3 (point 3 above). Until every call site is rewritten, the shim stays. Splitting Wave 3 into a follow-up PR leaves the shim live in main, with an "any day now" deletion task — the kind of debt this project reliably forgets (see DEBT-02 Drizzle 0.45.2 patch audit at v1.1 close).
- Each migration file is its own transaction — the SQL atomicity story is intact. PR atomicity is about deployability: one rollback boundary.
- The only thing not in this PR is the `user.role` text DROP — which we're not doing. So the question "should the drop be in a follow-up?" is moot.

**Rollback risk:** LOW. `user.role` text stays valid throughout. If Wave 3 introduces a regression in a specific server action, that file's `requireRole` shim stayed compatible — revert just that file. Migration rollback is more painful (`DROP TABLE roles CASCADE` would lose the seed data), but `git revert` of the migration files + a fresh deploy clean.

## Q4: CASL on the client (`@casl/react`)

**Existing client-rendered role gates (audit complete):**

| Gate | File | Current code | Decision |
|------|------|-------------|----------|
| Sidebar admin nav group | `src/components/layout/app-sidebar.tsx:165` (`{isAdmin && <NavGroup …>}`) | `isAdmin` prop from `app-shell-v2.tsx` | **Migrate to `<Can I="manage" a="all">`** — high-traffic, drives sidebar visibility |
| User menu admin section | `src/components/layout/user-menu.tsx:127` (`{isAdmin && (<...>)}`) | `user.role === "admin"` from layout prop | **Migrate** — same context as sidebar |
| Settings hub admin tiles | `src/app/(app)/settings/page.tsx:65,86,104,122,140` | `isAdmin = role === "admin"` server-side | **Stay server-only** — RSC, just call `ability.can('manage', 'all')` directly. No `<Can>` needed. |
| Users page admin actions | `src/app/(app)/settings/users/users-page-client.tsx`, `src/components/admin/user-table.tsx` | `isAdmin` prop drilled from RSC parent | **Stay prop-drilled** — admin-only page; the page itself gates entry. Keep `isAdmin` boolean but compute as `ability.can('manage', 'User')` server-side and pass down. |
| Location products admin section | `src/app/(app)/locations/[id]/products/location-products-client.tsx:474` (`session?.user?.role === "admin"`) | Reads session client-side via `useSession` | **Migrate to `<Can I="manage" a="LocationProduct">`** — currently reads stale session; migrating to `<Can>` makes the gate correct under impersonation. |
| Locations page admin panel | `src/app/(app)/locations/[id]/page.tsx:41` (`{role === "admin" && <LocationAdminPanel ... />}`) | RSC | **Stay server-only** — already RSC; just call `ability.can`. |

**Summary:**
- **Migrate to `<Can>`:** sidebar (1), user menu (1), location-products (1) = **3 client gates.**
- **Stay server-only with `ability.can`:** settings hub (5 tiles), users page client (computed in parent), location detail admin panel (1) = no `<Can>` needed; just direct ability checks in RSC.

(Original "5 client-side gates" estimate was high; correct count after audit is 3.)

**SSR/hydration story:**
- Ability is built per-request server-side in `getUserCtx`.
- `src/app/(app)/layout.tsx` becomes `async` (already is) and pulls `ctx.ability.rules`.
- Wraps children in `<AbilityProvider rules={ctx.ability.rules}>`.
- `AbilityProvider` is a `"use client"` component that calls `createMongoAbility(rules)` in a `useMemo`.
- Client `<Can ability={...}>` consumes from `AbilityContext` (via `createContextualCan(AbilityContext.Consumer)`).
- No client-side fetch; rules are JSON-serializable (`RawRuleOf<AppAbility>[]`).

```tsx
// src/lib/casl/ability-context.tsx (full shape)
"use client";
import { createContext, useMemo, type ReactNode } from "react";
import { createMongoAbility, type RawRuleOf } from "@casl/ability";
import { createContextualCan } from "@casl/react";
import type { AppAbility } from "./ability";

export const AbilityContext = createContext<AppAbility>(createMongoAbility([]));
export const Can = createContextualCan(AbilityContext.Consumer);

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

[VERIFIED: `@casl/react@6.0.0/dist/types/factory.d.ts` exports `createContextualCan(Getter: Consumer<T>)`; works with React 19 contexts.]

## Q5: Audit-log shape for role edits

**Extension to existing `auditLogs.entityType` enum:**
```ts
// src/db/schema.ts (auditLogs entityType enum extension via migration)
//  add: "role" | "role_permission" | "user_role"
```

**Extension to `auditLogs.action` enum:**
```ts
//  add: "permissions_replace"
```

**Concrete `metadata` jsonb shapes:**

```ts
// 1. role.permissions.replace — admin saves a new rule set for a role
writeAuditLog({
  actorId: session.user.id,
  actorName: session.user.name,
  entityType: "role",
  entityId: role.id,
  entityName: role.displayName,
  action: "permissions_replace",
  metadata: {
    kind: "role.permissions.replace",
    roleId: role.id,
    roleName: role.name,
    before: prevRules,    // { action, subject, fields, conditions, inverted }[]
    after: nextRules,     // same shape
    impactedUserCount: N, // number of users assigned this role at save time
  },
});

// 2. role.create — new custom role created
writeAuditLog({
  actorId, actorName,
  entityType: "role",
  entityId: role.id,
  entityName: role.displayName,
  action: "create",
  metadata: {
    kind: "role.create",
    roleName: role.name,
    roleDisplayName: role.displayName,
    initialRules: rules,  // RawRule[]
  },
});

// 3. role.delete — role removed (cascades user_roles, role_permissions)
writeAuditLog({
  actorId, actorName,
  entityType: "role",
  entityId: role.id,
  entityName: role.displayName,
  action: "delete",
  metadata: {
    kind: "role.delete",
    roleName: role.name,
    impactedUserIds: [/* list of user IDs whose user_roles row was cascaded */],
  },
});

// 4. user.roles.assign — admin assigns role to user with optional scope binding
writeAuditLog({
  actorId, actorName,
  entityType: "user_role",
  entityId: userRoleId,                  // user_roles.id
  entityName: `${targetUser.name} → ${role.displayName}`,
  action: "assign",
  metadata: {
    kind: "user.roles.assign",
    userId: targetUser.id,
    roleId: role.id,
    roleName: role.name,
    scopes: [
      { dimensionType: "region", dimensionId: "uuid1" },
      { dimensionType: "region", dimensionId: "uuid2" },
    ],
  },
});

// 5. user.roles.revoke — admin removes a role assignment
writeAuditLog({
  actorId, actorName,
  entityType: "user_role",
  entityId: userRoleId,
  entityName: `${targetUser.name} → ${role.displayName}`,
  action: "unassign",
  metadata: {
    kind: "user.roles.revoke",
    userId: targetUser.id,
    roleId: role.id,
    roleName: role.name,
    scopesAtRevoke: [/* userScopes rows for this (user, role) — captured because they cascade-delete */],
  },
});
```

**Verified against `src/lib/audit.ts` writer signature:**
- `entityType` literal union must be extended (TS-enforced; migration adds the values).
- `action` literal union must add `"permissions_replace"`.
- `metadata: Record<string, unknown>` accepts arbitrary jsonb shapes — no schema change needed for the shape itself, only for the enum extensions.
- `field` / `oldValue` / `newValue` legacy columns: leave NULL for these new audit kinds; the structured shape lives in `metadata`. Pattern matches Phase 9.1's `email_log`-related audit entries.

The `kind` discriminator in `metadata` lets a future audit-viewer renderer dispatch on the structured payload without re-parsing entityType + action.

## Q6: Validation — lock-out prevention at write-time

**Concrete query — "≥1 user has effective `manage all`":**

Under the IAM-style multi-role + explicit-deny-wins model, "effective `manage all`" means: a user has at least one role assignment, AND that role's rule set evaluates to `ability.can('manage', 'all')`. Two paths:

**Path A (cheap — works for v1.1 because Admin is `kind='system'` and uneditable):**
```sql
-- "is there ≥1 user with the system Admin role?"
SELECT COUNT(*)
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE r.kind = 'system' AND r.name = 'admin';
```
If the result is 0, refuse the save.

**Path B (correct under future relaxation — handles a custom role that grants `manage all`):**
```sql
-- "is there ≥1 user with at least one role that has a `manage all` rule and no overriding deny?"
SELECT COUNT(DISTINCT ur.user_id)
FROM user_roles ur
WHERE EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = ur.role_id
    AND rp.action = 'manage'
    AND rp.subject = 'all'
    AND rp.inverted = false
)
AND NOT EXISTS (
  -- Any inverted rule on this role would gate against blanket admin power.
  -- For v1.1 we treat ANY inverted rule as a disqualifier; refining this
  -- (e.g. only inverted rules on `manage all` itself) is a v1.2 concern.
  SELECT 1 FROM role_permissions rp2
  WHERE rp2.role_id = ur.role_id
    AND rp2.action = 'manage'
    AND rp2.subject = 'all'
    AND rp2.inverted = true
);
```

**Recommendation:** **Use Path A in v1.1** (it's the canonical case — Admin is `kind='system'`). Add Path B in v1.2 if/when custom roles can grant `manage all`, which the current scope says they CAN (subjects × actions includes `manage`). To be safe, **use Path B** even in v1.1 to prevent the case where an admin creates a custom role "Super" with `manage all`, assigns it to themselves, and revokes their Admin role. Without Path B, this passes Path A's check (0 system-admin users) — wrongly.

**Server actions where the check lives:**

```ts
// src/app/(app)/settings/users/[id]/role-actions.ts
"use server";
import { db } from "@/db";
import { userRoles, rolePermissions, roles } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export async function revokeRole(userId: string, roleId: string) {
  await requireAdminViaCasl();

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    await assertAtLeastOneEffectiveAdmin(tx);  // throws if zero
    await refreshUserRoleMirror(userId, tx);
  });
}

async function assertAtLeastOneEffectiveAdmin(tx: AnyDb) {
  const [{ n }] = await tx.execute(sql`
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
  `);
  if (n === 0) {
    throw new Error(
      "Refusing to save: this change would leave the system with no effective admin. Assign 'manage all' to at least one user before continuing.",
    );
  }
}
```

**Where the check lives:** Inside the transaction of every write that could reduce admin coverage:
1. `revokeRole(userId, roleId)` — primary path.
2. `replaceRolePermissions(roleId, newRules)` — if the role being edited grants `manage all`, removing that rule could leave zero effective admins.
3. `deleteRole(roleId)` — cascades user_roles; if the role granted `manage all`, all its assignees lose it.
4. `unbanUser` / `banUser` from Better Auth admin plugin — if banning the last admin → check. (This is a Better Auth call site, not ours; we add a hook via Better Auth's `databaseHooks.user.update.before` if needed. **In-scope check for v1.1: the admin UI; out-of-scope: Better Auth ban flow.** Document the gap.)

**Error toast message (UI):**
> "This change would leave the system with no effective admin. Assign Admin (or a role that grants 'manage all') to at least one user before continuing."

**Edge case — deleting the last admin user via Better Auth:** `auth.api.removeUser({ body: { userId: lastAdminId }, ...})` would delete the row; cascade drops their `user_roles`. The check above runs in `revokeRole` (our wrapper), but Better Auth's `removeUser` endpoint doesn't go through it. **Mitigation:** wrap user-deletion in a server action that wraps Better Auth's call, runs the same check, and refuses. Add as a plan task.

[VERIFIED: validation runs inside `db.transaction` per Drizzle 0.45 transaction API; matches existing pattern in `src/app/(app)/locations/merge-action.ts`.]

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | Build + tests + dev server | ✓ | 22.x (per CLAUDE.md docker regen image) | — |
| `npm` | Install CASL deps | ✓ | bundled | — |
| Docker (linux/amd64) | Lockfile regen post-install (CLAUDE.md gotcha) | ✓ (project-mandated) | host's docker | — |
| Postgres (Neon prod, Testcontainers in CI) | Schema + migrations | ✓ | 15+ | — |
| Better Auth 1.5.5 | Session, admin plugin | ✓ (already installed) | `^1.5.5` | — |
| `@casl/ability` | Ability builder | ✗ (NEW) | `^6.8.1` | — |
| `@casl/react` | `<Can>` component | ✗ (NEW) | `^6.0.0` | — |
| `react.cache` | Per-request memoisation idiom | ✓ | React 19.2 | — |
| `drizzle-kit` | Migrations | ✓ | `^0.31.10` | — |
| `vitest` | Unit + integration tests | ✓ | `^4.1.2` | — |
| `playwright` | UAT (per project rule, mandatory for new UI) | ✓ | (deps satisfied) | — |
| Vercel preview env | UAT against branch alias | ✓ | (project standard) | — |

**Missing dependencies with no fallback:** `@casl/ability`, `@casl/react` — install in Wave 1 (CLAUDE.md Docker regen). No fallback because the entire phase rests on CASL.

**Missing dependencies with fallback:** none.

## Validation Architecture

> Required: `workflow.nyquist_validation: true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (two projects: `unit`, `integration`) + Playwright (owns `tests/**/*.spec.ts`) |
| Config file | `vitest.config.ts` (root); `playwright.config.ts`; `playwright.remote.config.ts` |
| Quick run command | `npx vitest run --project unit src/lib/casl src/lib/auth src/lib/rbac.test.ts` |
| Full suite command | `npx vitest run` (unit) → `npx vitest run --project integration` → `npx playwright test --list` (smoke) |
| Phase gate | All three above green + `PLAYWRIGHT_BASE_URL=<branch-alias> npx playwright test tests/access-control/*.spec.ts` against preview |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-06 | Tier defaults preserve v1.0 behaviour for Ops-IT (member) and Read-only (viewer) | unit | `npx vitest run --project unit src/lib/casl/__tests__/seed.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | `redactSensitiveFields` 3 call sites return same fields under default tier rules as before | unit | `npx vitest run --project unit src/lib/casl/__tests__/seed.test.ts` (parity covered by seed regression bar mirroring `src/lib/rbac.test.ts` 1:1) | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | External-user invariant strips banking even if rule data allows it | unit | `npx vitest run --project unit src/lib/casl/__tests__/external-invariant.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | `userScopes` per-(user, role) drives `conditions` correctly; admin sees all, viewer scoped to one region | integration | `npx vitest run --project integration tests/db/casl-ability.integration.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | Admin can edit Ops-IT rules and changes apply to next request without deploy | e2e | `PLAYWRIGHT_BASE_URL=$BRANCH_ALIAS npx playwright test tests/access-control/edit-tier.spec.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-07 | Admin can create custom role, assign to user with scope, user gets exactly those rules | integration | `npx vitest run --project integration tests/db/custom-role.integration.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-07 | Explicit-deny-wins: deny rule on a role overrides allow on a different role for the same user | unit | `npx vitest run --project unit src/lib/casl/__tests__/deny-wins.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-07 | Lock-out guard refuses to save if zero effective admins remain (Path B query) | integration | `npx vitest run --project integration tests/db/lockout-guard.integration.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-07 | `<Can>` component hides "Merge" button on locations page for non-admin viewer | e2e | `PLAYWRIGHT_BASE_URL=$BRANCH_ALIAS npx playwright test tests/access-control/can-component.spec.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06+07 | Better Auth `setRole` / `impersonate` / `ban` continue to work after migration | integration | `npx vitest run --project integration tests/db/better-auth-admin-plugin.integration.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | `permittedFieldsOf` returns expected field set when `fields` is undefined (uses fieldsFrom fallback) | unit | `npx vitest run --project unit src/lib/casl/__tests__/permitted-fields.test.ts` | ❌ Wave 0 (Plan 10-01) |
| AUTH-06 | Subject-table registry exhaustiveness (every Subject literal has a SUBJECT_TABLES entry) | unit | `npx vitest run --project unit src/lib/casl/__tests__/subjects.test.ts` | ❌ Wave 0 (Plan 10-01) |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit src/lib/casl src/app/\(app\)/settings/roles src/app/\(app\)/settings/users` (~5s)
- **Per wave merge:** full unit + integration: `npx vitest run` then `npx vitest run --project integration` (~2 min cold)
- **Phase gate:** all of the above + `PLAYWRIGHT_BASE_URL=… npx playwright test tests/access-control/` against the branch alias (UAT preview).

### Wave 0 Gaps

> Paths reflect the Plan 10-01 file list. Unit RED stubs go under `src/lib/casl/__tests__/`. Integration RED stubs go under `tests/db/` (project convention — testcontainers DB tests live there). Playwright RED specs go under `tests/access-control/`. The `redaction-parity` requirement is folded into `seed.test.ts` (mirrors `src/lib/rbac.test.ts` 1:1); a separate `redaction-parity.test.ts` is NOT created.

Unit RED scaffolds (`src/lib/casl/__tests__/`):
- [ ] `src/lib/casl/__tests__/ability.test.ts` — system short-circuit, react.cache memoisation, multi-role + scope merge
- [ ] `src/lib/casl/__tests__/seed.test.ts` — Ops-IT / Read-only tier defaults match v1.0 behaviour (regression bar mirroring `src/lib/rbac.test.ts` 1:1, also covers redaction parity)
- [ ] `src/lib/casl/__tests__/external-invariant.test.ts` — external-user banking strip (unconditional regardless of rule data)
- [ ] `src/lib/casl/__tests__/deny-wins.test.ts` — explicit-deny-wins precedence across multi-role union
- [ ] `src/lib/casl/__tests__/permitted-fields.test.ts` — `fieldsFrom` callback contract
- [ ] `src/lib/casl/__tests__/subjects.test.ts` — registry exhaustiveness (every `Subject` literal has a `SUBJECT_TABLES` entry)

Integration RED scaffolds (`tests/db/`):
- [ ] `tests/db/casl-ability.integration.test.ts` — per-(user, role) scope conditions against testcontainers
- [ ] `tests/db/custom-role.integration.test.ts` — full custom-role roundtrip (create / assign / verify rules)
- [ ] `tests/db/lockout-guard.integration.test.ts` — Path B SQL inside transaction
- [ ] `tests/db/better-auth-admin-plugin.integration.test.ts` — Better Auth admin endpoints (`setRole` / `impersonate` / `ban`) gate on `user.role` text after migration
- [ ] `tests/db/migration-0051-backfill.integration.test.ts` — verifies seed + backfill of `user_roles` + `user_scopes.role_id` post-0051

Playwright RED specs (`tests/access-control/`):
- [ ] `tests/access-control/role-editor.spec.ts` — happy-path for `/settings/roles` list + drill-in editor
- [ ] `tests/access-control/user-role-assignment.spec.ts` — `/settings/users/[id]` role assignment block
- [ ] `tests/access-control/edit-tier.spec.ts` — admin edits Ops-IT, change applies on next request (AUTH-06 SC2)
- [ ] `tests/access-control/can-component.spec.ts` — `<Can>` hides Merge button for viewer-tier user

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (touches Better Auth integration) | `better-auth@1.5.5` admin plugin; do not bypass |
| V3 Session Management | yes (impersonation interacts with new ability) | Existing impersonation cookie + `getUserCtx` branch; ability built off impersonated identity |
| V4 Access Control | yes (CORE OF PHASE) | CASL `Ability`; explicit-deny-wins; lock-out guard (Q6); external-user code-level invariant |
| V5 Input Validation | yes (admin UI accepts subject/action/field/condition strings) | `zod` schemas on every server action; subject/action against an allow-list registry; conditions JSONB lint-validated |
| V6 Cryptography | no | — |
| V13 API & Web Service | yes (server actions are RPC endpoints) | Every action gates via `getUserCtx().ability.can(...)`; the `requireRole` shim during migration delegates to the same |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Lock-out (no admin remaining) | Repudiation / Denial of Service | Server-side validation gate (Q6) refuses to save state with zero effective admins |
| Privilege escalation via custom role granting forbidden field | Elevation of Privilege | External-user code-level invariant in `applyExternalUserInvariant` (CONTEXT decision); cannot be edited via UI |
| Audit-log forgery (admin edits role permissions, no record) | Repudiation | `writeAuditLog` writes before/after rule sets in `metadata` (Q5); audit_logs table immutable per existing project rules |
| Stale ability after role change (mid-session) | Spoofing / Tampering | `react.cache` is per-request, not per-session; new request after role change rebuilds ability. Document in plan: "role changes take effect on next request" |
| Server-action bypass via direct fetch (skipping `<Can>` UI gate) | Tampering | Every server action calls `requireRole` (shim → ability) FIRST. Client-side `<Can>` is UX, not security |
| SQL-side scope bypass (CASL conditions ≠ SQL filter) | Tampering | KEEP `scopedSalesCondition` / `scopedLocationsCondition` as the SQL filter source; CASL conditions are for hydrated-row gates only. Two layers, both required |
| Better Auth admin endpoint compromise (set-role to admin) | Elevation of Privilege | Better Auth admin plugin gates on `adminRoles: ["admin"]` reading `user.role` text — preserved by Q1 decision |

## Project Constraints (from CLAUDE.md)

The following directives MUST be honoured by every plan task in this phase. Treat with the same authority as locked decisions.

1. **Lockfile regen on linux/amd64 Docker after any new dep install.** Adding `@casl/ability` + `@casl/react` triggers this. Use the canonical command in `CLAUDE.md` § "npm lockfile must stay in sync". Do NOT regen on macOS host. Verify `package-lock.json` contains entries for `@rolldown/binding-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`, `@next/swc-linux-x64-gnu` after regen.
2. **Vercel preview env vars: `BETTER_AUTH_URL` MUST be the git-branch alias** — `wkg-command-centre-git-<sanitized-branch>-vedant-kalbag-wkgs-projects.vercel.app`. Set after preview is up.
3. **Playwright UAT mandatory for new UI.** `/settings/roles` (list + detail + editor), `/settings/users/[id]` (role assignment), and the migrated `<Can>` gates must each have at least one happy-path Playwright spec that RUNS (not just `--list`) against the preview alias.
4. **`PLAYWRIGHT_BASE_URL=<alias>` for spec runs.** `playwright.config.ts` already supports this — confirmed by grep.
5. **Audit-log every operator action.** Every role write goes through `writeAuditLog` per Q5 shapes.
6. **Drizzle migrations atomic per PR.** Three migration files (0050/0051/0052) ship in one PR; PR-level atomicity per project convention.
7. **`npm ci` not `npm install` between Docker regen and commit.** Standing rule.
8. **No manual SQL for ops.** Role/permission edits + lock-out guard go through admin UI, not script. Phase 10's `/settings/roles` IS the admin UI; no companion `scripts/seed-roles.ts` should exist as the long-term path (a one-shot seed script is fine for migration 0051, but not as a recurring operator path).

## Sources

### Primary (HIGH confidence)
- `node_modules/@casl/ability/dist/types/extra/permittedFieldsOf.d.ts` (read in this session) — verified `fieldsFrom` callback contract.
- `node_modules/@casl/ability/dist/umd/extra/index.js` source — verified deny-wins semantics in the loop body.
- `node_modules/@casl/react/dist/types/Can.d.ts` + `factory.d.ts` — verified `<Can>` API + `createContextualCan`.
- `node_modules/better-auth/dist/plugins/admin/admin.mjs` + `routes.mjs` — verified `adminRoles` reading `user.role` text in 12 endpoint handlers.
- `node_modules/drizzle-orm/utils.d.ts:37` — verified `getTableColumns` signature.
- `npm view @casl/ability version` → `6.8.1`; `npm view @casl/react version` → `6.0.0`; `npm view @casl/react peerDependencies` → React `^18 || ^19`. (Run in this session.)
- Codebase grep — verified 59 files using `requireRole`/`canAccessSensitiveFields`/`redactSensitiveFields`; 5 client `*.tsx` files reading `session.user.role`.
- `src/lib/audit.ts` — verified `writeAuditLog` signature accepts `metadata: Record<string, unknown>`.
- `migrations/0046..0049_*.sql` — verified house style for hand-authored idempotent migrations.

### Secondary (MEDIUM confidence)
- `.planning/research/v1.1-rbac-model.md` — original CASL recommendation; matches.
- `.planning/REQUIREMENTS.md` D-row — locks CASL versions.
- CASL docs (`https://casl.js.org`) — referenced via package metadata; not fetched directly in this session.

### Tertiary (LOW confidence)
- Drizzle 0.45 transaction atomicity across multiple migration files — inferred from project's house style of split migrations (0048 NOT-NULL flip separate from 0047). Not verified by reading drizzle-kit source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Versions verified against npm registry; peer-deps verified.
- Architecture (Ability builder + SSR boundary): HIGH — Pattern verified against CASL source + project's existing `react.cache` idiom.
- Better Auth integration (Q1): HIGH — 12 reading sites verified by grep of vendor source.
- Field registry (Q2): HIGH — `getTableColumns` API verified; pattern is well-established.
- Migration ordering (Q3): MEDIUM — Three-file split inferred from house style (0048 example); not verified against drizzle-kit's documented behaviour for cross-file atomicity.
- `<Can>` audit (Q4): MEDIUM — Grep was `*.tsx`-only with explicit role-equality patterns; could miss dynamic destructuring.
- Audit shapes (Q5): HIGH — Verified against existing `writeAuditLog` signature.
- Lock-out validation (Q6): HIGH — SQL is direct; transaction shape matches existing patterns.
- Pitfalls: HIGH — Each derived from observed CASL source or existing project regressions (Phase 9.1, lockfile saga).

**Research date:** 2026-05-10
**Valid until:** 2026-06-09 (30 days; CASL is stable, Better Auth 1.5.x is stable). Re-verify if Better Auth bumps to 1.6+ or CASL to 7.x before then.

---

## RESEARCH COMPLETE

- **Q1 reverses a CONTEXT decision:** Better Auth admin plugin reads `user.role` text in 12 endpoint handlers — `user.role` MUST stay populated. Recommend keeping `user.role` as a denormalised mirror of the user's primary tier (refreshed in the same transaction as `user_roles` writes). The CONTEXT-locked "replace `user.role` with `role_id` in one migration" should be revised by the planner.
- **One-PR migration is feasible** with `requireRole` / `redactSensitiveFields` shims preserving signatures while internally delegating to `ability` — Wave-by-wave call-site rewrite of all 59 files in the same PR avoids straddling-deploy risk; the only deferral is the never-actually-needed `user.role` text drop.
- **Field registry must be auto-derived** via `getTableColumns(table)` because `permittedFieldsOf` requires a `fieldsFrom` callback and CASL has no built-in subject-fields universe; a hand-maintained map (Option B) would silently drift like the project's existing `EDITABLE_LOCATION_FIELDS` allow-lists.
