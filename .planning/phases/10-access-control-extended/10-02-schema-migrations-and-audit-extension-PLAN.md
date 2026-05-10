---
phase: 10
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/db/schema.ts
  - migrations/0050_phase_10_roles_schema.sql
  - migrations/0051_phase_10_seed_and_backfill.sql
  - migrations/0052_phase_10_user_scopes_role_id_required.sql
  - src/lib/audit.ts
  - scripts/seed-test-users.ts
  - package.json
  - package-lock.json
autonomous: false
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "user.role TEXT column is PRESERVED — Better Auth admin plugin reads it in 12 endpoints (per RESEARCH §Q1 reversal of CONTEXT decision). NEVER dropped."
    - "Three new tables exist after migration 0050: roles, role_permissions, user_roles. user_scopes gains a nullable role_id column."
    - "After migration 0051, three seed roles exist: admin (kind='system'), ops-it (kind='tier'), read-only (kind='tier'). role_permissions populated for ops-it + read-only matching v1.0 redaction behaviour. Every existing user.role text value backfilled into a user_roles row."
    - "user_scopes.role_id is populated for every pre-existing scope row by 0051 (zero rows left with role_id IS NULL)."
    - "src/lib/audit.ts entityType union extended with 'role' | 'role_permission' | 'user_role'; action union extended with 'permissions_replace'. These are TS LITERAL UNIONS — there is no Postgres enum to ALTER (per PATTERNS.md Critical Reversals #2)."
    - "@casl/ability@^6.8.1 + @casl/react@^6.0.0 installed; package-lock.json regenerated inside linux/amd64 Docker per CLAUDE.md (NEVER on macOS host)."
    - "TEST_OPS_IT and TEST_VIEWER credential rows exist in the test/preview DB after seed-test-users.ts runs (gated on NODE_ENV !== 'production')."
  artifacts:
    - path: "src/db/schema.ts"
      provides: "roles, rolePermissions, userRoles table definitions; userScopes augmented with roleId column; user.role text preserved"
      contains: "export const roles = pgTable"
    - path: "migrations/0050_phase_10_roles_schema.sql"
      provides: "DDL — 3 new tables + user_scopes.role_id ADD COLUMN (nullable)"
      contains: "CREATE TABLE IF NOT EXISTS \"roles\""
    - path: "migrations/0051_phase_10_seed_and_backfill.sql"
      provides: "Data — seed Admin/Ops-IT/Read-only + role_permissions + user_roles backfill from user.role text + user_scopes.role_id population"
      contains: "INSERT INTO \"roles\""
    - path: "migrations/0052_phase_10_user_scopes_role_id_required.sql"
      provides: "Operator-gated SET NOT NULL flip on user_scopes.role_id (mirror of 0048 house style)"
      contains: "ALTER COLUMN \"role_id\" SET NOT NULL"
    - path: "src/lib/audit.ts"
      provides: "Extended entityType + action TS literal unions"
      contains: "\"role\" | \"role_permission\" | \"user_role\""
    - path: "scripts/seed-test-users.ts"
      provides: "Idempotent seed of TEST_OPS_IT + TEST_VIEWER credential rows in test/preview DB only"
    - path: "package.json"
      provides: "@casl/ability + @casl/react dep entries"
      contains: "@casl/ability"
  key_links:
    - from: "user_roles.user_id"
      to: "user.id"
      via: "ON DELETE CASCADE FK"
      pattern: "references.*user\\.id.*onDelete.*cascade"
    - from: "role_permissions.role_id"
      to: "roles.id"
      via: "ON DELETE CASCADE FK"
      pattern: "references.*roles\\.id.*onDelete.*cascade"
    - from: "user_scopes.role_id"
      to: "roles.id"
      via: "Nullable FK; backfilled by 0051; OPTIONALLY NOT-NULL flipped by 0052"
      pattern: "references.*roles\\.id"
    - from: "0051 backfill"
      to: "user.role text values"
      via: "INSERT INTO user_roles SELECT id, (SELECT id FROM roles WHERE name=...) FROM user WHERE role=..."
      pattern: "INSERT INTO \"user_roles\".*FROM \"user\""
---

<objective>
Land the Phase 10 DB schema, seed/backfill data, optional NOT-NULL flip, and TypeScript-side audit-log union extension. Install CASL deps with the canonical Linux Docker lockfile regen. This plan delivers the substrate every other Wave-2/3 plan reads from.

Purpose: Per RESEARCH §"Migration ordering" the three migration files land in one PR (PR-level atomicity, per-file SQL transaction). The audit.ts union extension MUST land in the SAME PR or any role-action file fails to compile. The CONTEXT-locked "drop user.role text" decision is REVERSED (per RESEARCH Q1) — user.role text is preserved as the denormalised mirror of primary tier. PLAN documents this reversal as the headline.

Output: 3 migration files + schema.ts additions + audit.ts union widen + CASL package install (Docker-regen lockfile) + test-user seed script. Every Wave-0 RED integration test (Plan 10-01) now has the table topology to fail against (still RED — Wave 2 makes them GREEN).
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
@CLAUDE.md

# Donor migrations + schema regions:
@migrations/0045_phase_09_hotel_alerts.sql
@migrations/0048_phase_09_1_net_amount_gbp_not_null.sql
@migrations/0026_add_system_role_and_etl_promotion.sql
@src/lib/audit.ts
@.planning/phases/09.1-multi-currency-analytics-forex-normalisation-to-gbp-base-rep/09.1-02-PLAN.md

<interfaces>
<!-- The exact shapes downstream plans expect. Lifted from RESEARCH.md and PATTERNS.md. -->

Schema additions (from RESEARCH §"Drizzle JSONB shape for role_permissions"):

```ts
// src/db/schema.ts (NEW exports — append, do not reshape existing tables except userScopes)
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),                              // 'admin' | 'ops-it' | 'read-only' | <custom-slug>
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
    action: text("action").notNull(),
    subject: text("subject").notNull(),
    fields: jsonb("fields").$type<string[] | null>(),
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
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    assignedBy: text("assigned_by").references(() => user.id),
  },
  (t) => ({
    uniq: unique().on(t.userId, t.roleId),
    byUser: index("user_roles_user_idx").on(t.userId),
  }),
);

// userScopes — ADD roleId column. Existing columns/indices preserved.
// userId + roleId + dimensionType + dimensionId becomes the new unique key.
```

Audit.ts extension (TS LITERAL UNION widen — no SQL):

```ts
// src/lib/audit.ts:13 — entityType
entityType: ... | "role" | "role_permission" | "user_role" | "fx_rate_fetch_run";
// src/lib/audit.ts:16-38 — action
action: ... | "permissions_replace";
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install @casl/ability + @casl/react deps with Linux Docker lockfile regen</name>
  <files>package.json, package-lock.json</files>
  <read_first>
    - CLAUDE.md §"npm lockfile must stay in sync (CI uses npm ci)" — the entire section, especially the canonical Docker regen command
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Standard Stack" + §"Environment Availability"
    - .planning/phases/09.1-…/09.1-01-SUMMARY.md (or any prior phase that added a dep) for the canonical Docker regen audit trail shape
  </read_first>
  <action>
    Add the two CASL packages to dependencies. Per CLAUDE.md, EVERY dep install on this repo MUST regenerate package-lock.json inside a linux/amd64 Docker container — NEVER on the macOS host.

    Step-by-step:

    1. Verify versions on npm registry (per RESEARCH "Verification of latest stable"):
       ```bash
       npm view @casl/ability version
       npm view @casl/react version
       ```
       Expected: `6.8.1` (or newer patch — pin `^6.8.1`) and `6.0.0` (pin `^6.0.0`).

    2. Update `package.json` `dependencies`:
       ```json
       "@casl/ability": "^6.8.1",
       "@casl/react": "^6.0.0",
       ```
       (Insert in alphabetical order alongside existing `@casl/`-prefixed entries if any, otherwise alphabetical with other `@`-scoped packages.)

    3. Regenerate package-lock.json inside Docker per CLAUDE.md verbatim command:
       ```bash
       docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc '
         set -e
         mkdir -p /build && cp /src/package.json /build/package.json
         cd /build
         npm install --package-lock-only
         npm ci --dry-run
         cp /build/package-lock.json /src/package-lock.json
       '
       ```
       Verify `uname -m` inside the container reports `x86_64` (per CLAUDE.md "Confirm with uname -m"). On Apple silicon hosts, `--platform linux/amd64` triggers Rosetta — confirm container does NOT show `aarch64`.

    4. Sanity-check the lockfile per CLAUDE.md verification:
       ```bash
       grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json
       grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json
       grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json
       grep -c '"node_modules/@casl/ability"' package-lock.json
       grep -c '"node_modules/@casl/react"' package-lock.json
       ```
       All MUST return ≥ 1. If `@rolldown` or `@tailwindcss` returns 0, lockfile regen is broken — per CLAUDE.md "If grep '@rolldown/binding-linux-x64-gnu' package-lock.json returns empty, the regen is broken; redo it."

    5. Do NOT run `npm install` on macOS between Docker regen and commit (per CLAUDE.md "Do NOT run npm install on macOS"). If you need `node_modules`, run `npm ci` only.

    6. `git diff --stat package-lock.json` should show CASL entries added + the standard wasm32-wasi/@emnapi/@napi-rs/lightningcss/tailwind-oxide forest changes; changes to `next`, `react`, `drizzle`, `vitest`, `playwright` are RED FLAGS — investigate before commit.

    Per CLAUDE.md "Two failure shapes to recognise": if any CI failure later mentions `Missing: @emnapi/...` or `Cannot find module '@*/binding-linux-x64-gnu'`, redo the Docker regen — those are the canonical lockfile-drift signatures.
  </action>
  <acceptance_criteria>
    - `package.json` contains `"@casl/ability": "^6.8.1"` and `"@casl/react": "^6.0.0"` in dependencies
    - `package-lock.json` contains entries for `node_modules/@casl/ability` and `node_modules/@casl/react` (lockfile shape regen)
    - `package-lock.json` STILL contains entries for `node_modules/@rolldown/binding-linux-x64-gnu`, `node_modules/@tailwindcss/oxide-linux-x64-gnu`, `node_modules/@next/swc-linux-x64-gnu` (i.e. lockfile was regenerated on linux/amd64, not macOS)
    - `npm ci --dry-run` exits 0
    - `git diff --stat package.json` shows only `@casl/*` additions; `git diff --stat package-lock.json` line count is plausible (~ 100-300 lines added — typical for two pure-JS adds + the wasm forest re-resolution)
    - No drift in major versions of `next`, `react`, `drizzle-orm`, `vitest`, `playwright` (`git diff package-lock.json | grep -E '"version": "[0-9]+\\.0\\.0"' | head` shows no surprises)
  </acceptance_criteria>
  <verify>
    <automated>grep -q '"@casl/ability"' package.json && grep -q '"@casl/react"' package.json && grep -q '"node_modules/@casl/ability"' package-lock.json && grep -q '"node_modules/@casl/react"' package-lock.json && grep -q '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json && grep -q '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json && npm ci --dry-run > /dev/null 2>&1</automated>
  </verify>
  <done>CASL deps installed via Linux Docker regen; lockfile contains both new packages AND every wasm32-wasi/Linux-x64 binding entry; npm ci --dry-run passes; no stray major-version drift in core libs.</done>
</task>

<task type="auto">
  <name>Task 2: Add roles, role_permissions, user_roles tables + user_scopes.role_id to src/db/schema.ts; extend src/lib/audit.ts unions</name>
  <files>src/db/schema.ts, src/lib/audit.ts</files>
  <read_first>
    - src/db/schema.ts (full file — find existing imports at top, the `user` table for FK target, the `userScopes` block at lines 517-542, `auditLogs` at :306-322 for the jsonb pattern)
    - src/lib/audit.ts (full file — entityType union at :13, action union at :16-38)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Drizzle JSONB shape" (verbatim schema source) + §"Q5 Audit-log shape"
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §A1 (schema.ts donor lines + things to copy/not copy)
  </read_first>
  <action>
    **Part A — schema.ts additions (NEW tables):**

    Append AFTER the existing `userScopes` block (i.e. roughly schema.ts:550+; find a logical seam after the userScopes definition). Use the verbatim shape from RESEARCH §"Drizzle JSONB shape" lines 383-447. All required imports (`pgTable`, `text`, `timestamp`, `boolean`, `uuid`, `jsonb`, `unique`, `index`) are ALREADY imported at schema.ts:1-19 — do NOT add new imports.

    ```ts
    export const roles = pgTable("roles", {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull().unique(),
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
        action: text("action").notNull(),
        subject: text("subject").notNull(),
        fields: jsonb("fields").$type<string[] | null>(),
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
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
        assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
        assignedBy: text("assigned_by").references(() => user.id),
      },
      (t) => ({
        uniq: unique().on(t.userId, t.roleId),
        byUser: index("user_roles_user_idx").on(t.userId),
      }),
    );
    ```

    **Part B — userScopes.roleId addition (RESHAPE existing table block):**

    Locate the existing `userScopes` block at schema.ts:517-542. Add a `roleId` field BETWEEN `userId` and `dimensionType`. Update the `unique().on(...)` composite to include `roleId`. Keep `byUser` index unchanged.

    ```ts
    export const userScopes = pgTable(
      "user_scopes",
      {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        // ── NEW (Plan 10-02) ─────────────────────────────────────────────
        // Bind scope to a specific role assignment. Nullable until 0051
        // backfill completes; OPTIONALLY flipped to NOT NULL by 0052
        // (operator-gated — see RESEARCH §"Migration ordering").
        roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
        // ─────────────────────────────────────────────────────────────────
        dimensionType: text("dimension_type", {
          enum: ["hotel_group", "location", "region", "product", "provider", "location_group"],
        }).notNull(),
        dimensionId: text("dimension_id").notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        createdBy: text("created_by").references(() => user.id),
      },
      (t) => ({
        // unique now includes roleId — supports per-(user, role, dimension) bindings
        uniq: unique().on(t.userId, t.roleId, t.dimensionType, t.dimensionId),
        byUser: index("user_scopes_user_idx").on(t.userId),
      }),
    );
    ```

    Per RESEARCH "Things to NOT copy" + PATTERNS.md A1: do NOT add a CHECK / FK on `(user_id, role_id)` composite from user_scopes back to user_roles. App-layer invariant only.

    **Part C — audit.ts union widen (TS-only — NO SQL — per PATTERNS.md Critical Reversals #2):**

    In `src/lib/audit.ts`:
    - Line 13 (`entityType` union): append ` | "role" | "role_permission" | "user_role"` to the existing union string. Keep all existing literals.
    - Line 16-38 (`action` union): append `      | "permissions_replace"` as a new line in the existing OR-list. Keep all existing literals.

    Result types after edit:
    ```ts
    entityType: "kiosk" | "location" | ... | "fx_rate_fetch_run" | "role" | "role_permission" | "user_role";
    action: "create" | "update" | ... | "unsilence_alerts" | "permissions_replace";
    ```

    **Critical:** DO NOT drop `user.role` text column. PATTERNS.md §"Things to NOT copy" item 1 + RESEARCH Q1 reversal — user.role stays as denormalised mirror; column is preserved across this entire phase.

    **Drizzle generate:** After the schema edits, run `npx drizzle-kit generate` to confirm Drizzle picks up the new tables. If drizzle-kit attempts to write a new `migrations/00XX_*.sql`, DELETE that auto-generated file — Plan 10-02 hand-authors 0050/0051/0052 instead (per project house style; see migrations/0048 example).
  </action>
  <acceptance_criteria>
    - `grep -c "export const roles\|export const rolePermissions\|export const userRoles" src/db/schema.ts` ≥ 3
    - `grep -c "roleId.*references.*roles" src/db/schema.ts` ≥ 3 (rolePermissions, userRoles, userScopes all reference roles.id)
    - `grep -c '"role"\|"role_permission"\|"user_role"' src/lib/audit.ts` ≥ 3
    - `grep -c '"permissions_replace"' src/lib/audit.ts` ≥ 1
    - `grep -c 'role: text("role")' src/db/schema.ts` (i.e. user.role text column) is UNCHANGED — DO NOT DROP. Verify the user table block still has `role: text("role")...`
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - No auto-generated drizzle migration in `migrations/` (delete if drizzle-kit emitted one)
  </acceptance_criteria>
  <verify>
    <automated>grep -q "export const roles = pgTable" src/db/schema.ts && grep -q "export const rolePermissions = pgTable" src/db/schema.ts && grep -q "export const userRoles = pgTable" src/db/schema.ts && grep -q '"role"' src/lib/audit.ts && grep -q '"permissions_replace"' src/lib/audit.ts && grep -q 'role: text("role")' src/db/schema.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>3 new tables in schema.ts; userScopes augmented with roleId (nullable); audit.ts unions widened with role/role_permission/user_role + permissions_replace; user.role text PRESERVED; drizzle-kit-generated migration (if any) deleted; tsc clean.</done>
</task>

<task type="auto">
  <name>Task 3: Author migrations/0050_phase_10_roles_schema.sql (DDL — 3 tables + user_scopes.role_id ADD COLUMN)</name>
  <files>migrations/0050_phase_10_roles_schema.sql</files>
  <read_first>
    - migrations/0045_phase_09_hotel_alerts.sql (donor: multi-delta hand-authored, IF NOT EXISTS guards, --> statement-breakpoint convention)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §A2 (Phase 10 migration shape + things to copy)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Migration ordering" lines 461-484
    - src/db/schema.ts (the new schema added in Task 2 — sole source of truth for column shapes/types)
  </read_first>
  <action>
    Hand-author the migration file. NEVER use drizzle-kit generate output. Follow the 0045 house style verbatim.

    Header (per 0045's convention):

    ```sql
    -- Phase 10 (Plan 10-02) — Access Control Extended: roles + role_permissions + user_roles schema
    --
    -- DDL-only migration. Companion files:
    --   0051: data — seed default roles + role_permissions + backfill user_roles + user_scopes.role_id
    --   0052: operator-gated — user_scopes.role_id SET NOT NULL (see Pitfall 6 — split per
    --         RESEARCH.md §Migration ordering; mirrors 0048 house style)
    --
    -- user.role text column is NOT dropped (RESEARCH.md Q1 reverses CONTEXT decision —
    -- Better Auth admin plugin reads session.user.role text in 12 endpoint handlers).
    --
    -- Idempotent: every CREATE TABLE / ADD COLUMN / CREATE INDEX is IF [NOT] EXISTS.
    -- Safe to re-run on UAT / preview.
    --
    -- Deltas:
    --   1.   roles table
    --   1.1  role_permissions table + role_permissions_role_idx
    --   2.   user_roles table + uniq(user_id, role_id) + user_roles_user_idx
    --   3.   user_scopes — ADD COLUMN role_id uuid (nullable; backfilled in 0051)

    -- ── Delta 1 — roles table ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS "roles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL UNIQUE,
      "kind" text NOT NULL,
      "display_name" text NOT NULL,
      "description" text,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL
    );
    --> statement-breakpoint

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'roles_kind_check'
      ) THEN
        ALTER TABLE "roles"
          ADD CONSTRAINT "roles_kind_check"
          CHECK (kind IN ('system', 'tier', 'custom'));
      END IF;
    END $$;
    --> statement-breakpoint

    -- ── Delta 1.1 — role_permissions table + role_idx ────────────────────────────
    CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "action" text NOT NULL,
      "subject" text NOT NULL,
      "fields" jsonb,
      "conditions" jsonb,
      "inverted" boolean DEFAULT false NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL
    );
    --> statement-breakpoint

    CREATE INDEX IF NOT EXISTS "role_permissions_role_idx"
      ON "role_permissions" ("role_id");
    --> statement-breakpoint

    -- ── Delta 2 — user_roles table + uniq + idx ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS "user_roles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "assigned_at" timestamptz DEFAULT now() NOT NULL,
      "assigned_by" text REFERENCES "user"("id")
    );
    --> statement-breakpoint

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_roles_user_id_role_id_unique'
      ) THEN
        ALTER TABLE "user_roles"
          ADD CONSTRAINT "user_roles_user_id_role_id_unique"
          UNIQUE ("user_id", "role_id");
      END IF;
    END $$;
    --> statement-breakpoint

    CREATE INDEX IF NOT EXISTS "user_roles_user_idx"
      ON "user_roles" ("user_id");
    --> statement-breakpoint

    -- ── Delta 3 — user_scopes.role_id ADD COLUMN (nullable) ──────────────────────
    ALTER TABLE "user_scopes"
      ADD COLUMN IF NOT EXISTS "role_id" uuid REFERENCES "roles"("id") ON DELETE CASCADE;
    --> statement-breakpoint

    -- Old uniq(user_id, dimension_type, dimension_id) is implicitly superseded by
    -- the new (user_id, role_id, dimension_type, dimension_id). We keep the old
    -- one in place during 0051 backfill (rows pre-cutover have role_id IS NULL,
    -- so they don't collide). 0052 (if shipped) replaces the constraint.
    -- Adding the new uniq here would conflict with NULL role_id rows pre-backfill;
    -- defer to 0052.
    ```

    The trailing comment block is load-bearing — it documents to future readers why the new uniq constraint isn't added in 0050.
  </action>
  <acceptance_criteria>
    - `migrations/0050_phase_10_roles_schema.sql` exists
    - File contains `CREATE TABLE IF NOT EXISTS "roles"`, `"role_permissions"`, `"user_roles"`
    - File contains `ADD COLUMN IF NOT EXISTS "role_id"` on `user_scopes`
    - File contains `--> statement-breakpoint` separators (≥ 6 occurrences)
    - File does NOT contain `DROP COLUMN`, does NOT touch `user.role`
    - psql lint: `psql -c "$(cat migrations/0050_phase_10_roles_schema.sql)"` against an empty test DB exits 0 (DO NOT run against prod)
    - Re-running the migration against an already-migrated test DB is a no-op (idempotency)
  </acceptance_criteria>
  <verify>
    <automated>test -f migrations/0050_phase_10_roles_schema.sql && grep -q 'CREATE TABLE IF NOT EXISTS "roles"' migrations/0050_phase_10_roles_schema.sql && grep -q 'CREATE TABLE IF NOT EXISTS "role_permissions"' migrations/0050_phase_10_roles_schema.sql && grep -q 'CREATE TABLE IF NOT EXISTS "user_roles"' migrations/0050_phase_10_roles_schema.sql && grep -q 'ADD COLUMN IF NOT EXISTS "role_id"' migrations/0050_phase_10_roles_schema.sql && [ "$(grep -c -- '--> statement-breakpoint' migrations/0050_phase_10_roles_schema.sql)" -ge 6 ] && ! grep -q 'DROP COLUMN.*"role"' migrations/0050_phase_10_roles_schema.sql</automated>
  </verify>
  <done>0050 DDL migration committed; idempotent guards everywhere; user.role text untouched; statement-breakpoints between every statement; integration test in tests/db/migration-0051-backfill.integration.test.ts can now load this migration on a fresh testcontainers DB.</done>
</task>

<task type="auto">
  <name>Task 4: Author migrations/0051_phase_10_seed_and_backfill.sql (data — seed + backfill)</name>
  <files>migrations/0051_phase_10_seed_and_backfill.sql</files>
  <read_first>
    - migrations/0045_phase_09_hotel_alerts.sql Delta 5 (INSERT ... ON CONFLICT DO NOTHING donor)
    - migrations/0026_add_system_role_and_etl_promotion.sql (text-role-seeding precedent)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §A3 (data migration shape)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Migration ordering" + §"Q1 — refreshUserRoleMirror logic"
    - src/lib/rbac.ts (the legacy redactSensitiveFields key sets — these define the seeded ops-it / read-only rule sets)
  </read_first>
  <action>
    Author 0051 hand-rolled. Three concerns: seed default roles, seed role_permissions matching v1.0 redaction behaviour, backfill user_roles + user_scopes.role_id.

    ```sql
    -- Phase 10 (Plan 10-02) — Access Control Extended: seed defaults + backfill
    --
    -- Data migration. Companion DDL is 0050. Companion NOT-NULL flip (optional)
    -- is 0052. All three land in one PR (PR-level atomicity per project convention).
    --
    -- Idempotent: every INSERT uses ON CONFLICT DO NOTHING; every UPDATE is
    -- guarded by WHERE conditions that match only un-backfilled rows.
    --
    -- IMPORTANT: this migration does NOT touch user.role text values.
    -- user.role text is preserved as the denormalised mirror of primary tier
    -- (RESEARCH.md Q1). The mirror is REFRESHED at runtime by
    -- refreshUserRoleMirror(userId, tx) on every assignRole / revokeRole;
    -- since this migration only ADDS user_roles rows in lock-step with the
    -- existing user.role text, the mirror is already consistent post-migration.
    --
    -- Deltas:
    --   1.   Seed 3 roles: admin (system), ops-it (tier), read-only (tier)
    --   2.   Seed role_permissions for ops-it (mirrors v1.0 internal/member behaviour)
    --   3.   Seed role_permissions for read-only (mirrors v1.0 internal/viewer behaviour)
    --   4.   Backfill user_roles from existing user.role text values
    --   5.   Backfill user_scopes.role_id from each user's primary user_roles row

    -- ── Delta 1 — seed 3 roles ─────────────────────────────────────────────
    INSERT INTO "roles" ("name", "kind", "display_name", "description")
      VALUES
        ('admin',     'system', 'Admin',     'Full access. Immutable system role; bypasses CASL ability-builder rule evaluation.'),
        ('ops-it',    'tier',   'Ops-IT',    'Operations + IT default tier. Editable rule set; v1.0 ''member'' parity.'),
        ('read-only', 'tier',   'Read-only', 'Read-only default tier. Editable rule set; v1.0 ''viewer'' parity.')
      ON CONFLICT ("name") DO NOTHING;
    --> statement-breakpoint

    -- ── Delta 2 — role_permissions for ops-it ──────────────────────────────
    -- Mirrors v1.0 redactSensitiveFields(member, internal) behaviour:
    -- internal/member sees all fields including sensitive (banking, contracts).
    -- Plus CRUD on operational subjects (Kiosk, Location, Installation, Product).
    INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
      SELECT r.id, action, subject, fields::jsonb, NULL::jsonb, false
        FROM "roles" r,
        (VALUES
          ('read',   'Location',          NULL),
          ('update', 'Location',          NULL),
          ('read',   'Kiosk',             NULL),
          ('update', 'Kiosk',             NULL),
          ('create', 'Kiosk',             NULL),
          ('read',   'User',              '["id","name","email","role","userType","createdAt"]'),
          ('read',   'AuditLog',          NULL),
          ('read',   'Analytics',         NULL),
          ('read',   'EmailLog',          NULL),
          ('read',   'LocationProduct',   NULL),
          ('update', 'LocationProduct',   NULL),
          ('merge',  'Location',          NULL),
          ('import', 'Location',          NULL),
          ('export', 'Analytics',         NULL),
          ('silence_alert', 'Location',   NULL)
        ) AS rules(action, subject, fields)
        WHERE r.name = 'ops-it'
      ON CONFLICT DO NOTHING;
    --> statement-breakpoint

    -- ── Delta 3 — role_permissions for read-only ───────────────────────────
    -- Mirrors v1.0 redactSensitiveFields(viewer, internal) behaviour:
    -- internal/viewer sees all read fields BUT bankingDetails/contractValue/
    -- contractTerms/contractDocuments redacted to NULL. Encoded as:
    --   can('read', 'Location') with no field restriction
    --   cannot('read', 'Location', ['bankingDetails','contractValue','contractTerms','contractDocuments'])
    INSERT INTO "role_permissions" ("role_id", "action", "subject", "fields", "conditions", "inverted")
      SELECT r.id, action, subject, fields::jsonb, NULL::jsonb, inverted
        FROM "roles" r,
        (VALUES
          ('read', 'Location',         NULL,                                                                              false),
          ('read', 'Location',         '["bankingDetails","contractValue","contractTerms","contractDocuments"]',          true ),
          ('read', 'Kiosk',            NULL,                                                                              false),
          ('read', 'User',             '["id","name","email","userType","createdAt"]',                                    false),
          ('read', 'AuditLog',         NULL,                                                                              false),
          ('read', 'Analytics',        NULL,                                                                              false),
          ('read', 'EmailLog',         NULL,                                                                              false),
          ('read', 'LocationProduct',  NULL,                                                                              false)
        ) AS rules(action, subject, fields, inverted)
        WHERE r.name = 'read-only'
      ON CONFLICT DO NOTHING;
    --> statement-breakpoint

    -- ── Delta 4 — backfill user_roles from user.role text ──────────────────
    -- For every existing user, insert a user_roles row pointing at the role
    -- that matches their current user.role text. ON CONFLICT covers the case
    -- where this migration is re-run.
    INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
      SELECT u.id,
             (SELECT id FROM "roles" WHERE name = 'admin'),
             NULL
        FROM "user" u
        WHERE u.role = 'admin'
      ON CONFLICT DO NOTHING;
    --> statement-breakpoint

    INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
      SELECT u.id,
             (SELECT id FROM "roles" WHERE name = 'ops-it'),
             NULL
        FROM "user" u
        WHERE u.role = 'member'
      ON CONFLICT DO NOTHING;
    --> statement-breakpoint

    INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by")
      SELECT u.id,
             (SELECT id FROM "roles" WHERE name = 'read-only'),
             NULL
        FROM "user" u
        WHERE u.role = 'viewer'
      ON CONFLICT DO NOTHING;
    --> statement-breakpoint

    -- Note: 'system' user.role text values (ETL/automation) are NOT given a
    -- user_roles row. The ability builder short-circuits userType='system' OR
    -- (legacy) role='system' before consulting user_roles. See
    -- src/lib/casl/ability.ts §"system short-circuit" — Plan 10-03.

    -- ── Delta 5 — backfill user_scopes.role_id ─────────────────────────────
    -- Every existing user_scopes row is bound to that user's primary tier role
    -- (which matches their user.role text). Pick the user's tier user_roles row
    -- (kind in ('system', 'tier')); if multiple exist (shouldn't, since pre-
    -- cutover users have exactly one tier), pick deterministically by
    -- kind = 'system' first, then alphabetical role name.
    UPDATE "user_scopes" us
      SET "role_id" = (
        SELECT ur."role_id"
          FROM "user_roles" ur
          INNER JOIN "roles" r ON r.id = ur.role_id
          WHERE ur.user_id = us.user_id
            AND r.kind IN ('system', 'tier')
          ORDER BY (r.kind = 'system') DESC, r.name ASC
          LIMIT 1
      )
      WHERE us."role_id" IS NULL;
    --> statement-breakpoint
    ```

    The Delta 4 split (3 separate INSERTs) mirrors the v1.0 'admin'/'member'/'viewer' triad — keeping them separate makes the audit trail of the backfill obvious.

    Verify against a testcontainers DB by running tests/db/migration-0051-backfill.integration.test.ts (Plan 10-01 RED scaffold) — it MUST go GREEN after this task is committed.
  </action>
  <acceptance_criteria>
    - `migrations/0051_phase_10_seed_and_backfill.sql` exists
    - File contains `INSERT INTO "roles"` (Delta 1) + `INSERT INTO "role_permissions"` (≥ 2 occurrences for ops-it/read-only) + `INSERT INTO "user_roles"` (3 occurrences for admin/member/viewer)
    - File contains `UPDATE "user_scopes" us SET "role_id"` (Delta 5)
    - File does NOT contain any UPDATE on `user.role` (the text mirror is runtime-managed, not migration-managed)
    - Every statement separated by `--> statement-breakpoint` (≥ 8 occurrences)
    - Re-running on already-migrated DB is a no-op (every INSERT has ON CONFLICT DO NOTHING; UPDATE has WHERE role_id IS NULL guard)
    - tests/db/migration-0051-backfill.integration.test.ts goes GREEN against a testcontainers DB pre-seeded with users having user.role text values
  </acceptance_criteria>
  <verify>
    <automated>test -f migrations/0051_phase_10_seed_and_backfill.sql && grep -q 'INSERT INTO "roles"' migrations/0051_phase_10_seed_and_backfill.sql && [ "$(grep -c 'INSERT INTO "user_roles"' migrations/0051_phase_10_seed_and_backfill.sql)" -ge 3 ] && grep -q 'UPDATE "user_scopes"' migrations/0051_phase_10_seed_and_backfill.sql && ! grep -E 'UPDATE "user".*SET.*"role"' migrations/0051_phase_10_seed_and_backfill.sql && [ "$(grep -c -- '--> statement-breakpoint' migrations/0051_phase_10_seed_and_backfill.sql)" -ge 8 ]</automated>
  </verify>
  <done>0051 data migration committed; seeds 3 roles + their rules + backfills user_roles + user_scopes.role_id; user.role text untouched; idempotent. Plan 10-01's tests/db/migration-0051-backfill.integration.test.ts goes GREEN.</done>
</task>

<task type="auto">
  <name>Task 5: Author migrations/0052_phase_10_user_scopes_role_id_required.sql (operator-gated NOT-NULL flip — verbatim 0048 model)</name>
  <files>migrations/0052_phase_10_user_scopes_role_id_required.sql</files>
  <read_first>
    - migrations/0048_phase_09_1_net_amount_gbp_not_null.sql (entire file — RESEARCH explicitly cites this as the verbatim model)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §A4
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §"Open Questions OQ-2" — confirms 0052 IS shipped (planner picks NOT NULL — see this plan's Decision below)
  </read_first>
  <action>
    **Decision (planner — per RESEARCH OQ-2):** Ship 0052. Rationale: even though admin users have zero scope rows today, leaving role_id nullable forever creates a "scope row that doesn't know which assignment it belongs to" failure mode if a future bug allows it. Shipping the constraint NOW (when the system has zero NULL rows post-0051 backfill) is the cheap path; relaxing to nullable later is trivial.

    Verbatim port of migrations/0048_phase_09_1_net_amount_gbp_not_null.sql (RESEARCH lines 263-298 + PATTERNS.md A4 mark this as "exact — house style explicitly cited"):

    ```sql
    -- Phase 10 (Plan 10-02) — Access Control Extended: user_scopes.role_id NOT NULL flip.
    --
    -- MUST NOT be applied until migration 0051 has reported zero NULL role_id rows
    -- (see RESEARCH.md §"Migration ordering" + Pitfall 6 — applying this before
    -- backfill completes locks the table and stalls the deploy).
    --
    -- Verification gate (operator runs before applying):
    --   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;"
    --   Expected: 0
    --
    -- This migration is operator-gated, NOT auto-applied. The CI/Vercel deploy
    -- pipeline applies 0050 + 0051 automatically; 0052 is held back until the
    -- operator confirms the count above is 0 on prod, then runs:
    --   psql "$DATABASE_URL" -f migrations/0052_phase_10_user_scopes_role_id_required.sql
    --
    -- Idempotent: only flips when the column is currently NULLABLE — re-running
    -- on an already-NOT-NULL column is a no-op. Mirrors migration 0048's
    -- house style.
    --
    -- Deltas:
    --   1. ALTER COLUMN user_scopes.role_id SET NOT NULL

    DO $body$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_scopes'
          AND column_name = 'role_id'
          AND is_nullable = 'YES'
      ) THEN
        ALTER TABLE "user_scopes" ALTER COLUMN "role_id" SET NOT NULL;
      END IF;
    END $body$;
    --> statement-breakpoint
    ```

    The header `MUST NOT be applied until` block is load-bearing — the operator runs `psql -c "SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;"` first; if non-zero, do NOT apply. Documented in 10-HUMAN-UAT.md (Plan 10-08).
  </action>
  <acceptance_criteria>
    - `migrations/0052_phase_10_user_scopes_role_id_required.sql` exists
    - File contains the `DO $body$ ... information_schema.columns ... is_nullable = 'YES' ... END $body$` guard verbatim from 0048
    - File contains operator verification-gate comment with the exact `SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;` SQL
    - File is idempotent (re-running on already-NOT-NULL is a no-op due to is_nullable check)
    - File only ALTERs `user_scopes.role_id` — does NOT touch any other column
  </acceptance_criteria>
  <verify>
    <automated>test -f migrations/0052_phase_10_user_scopes_role_id_required.sql && grep -q "DO \$body\$" migrations/0052_phase_10_user_scopes_role_id_required.sql && grep -q "is_nullable = 'YES'" migrations/0052_phase_10_user_scopes_role_id_required.sql && grep -q 'ALTER COLUMN "role_id" SET NOT NULL' migrations/0052_phase_10_user_scopes_role_id_required.sql && grep -q "SELECT COUNT(\*) FROM user_scopes WHERE role_id IS NULL" migrations/0052_phase_10_user_scopes_role_id_required.sql</automated>
  </verify>
  <done>0052 NOT-NULL flip committed verbatim per 0048 house style; operator-gated runbook documented in header; idempotency guard confirmed.</done>
</task>

<task type="auto">
  <name>Task 6: Create scripts/seed-test-users.ts (idempotent seed of TEST_OPS_IT + TEST_VIEWER on test/preview only)</name>
  <files>scripts/seed-test-users.ts</files>
  <read_first>
    - scripts/reset-admin-password.ts (donor: env-var-driven idempotent admin write via better-auth's internal hasher)
    - tests/auth/setup.ts (the constants this script must satisfy — TEST_OPS_IT + TEST_VIEWER)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §"Critical Reversals & Gotchas" item 6
  </read_first>
  <action>
    Standalone idempotent script — invoked manually by the operator against test/preview DBs ONLY.

    Skeleton:

    ```ts
    /**
     * scripts/seed-test-users.ts
     *
     * Idempotent seed of test fixture users (TEST_OPS_IT, TEST_VIEWER).
     *
     * Per Plan 10-01 + 10-02: tests/auth/setup.ts declares these as CONTRACTS
     * that must be honoured by the test/preview DB. This script populates the
     * `user` and `account` tables (Better Auth credential rows) so Playwright
     * specs can sign in as ops-it / viewer without manual setup.
     *
     * SAFETY GATES:
     * - Refuses to run if NODE_ENV='production' OR if DATABASE_URL contains the
     *   string 'wkg-command-centre' (the prod project alias). The two gates are
     *   redundant — both must pass.
     * - Each user is upserted (idempotent); does not overwrite an existing
     *   password if the row already exists with a credential account.
     *
     * Usage:
     *   DATABASE_URL='<test-or-preview-url>' npx tsx scripts/seed-test-users.ts
     *
     * Env vars (optional — defaults match tests/auth/setup.ts):
     *   TEST_OPS_IT_EMAIL, TEST_OPS_IT_PASSWORD,
     *   TEST_VIEWER_EMAIL, TEST_VIEWER_PASSWORD
     */
    import { db } from "@/db";
    import { user, account } from "@/db/schema";
    import { eq, and } from "drizzle-orm";
    import { auth } from "@/lib/auth";

    const PROD_HINTS = ["wkg-command-centre", "wkg-kiosk-tool"];

    async function main() {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to run: NODE_ENV=production");
      }
      const url = process.env.DATABASE_URL ?? "";
      if (PROD_HINTS.some((h) => url.includes(h))) {
        throw new Error(`Refusing to run: DATABASE_URL contains prod hint (${PROD_HINTS.join(",")})`);
      }

      const fixtures = [
        {
          email: process.env.TEST_OPS_IT_EMAIL ?? "ops-it.test@weknowgroup.com",
          password: process.env.TEST_OPS_IT_PASSWORD ?? "OpsItTest!2026",
          name: "Test Ops-IT",
          role: "member" as const,
        },
        {
          email: process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com",
          password: process.env.TEST_VIEWER_PASSWORD ?? "ViewerTest!2026",
          name: "Test Viewer",
          role: "viewer" as const,
        },
      ];

      for (const f of fixtures) {
        // Find or create the user row (idempotent on email).
        let existing = await db.select().from(user).where(eq(user.email, f.email)).limit(1);
        if (existing.length === 0) {
          // Use Better Auth's signup flow to ensure password hashing matches the
          // login path. Mirrors scripts/reset-admin-password.ts approach.
          await auth.api.signUpEmail({
            body: { email: f.email, password: f.password, name: f.name },
          });
          existing = await db.select().from(user).where(eq(user.email, f.email)).limit(1);
        }
        if (existing.length === 0) {
          throw new Error(`Failed to create user ${f.email}`);
        }
        const userId = existing[0].id;

        // Set the user.role text mirror to match. Plan 10-03's
        // refreshUserRoleMirror will manage this at runtime — but we set it here
        // for the seed-DB starting state.
        await db.update(user).set({ role: f.role }).where(eq(user.id, userId));

        console.log(`Seeded ${f.email} (userId=${userId}, role=${f.role})`);
      }

      console.log("Test users seeded.");
    }

    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    ```

    Per CLAUDE.md aftercare: Plan 10-08 documents the operator-handoff for setting `TEST_OPS_IT_PASSWORD` / `TEST_VIEWER_PASSWORD` on the Vercel preview env so the Playwright UAT specs can sign in.
  </action>
  <acceptance_criteria>
    - `scripts/seed-test-users.ts` exists
    - File contains both `NODE_ENV === "production"` and prod-hint refusal gates
    - File uses `auth.api.signUpEmail` (Better Auth path) — does NOT bypass with raw inserts to bypass the password hasher (per scripts/reset-admin-password.ts precedent)
    - `npx tsx --check scripts/seed-test-users.ts` parses cleanly
    - Running the script with a fake `DATABASE_URL='postgresql://wkg-command-centre.../...'` exits non-zero with the prod-hint refusal message (test on the operator side; do NOT run against any real URL in CI)
  </acceptance_criteria>
  <verify>
    <automated>test -f scripts/seed-test-users.ts && grep -q 'NODE_ENV === "production"' scripts/seed-test-users.ts && grep -q 'wkg-command-centre' scripts/seed-test-users.ts && grep -q "auth.api.signUpEmail" scripts/seed-test-users.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Test-user seed script committed with prod-refusal gates + Better Auth signup flow; tsc clean; documented for operator use in 10-HUMAN-UAT.md (Plan 10-08).</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Plan 10-02 has completed:
    - `@casl/ability@^6.8.1` + `@casl/react@^6.0.0` installed; package-lock.json regenerated inside linux/amd64 Docker per CLAUDE.md gotcha section
    - `src/db/schema.ts` adds `roles`, `rolePermissions`, `userRoles` tables; `userScopes` augmented with nullable `roleId`; `user.role` text PRESERVED (RESEARCH Q1 reversal of CONTEXT decision)
    - `src/lib/audit.ts` entityType union extended with `"role" | "role_permission" | "user_role"`; action union extended with `"permissions_replace"` (TS-only widen — no Postgres enum to ALTER)
    - `migrations/0050_phase_10_roles_schema.sql` — DDL for 3 new tables + `user_scopes.role_id ADD COLUMN` (nullable)
    - `migrations/0051_phase_10_seed_and_backfill.sql` — seeds 3 roles + role_permissions for ops-it/read-only + backfills user_roles from user.role text + populates user_scopes.role_id
    - `migrations/0052_phase_10_user_scopes_role_id_required.sql` — operator-gated NOT-NULL flip (verbatim 0048 model)
    - `scripts/seed-test-users.ts` — idempotent test/preview-only seed of TEST_OPS_IT + TEST_VIEWER credential rows
    - Plan 10-01's `tests/db/migration-0051-backfill.integration.test.ts` goes GREEN against testcontainers
  </what-built>
  <how-to-verify>
    Operator must verify the lockfile + migration set BEFORE Plan 10-03 begins to avoid the macOS-vs-Linux lockfile drift hitting a downstream wave:

    1. **Lockfile shape** — confirm linux/amd64 regen worked:
       ```bash
       grep -c '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json   # ≥ 1
       grep -c '"node_modules/@tailwindcss/oxide-linux-x64-gnu"' package-lock.json  # ≥ 1
       grep -c '"node_modules/@next/swc-linux-x64-gnu"' package-lock.json           # ≥ 1
       grep -c '"node_modules/@casl/ability"' package-lock.json                     # ≥ 1
       grep -c '"node_modules/@casl/react"' package-lock.json                       # ≥ 1
       ```
       All ≥ 1. If any returns 0, redo the Docker regen.

    2. **CI smoke** — push the branch with these commits and confirm GitHub Actions `npm ci` step passes. Per CLAUDE.md: if it fails with `Missing: @emnapi/...` or `Cannot find module '@*/binding-linux-x64-gnu'`, the regen was broken and must be redone inside the Docker container.

    3. **Migration sanity on a testcontainer DB** — run:
       ```bash
       npx vitest run --project integration tests/db/migration-0051-backfill.integration.test.ts
       ```
       Expected: GREEN. (Plan 10-01 RED scaffold becomes GREEN here.)

    4. **TypeScript clean:**
       ```bash
       npx tsc --noEmit -p tsconfig.json
       ```
       Expected: zero errors.

    5. **user.role text preservation check** — confirm the column is still in schema:
       ```bash
       grep -A1 'role: text("role"' src/db/schema.ts
       ```
       Expected: line still present. If absent, RESEARCH Q1 was misimplemented — STOP and reopen.
  </how-to-verify>
  <resume-signal>
    Type "approved" if all five verifications pass.
    Type "lockfile-broken" + the failing grep if step 1 fails.
    Type "ci-failed" + the GitHub Actions URL if step 2 fails.
    Type "migration-failed" + the test output if step 3 fails.
    Type "user-role-dropped" if step 5 fails — this is a CRITICAL bug requiring Plan 10-02 reopen.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Migration files → prod DB | Drizzle migrations apply via deploy pipeline. 0050/0051 auto-apply; 0052 operator-gated. |
| `scripts/seed-test-users.ts` → DATABASE_URL | Seed script must never touch prod DB. Two redundant gates on NODE_ENV + URL hint. |
| Better Auth admin plugin → `user.role` text | Plugin reads in 12 endpoints (per RESEARCH Q1 verification). Dropping the column is a Sev-1. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-02-01 | Tampering | scripts/seed-test-users.ts run against prod DATABASE_URL | mitigate | Two gates: NODE_ENV !== 'production' AND DATABASE_URL must not contain 'wkg-command-centre' or 'wkg-kiosk-tool'. Both must pass. Throws before any DB write. |
| T-10-02-02 | Elevation of Privilege | 0051 backfill grants admin role via user_roles to a non-admin user | mitigate | Backfill is keyed by existing `user.role` text — only users who were already 'admin' get the admin role row. ON CONFLICT DO NOTHING prevents accidental double-assignment. |
| T-10-02-03 | Denial of Service | 0052 SET NOT NULL applied before 0051 completes (Pitfall 6 — Phase 9.1 lesson) | mitigate | 0052 is operator-gated per CLAUDE.md style. Header documents the verification gate `SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL` MUST return 0. Idempotent guard means re-running is a no-op. |
| T-10-02-04 | Repudiation | Audit-log union widen invalidates existing audit_log rows | accept | Widen is TS-only. Existing rows have entityType / action values that ARE in the (still-valid) old union — they remain valid post-widen. No data migration needed. |
| T-10-02-05 | Information Disclosure | seed-test-users.ts password defaults committed to repo | accept | Defaults are obvious test placeholders (`OpsItTest!2026`); they only exist in test/preview DBs (gated above); operator overrides via env vars on real preview deploys per CLAUDE.md "Vercel preview env vars". |
| T-10-02-06 | Spoofing | Better Auth admin endpoints read stale `user.role` text after migration | mitigate | 0051 does NOT touch user.role text — pre-migration text values stay valid. Plan 10-03's refreshUserRoleMirror keeps text in sync at runtime on every assignRole/revokeRole. Plan 10-01's tests/db/better-auth-admin-plugin.integration.test.ts is the gate. |
</threat_model>

<verification>
- `npm ci --dry-run` exits 0 (lockfile matches package.json)
- `npx tsc --noEmit -p tsconfig.json` exits 0 (no schema or audit type errors)
- `npx vitest run --project integration tests/db/migration-0051-backfill.integration.test.ts` exits 0 (Plan 10-01 RED → GREEN)
- All three migration files have idempotent guards (`IF [NOT] EXISTS`, `ON CONFLICT DO NOTHING`, `is_nullable='YES'`)
- `grep -q 'role: text("role"' src/db/schema.ts` — user.role text PRESERVED
- 0052 header contains operator verification-gate SQL
- Lockfile contains @rolldown/@tailwindcss/@next swc Linux x64 entries (Linux Docker regen confirmed)
</verification>

<success_criteria>
- 3 migration files committed (0050/0051/0052) with house-style guards
- schema.ts has 3 new tables + userScopes.roleId nullable column; user.role text intact
- audit.ts unions widened (TS-only, no SQL)
- @casl/ability + @casl/react in package.json + lockfile (Linux Docker regen verified)
- scripts/seed-test-users.ts ships with two prod-refusal gates
- Wave-0 RED `tests/db/migration-0051-backfill.integration.test.ts` goes GREEN
- All other Wave-0 RED tests still RED (waiting on Plan 10-03 ability builder)
- CI `npm ci` step passes on the phase branch
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-02-SUMMARY.md` documenting:
- Migration trio shipped (0050 DDL, 0051 data, 0052 NOT-NULL flip operator-gated)
- Schema additions + audit.ts union widen
- CASL deps installed via Linux Docker regen (lockfile shape verification grep results)
- The CONTEXT-decision REVERSAL: user.role text PRESERVED (Q1) — link to 10-RESEARCH.md §Q1 and PATTERNS.md §Critical Reversals #1
- Test-user seed script for preview env
- Status of Plan 10-01's RED tests: migration-0051-backfill.integration.test.ts → GREEN; all others remain RED awaiting Plan 10-03
- Operator verification-gate SQL for 0052 (carried forward to 10-HUMAN-UAT.md)
</output>
