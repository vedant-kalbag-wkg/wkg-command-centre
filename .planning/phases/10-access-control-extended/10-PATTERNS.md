# Phase 10: Access Control Extended — Pattern Map

**Mapped:** 2026-05-10
**Files analyzed:** ~28 new + 4 modified-in-place + ~59 RBAC-call-site rewrites (planner aggregates)
**Analogs found:** 28 / 28 (every file has a strong in-tree analog; CASL-specific files lean on `getUserCtx` + `scoped-query` idioms)

---

## File Classification

> Order roughly matches CONTEXT.md / RESEARCH.md sequencing (DB → CASL core → shims → admin UI → tests).

### A — DB schema + migrations

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema.ts` (additions: `roles`, `rolePermissions`, `userRoles`; `userScopes` reshape; KEEP `user.role`) | DB schema | DDL | `src/db/schema.ts:306-322` (`auditLogs` jsonb pattern) + `src/db/schema.ts:517-542` (`userScopes` table + `unique` + `byUser` index) | exact |
| `migrations/0050_phase_10_roles_schema.sql` (DDL: 3 new tables + `user_scopes.role_id` nullable) | migration | DDL | `migrations/0045_phase_09_hotel_alerts.sql` (multi-delta hand-authored, idempotent guards) | exact |
| `migrations/0051_phase_10_seed_and_backfill.sql` (data: seed 3 roles + role_permissions + backfill `user_roles` + populate `user_scopes.role_id`) | migration | data | `migrations/0045_phase_09_hotel_alerts.sql` Delta 5 (data INSERT with `ON CONFLICT DO NOTHING`) + `migrations/0026_add_system_role_and_etl_promotion.sql` (role-text seeding) | role-match |
| `migrations/0052_phase_10_user_scopes_role_id_required.sql` (constraint flip — only if Q-OQ-2 chooses NOT NULL) | migration | DDL | `migrations/0048_phase_09_1_net_amount_gbp_not_null.sql` (operator-gated `SET NOT NULL` flip with `information_schema.columns` guard) | **exact** — house style explicitly cited by RESEARCH.md as the model |

### B — CASL integration core

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/casl/ability.ts` (`buildAbility(userId)` — `react.cache`-wrapped per-request) | lib helper / per-request builder | DB → in-memory ability | `src/lib/auth/get-user-ctx.ts:1-43` (`react.cache` + dynamic `@/db` imports + Better-Auth session source) | exact |
| `src/lib/casl/subjects.ts` (`SUBJECT_TABLES` registry — Subject literal → Drizzle table) | lib registry | static `Map`-shaped const | `src/lib/scoping/scoped-query.ts:35-50` (`VALID_DIMENSION_TYPES` + `assertValidDimensionType`) — pattern for hand-maintained literal-union → assertion | role-match |
| `src/lib/casl/fields.ts` (`fieldsOfSubject(s)` via `getTableColumns`) | lib helper | introspection | none in-tree (Drizzle's `getTableColumns` is currently un-exploited app-side; only used internally by drizzle-orm) | **NO ANALOG — see "No Analog Found"** |
| `src/lib/casl/external-invariant.ts` (`applyExternalUserInvariant(builder, userType)` — appends `cannot` rules when external) | lib helper | pure function | `src/lib/rbac.ts:37-68` (`canAccessSensitiveFields` + `redactSensitiveFields` — same hardcoded sensitive-key list to port over) | exact |
| `src/lib/casl/seed.ts` (default `Admin` / `Ops-IT` / `Read-only` rule sets used in migration 0051 + tier-rebuild) | lib helper | static config | `src/lib/scoping/dimension-options.ts` (`DIMENSION_OPTIONS` static config consumed by both server seed paths and admin-UI selects) | role-match |
| `src/lib/casl/role-mirror.ts` (`refreshUserRoleMirror(userId)` — primary-tier denormalisation into `user.role` text per Q1) | lib helper | DB read + DB write | `src/lib/audit.ts:1-62` (single-purpose writer with optional `db` injection for testcontainers) | role-match |
| `src/lib/casl/lockout-guard.ts` (or inline in `role-actions.ts`) — `assertAtLeastOneEffectiveAdmin(tx)` Path B SQL | lib helper / pre-write invariant | tx-scoped read | `src/app/(app)/locations/merge-action.ts:42-79` (server-action gated on `requireRole`, structured-error returns for invariant violations like `LOCATION_MERGE_LOCK_CONTENTION`) + `src/lib/location-merge.ts:355-357` (advisory-lock guard inside `db.transaction`) | exact |
| `src/lib/casl/types.ts` (`AppAbility`, `Action`, `Subject` literal unions) | types | static types | `src/lib/scoping/scoped-query.ts:35-65` (`DimensionType`, `Scope`, `UserCtx`, `Session` types) | exact |
| `src/lib/casl/ability-context.tsx` (`"use client"` `AbilityProvider` + `Can = createContextualCan(...)`) | client component / context provider | RSC props → client memo | `src/components/theme-provider.tsx:1-12` (only existing `"use client"` provider in the tree — minimal; the planner will need to introduce the `useMemo`-around-rules pattern from RESEARCH.md Pattern 3) | role-match |

### C — RBAC shim layer (signature-preserving cutover)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/auth/get-user-ctx.ts` (augment to attach `ability` to `UserCtx`) | lib helper | DB → cached ctx | itself (preserve `react.cache` idiom; dynamic `@/db` import shape) | **self** |
| `src/lib/rbac.ts` (rewrite internals: `requireRole`, `canAccessSensitiveFields`, `redactSensitiveFields` delegate to `getUserCtx().ability`; signatures preserved) | lib helper | shim | itself + `src/lib/scoping/scoped-query.ts:51-65` (`UserCtx` shape — same in both files; merge during cutover) | self |
| `src/lib/rbac.test.ts` (extend with deny-wins + external-invariant cases; KEEP existing redaction-parity assertions as the regression bar) | unit test | pure function tests | itself — preserve every existing assertion (RESEARCH "redaction-parity.test.ts" is essentially this file ported) | self |

### D — Admin UI: `/settings/roles` (new tree)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(app)/settings/roles/page.tsx` (RSC list view of all roles) | page (RSC) | DB → server-action → page | `src/app/(app)/settings/users/page.tsx:1-39` (RSC: read session, gate on `isAdmin`, fetch list via action, render PageHeader + client component) | exact |
| `src/app/(app)/settings/roles/actions.ts` (`"use server"` create/update/delete role; `replaceRolePermissions` with diff + impacted-users + audit) | server action | client → server-action → DB | `src/app/(app)/settings/business-events/actions.ts:1-355` (CRUD with `requireRole('admin')` gate + `writeAuditLog` per mutation + result-envelope pattern `{success: true} \| {error: string}`) | exact |
| `src/app/(app)/settings/roles/role-list-client.tsx` (client island with create-role + clone buttons) | client component | client state | `src/app/(app)/settings/users/users-page-client.tsx:1-97` (client island taking `initialUsers` + `isAdmin`, drives dialogs, calls back to server actions) | exact |
| `src/app/(app)/settings/roles/[id]/page.tsx` (RSC detail; loads role + rules) | page (RSC) | DB → server-action → page | `src/app/(app)/locations/[id]/page.tsx:1-52` (RSC: `await params`, fetch via action, `notFound()` on error, gate admin panel by role) | exact |
| `src/app/(app)/settings/roles/[id]/role-editor-client.tsx` (form-driven rule editor; subject multi-select → action chips → field picker → condition builder) | client component | RHF form | `src/app/(app)/settings/business-events/event-form.tsx:1-247` (Dialog-mounted `<form>` with controlled `useState` fields, `onSubmit` → server action → toast/error) — closest existing form-driven editor; **rule-row repeater is new pattern, no exact analog** | role-match |
| `src/app/(app)/settings/roles/[id]/editor-internal.ts` (extracted helpers — types, validation, diff computation; **no `"use server"` directive**) | lib helper | pure helpers | `src/app/(app)/settings/users/[id]/scopes-internal.ts:1-193` (canonical "non-server-action helpers" split — comment block at top is the load-bearing pattern: types + actor-bound `_*ForActor` helpers exported for direct test consumption) | exact |
| `src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx` (rule-set diff + impacted-user count + confirm) | client component | client modal | `src/components/table/merge-dialog.tsx:1-120` (Dialog with diff/conflict resolution, "consequences bullets", confirm button → server-action → result envelope handling for `error`/`status`) | role-match |
| `src/app/(app)/settings/roles/new/page.tsx` (create-role flow) | page (RSC) | RSC → action | `src/app/(app)/locations/new/page.tsx` (small RSC wrapper) — pattern only, file lookup deferred to planner if needed | partial |

### E — User-to-role assignment (`/settings/users/[id]/`)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(app)/settings/users/[id]/page.tsx` (**NEW** — currently absent) | page (RSC) | DB → page | `src/app/(app)/locations/[id]/page.tsx:1-52` + `src/app/(app)/settings/users/page.tsx` for the settings-tree shell | role-match (no exact peer — RESEARCH Q-OQ-1 flags this) |
| `src/app/(app)/settings/users/[id]/role-actions.ts` (or extend `scopes-actions.ts`) — `"use server"` `assignRole`, `revokeRole` | server action | client → action → DB tx | `src/app/(app)/settings/users/[id]/scopes-actions.ts:1-52` (thin "use server" wrapper → `requireRole('admin')` → delegate to `_*ForActor` in sibling internal file) | exact |
| `src/app/(app)/settings/users/[id]/role-internal.ts` | lib helper | pure helpers | `src/app/(app)/settings/users/[id]/scopes-internal.ts:1-193` — same split, same actor pattern | exact |
| `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` (multi-role + per-(user, role) scope picker) | client component | dialog | `src/components/admin/manage-scopes-dialog.tsx:1-266` (existing per-user scope dialog — listScopes/addScope/removeScope shape; planner extends to (role, scope[]) pair) | exact |

### F — Better-Auth `removeUser` wrapper (lock-out coverage gap from RESEARCH Q6)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/(app)/settings/users/actions.ts` — wrap `auth.api.removeUser` to run `assertAtLeastOneEffectiveAdmin` first | server action | gate + delegate | `src/app/(app)/settings/users/actions.ts:226-253` (`deleteUser` — current shape; planner adds the lock-out check into the same function inside the existing `try`) | self |

### G — Migrated client `<Can>` gates (3 sites per RESEARCH Q4 audit)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/components/layout/app-sidebar.tsx:165` (`{isAdmin && <NavGroup …>}` → `<Can I="manage" a="all">`) | client component | rules-from-RSC → client gate | itself — line 165 is the call site to swap | self |
| `src/components/layout/user-menu.tsx:127` (`{isAdmin && (<>…</>)}` → `<Can I="manage" a="all">`) | client component | same | itself — line 127 is the call site | self |
| `src/app/(app)/locations/[id]/products/location-products-client.tsx:474` (`session?.user?.role === "admin"` → `<Can I="manage" a="LocationProduct">`) | client component | same | itself — line 474 is the call site | self |
| `src/app/(app)/layout.tsx` (wrap children in `<AbilityProvider rules={ctx.ability.rules}>`) | layout (RSC) | RSC → client provider | itself, lines 1-28 (current shape: `auth.api.getSession` → `<AppShellV2>`) — planner adds `getUserCtx()` + provider wrap | self |

### H — Tests (Wave 0)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/casl/__tests__/ability.test.ts` (deny-wins, scope merge, external invariant, system short-circuit) | unit | pure | `src/lib/scoping/scoped-query.test.ts:1-103` (matrix of role × scope inputs → expected filter shape; impersonation flag tests) | exact |
| `src/lib/casl/__tests__/seed.test.ts` (Ops-IT / Read-only tier defaults match v1.0 redaction behaviour) | unit | parity | `src/lib/rbac.test.ts:1-164` (full sample-location matrix across role × userType combinations — every assertion ports 1:1 as a "do the seeded tier rules produce the same `permittedFieldsOf` output as the legacy `redactSensitiveFields`?" check) | **exact — this IS the regression bar** |
| `src/lib/casl/__tests__/permitted-fields.test.ts` | unit | pure | `src/lib/scoping/scoped-query.test.ts` shape | role-match |
| `src/lib/casl/__tests__/external-invariant.test.ts` | unit | pure | `src/lib/rbac.test.ts:103-141` (external-* cases) | exact |
| `src/lib/casl/__tests__/deny-wins.test.ts` | unit | pure | `src/lib/scoping/scoped-query.test.ts` matrix shape | role-match |
| `src/lib/casl/__tests__/subjects.test.ts` (registry exhaustiveness — every Subject has a SUBJECT_TABLES entry) | unit | pure | `src/lib/scoping/scoped-query.test.ts:97-101` (`rejects unknown dimensionType`) — same exhaustiveness shape | role-match |
| `tests/db/casl-ability.integration.test.ts` (per-(user, role) scope conditions; admin sees all, viewer scoped) | integration (testcontainers) | DB → ability → assertion | `tests/db/user-scopes-actions.integration.test.ts:1-100` (canonical `setupTestDb` + actor + seed pattern) | exact |
| `tests/db/custom-role.integration.test.ts` (full custom-role roundtrip) | integration | same | same | exact |
| `tests/db/lockout-guard.integration.test.ts` (Path B query in transaction) | integration | same | `tests/db/user-scopes-actions.integration.test.ts` + `src/app/(app)/locations/__tests__/` actions.test patterns | exact |
| `tests/db/better-auth-admin-plugin.integration.test.ts` (set-role / impersonate / ban work after migration) | integration | same | `tests/db/user-scopes-actions.integration.test.ts` shape | role-match |
| `tests/db/migration-0051-backfill.integration.test.ts` (verify `user_roles` populated from `user.role` text correctly) | integration | DB-state assertion | `tests/db/locations-same-name.integration.test.ts:1-80` (raw `ctx.pool.query` against migrated schema; assert SQLSTATE / row counts) | exact |
| `tests/access-control/edit-tier.spec.ts` (Playwright: admin edits Ops-IT tier, change applies on next request) | e2e | full stack | `tests/settings/business-events.spec.ts:1-18` (signInAsAdmin → goto `/settings/X` → assert PageHeader → assert no `pageerror`) + `tests/settings/users.spec.ts:1-23` for action button assertions | exact |
| `tests/access-control/can-component.spec.ts` (Playwright: `<Can>` hides Merge button for viewer) | e2e | full stack | same | exact |
| `tests/access-control/role-editor.spec.ts` | e2e | same | same | exact |
| `tests/access-control/user-role-assignment.spec.ts` | e2e | same | same | exact |

---

## Pattern Assignments

> Concrete excerpts with file paths + line ranges. Planner copies these directly into plan-action bodies.

### A1 — `src/db/schema.ts` additions

**Analog: `src/db/schema.ts:517-542` (`userScopes`) + `:306-322` (`auditLogs` jsonb)**

**Imports already present at top of schema.ts** (planner confirms `unique`, `index`, `jsonb`, `boolean`, `uuid`, `text`, `timestamp` are all imported — no new imports needed):

```ts
// src/db/schema.ts:1-19  ── existing
import {
  pgTable, text, timestamp, boolean, doublePrecision, uuid, integer,
  jsonb, numeric, primaryKey, uniqueIndex, unique, index, date, time,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
```

**JSONB-with-`$type` pattern** (analog: `auditLogs.metadata`, `userViews.config`):

```ts
// src/db/schema.ts:306-322 ── auditLogs
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ...
  metadata: jsonb("metadata"),                                 // ← untyped, free-form
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// src/db/schema.ts:351-358 ── userViews (typed jsonb)
config: jsonb("config")
  .$type<{
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    groupBy?: string;
    columns?: string[];
  }>()
  .notNull(),
```

**Composite-unique + by-user-index pattern** (analog: `userScopes`):

```ts
// src/db/schema.ts:517-542 ── userScopes
export const userScopes = pgTable(
  "user_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dimensionType: text("dimension_type", {
      enum: ["hotel_group", "location", "region", "product", "provider", "location_group"],
    }).notNull(),
    dimensionId: text("dimension_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    uniq: unique().on(t.userId, t.dimensionType, t.dimensionId),
    byUser: index("user_scopes_user_idx").on(t.userId),
  })
);
```

**Things to copy:**
- Cascade-delete from `user.id` for `user_roles.userId`, `userScopes.userId`.
- `text("kind", { enum: [...] }).notNull()` for `roles.kind` (matches `dimension_type` shape).
- `unique().on(...)` for `user_roles (user_id, role_id)`, `userScopes (user_id, role_id, dimension_type, dimension_id)`.
- `index("..._idx").on(...)` for per-request lookups (`role_permissions_role_idx`, `user_roles_user_idx`).
- `jsonb("...")` with `.$type<...>` for `role_permissions.fields` (`string[] | null`) and `.conditions` (`Record<string, unknown> | null`).

**Things to NOT copy:**
- DO NOT drop `user.role` text column (RESEARCH Q1 reverses CONTEXT — see "Critical reversals" below).
- DO NOT add a CHECK / FK on `(user_id, role_id)` composite from `user_scopes` to `user_roles` — RESEARCH §"Migration ordering" calls this out as awkward; rely on app-level invariant.

---

### A2 — `migrations/0050_phase_10_roles_schema.sql` (DDL)

**Analog: `migrations/0045_phase_09_hotel_alerts.sql` (multi-delta, idempotent guards)**

```sql
-- migrations/0045_phase_09_hotel_alerts.sql:1-25 ── header + delta numbering convention
-- Phase 9 — shift POC underperformance alerts from kiosk-level to hotel-level.
-- ...
-- Deltas:
--   1.   location_performance_alert_state table — replaces kiosk_performance_alert_state
--   1.1  CHECK constraint on tier
--   1.2  tier index for per-run bottom-tier query
--   2.   locations.alert_silenced_at + alert_silenced_reason columns
-- ...
-- IF NOT EXISTS / IF EXISTS guards make this safe to re-run on UAT / preview.

-- ── Delta 1 — location_performance_alert_state table ─────────────────────────
CREATE TABLE IF NOT EXISTS "location_performance_alert_state" (
  "location_id" uuid PRIMARY KEY NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  ...
);
--> statement-breakpoint
```

**Idempotent CHECK guard pattern** (analog: `0045:38-49`):

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'location_performance_alert_state_tier_check'
  ) THEN
    ALTER TABLE "location_performance_alert_state"
      ADD CONSTRAINT "location_performance_alert_state_tier_check"
      CHECK (tier IN ('Premium', 'Standard', 'Developing', 'Emerging'));
  END IF;
END $$;
--> statement-breakpoint
```

**Things to copy:**
- Full Deltas-block header comment naming each numbered delta (1, 1.1, 1.2, 2, …).
- `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` everywhere.
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `user_scopes.role_id`.
- `--> statement-breakpoint` comment between every statement (drizzle-kit reads these).
- `DO $$ ... END $$` guard around CHECK / unique-index additions (idempotency).

**Things to NOT copy:**
- The data INSERT in `0045` Delta 5 — that pattern moves to `0051` (data-only file).

---

### A3 — `migrations/0051_phase_10_seed_and_backfill.sql` (data-only)

**Analog: `migrations/0045:75-86` Delta 5 (`INSERT INTO ... ON CONFLICT DO NOTHING`)**

```sql
-- migrations/0045_phase_09_hotel_alerts.sql:75-86 ── data INSERT pattern
-- ── Delta 5 — record the composite-score weights snapshot ────────────────────
-- Documentation row only. ...
INSERT INTO "app_settings" ("key", "value")
  VALUES (
    'composite_score_alert_weights_snapshot',
    '{"revenue":0.30,"transactions":0.20,"revenuePerRoom":0.25,"txnPerKiosk":0.15,"basketValue":0.10,"recordedAt":"2026-05-09"}'
  )
  ON CONFLICT ("key") DO NOTHING;
```

**Things to copy:**
- `INSERT ... ON CONFLICT DO NOTHING` for the Admin/Ops-IT/Read-only seed rows (idempotent re-run).
- Backfill-from-text-column pattern: `INSERT INTO user_roles (user_id, role_id) SELECT id, (SELECT id FROM roles WHERE name='admin') FROM "user" WHERE role='admin' ON CONFLICT DO NOTHING;` (and 'member' → ops-it, 'viewer' → read-only).
- `UPDATE user_scopes SET role_id = (SELECT role_id FROM user_roles WHERE user_roles.user_id = user_scopes.user_id LIMIT 1) WHERE role_id IS NULL;` — backfill `userScopes.role_id` to the user's primary role.

**Things to NOT copy:**
- DO NOT touch `user.role` text values during this migration (Q1: stays as denormalised mirror).

---

### A4 — `migrations/0052_phase_10_user_scopes_role_id_required.sql` (NOT NULL flip)

**Analog: `migrations/0048_phase_09_1_net_amount_gbp_not_null.sql` — RESEARCH explicitly cites this as the model.**

```sql
-- migrations/0048_phase_09_1_net_amount_gbp_not_null.sql:1-33 ── ENTIRE FILE
-- Phase 9.1 Plan 09.1-05 — Multi-currency forex normalisation: net_amount_gbp NOT NULL flip (FX-02).
--
-- MUST NOT be applied until scripts/backfill-net-amount-gbp.ts has reported
-- zero NULL rows (CONTEXT.md / RESEARCH.md Pitfall 7 — applying this before
-- backfill completes locks the table and stalls the deploy).
--
-- Verification gate (operator runs before applying):
--   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM sales_records WHERE net_amount_gbp IS NULL;"
--   Expected: 0
--
-- ...
-- Idempotent: only flips when the column is currently NULLABLE — re-running
-- on an already-NOT-NULL column is a no-op (project house style, see 0044's
-- guard pattern around constraint flips).
--
-- Deltas:
--   1. ALTER COLUMN net_amount_gbp SET NOT NULL

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_records'
      AND column_name = 'net_amount_gbp'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "sales_records" ALTER COLUMN "net_amount_gbp" SET NOT NULL;
  END IF;
END $body$;
--> statement-breakpoint
```

**Things to copy verbatim** (with table/column substitution):
- The exact `DO $body$ ... information_schema.columns ... is_nullable = 'YES' ... END $body$` guard.
- The header comment with operator-runs verification gate (`SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL;` → expected 0).
- The reference to `CONTEXT.md / RESEARCH.md Pitfall 7` analog (Phase 10 RESEARCH Pitfall 6 is the equivalent).

**Conditional:** RESEARCH "Open Questions OQ-2" suggests `userScopes.role_id` may stay nullable forever (admins have no scope rows). Planner decides — if it stays nullable, **0052 does not exist**.

---

### B1 — `src/lib/casl/ability.ts` (`buildAbility`)

**Analog: `src/lib/auth/get-user-ctx.ts:1-43` (`react.cache` + dynamic `@/db` imports + Better-Auth session source)**

**Imports + cache wrapping** (lines 1-8):

```ts
// src/lib/auth/get-user-ctx.ts:1-9 ── existing
import { cache } from "react";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import type { UserCtx } from "@/lib/scoping/scoped-query";

// React.cache dedupes across an RSC render pass — multiple islands call
// this once per request instead of hitting the auth DB per caller.
export const getUserCtx = cache(async (): Promise<UserCtx> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");
  // ...
});
```

**Dynamic `@/db` import inside the cached fn** (lines 16-24 — used to keep cold-path RSC trees from pulling the whole `pg` driver):

```ts
// src/lib/auth/get-user-ctx.ts:16-24 ── existing
const { db } = await import("@/db");
const { user } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const [target] = await db
  .select({ id: user.id, userType: user.userType, role: user.role })
  .from(user)
  .where(eq(user.id, impersonatingId))
  .limit(1);
```

**Things to copy:**
- `cache(async (...) => {...})` wrapper — same `react.cache` idiom.
- Dynamic `await import("@/db")` / `await import("@/db/schema")` to keep RSC tree-shake intact.
- Throw-on-not-authenticated shape (`throw new Error("Not authenticated")`) for downstream `try/catch` in actions to map to result envelopes.
- The impersonation branch shape lives here — RESEARCH says ability is built off the impersonated identity, so the existing `impersonating_user_id` cookie read at line 13-33 stays.

**Things to NOT copy:**
- The hardcoded role-text union `"admin" | "system" | "member" | "viewer"` at line 30,40 — the new `UserCtx` has both `role` (denormalised mirror text, kept for Better Auth) and `ability` (authoritative).

**Composition target for the new file** — RESEARCH §Pattern 1 lines 194-273 of `10-RESEARCH.md` is the verbatim shape; copy it.

---

### B2 — `src/lib/casl/external-invariant.ts`

**Analog: `src/lib/rbac.ts:37-68` (current sensitive-key list — port verbatim)**

```ts
// src/lib/rbac.ts:37-68 ── existing
export function canAccessSensitiveFields(user: UserCtx): boolean {
  if (user.userType === "external") return false;
  return user.role === "admin" || user.role === "member";
}

export function redactSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  user: UserCtx
): T {
  if (canAccessSensitiveFields(user)) return data;
  const redacted: Record<string, unknown> = { ...data };
  const sensitiveKeys: string[] = [
    "bankingDetails", "contractValue", "contractTerms", "contractDocuments",
  ];
  if (user.userType === "external") {
    sensitiveKeys.push(
      "keyContactName", "keyContactEmail", "financeContact", "maintenanceFee"
    );
  }
  for (const k of sensitiveKeys) {
    if (k in redacted) redacted[k] = null;
  }
  return redacted as T;
}
```

**Things to copy:**
- The exact two-tier sensitive-key lists (always-sensitive vs external-additional). These are the v1.0 contract — re-encoded as `cannot('read', 'Location', [...])` rules appended LAST in the AbilityBuilder when `userType === 'external'` (RESEARCH Pitfall 5).

**Things to NOT copy:**
- Don't keep this as a data-shape mutator — the new shape is `applyExternalUserInvariant(builder, userType): void` that calls `builder.cannot('read', 'Location', [SENSITIVE_KEYS])`.

---

### B3 — `src/lib/casl/role-mirror.ts` (`refreshUserRoleMirror`)

**Analog: `src/lib/audit.ts:1-62` (single-purpose writer with optional `db` injection)**

```ts
// src/lib/audit.ts:1-9 ── existing
import { db as defaultDb } from "@/db";
import { auditLogs } from "@/db/schema";

// Drizzle DB shape — kept loose so callers can inject a test-container
// `node-postgres`-backed instance OR rely on the prod `postgres-js` default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { insert: (...args: any[]) => any };

export async function writeAuditLog(
  entry: { ... },
  db: AnyDb = defaultDb,
) {
  await db.insert(auditLogs).values({ ... });
}
```

**Things to copy:**
- `db: AnyDb = defaultDb` second-arg pattern — testcontainers pass their own pg-pool; prod uses the singleton.
- Verbatim `AnyDb = any` ESLint disable comment + reasoning (testcontainers/postgres-js coexistence).

**Concrete shape from RESEARCH Q1 (lines 634-673 of 10-RESEARCH.md)** — copy directly.

---

### B4 — `src/lib/casl/lockout-guard.ts` (Path B SQL inside transaction)

**Analog 1: `src/app/(app)/locations/merge-action.ts:42-79` (server-action gated, structured-error returns)**

```ts
// src/app/(app)/locations/merge-action.ts:37-79 ── existing
export type MergeLocationsResult =
  | { success: true; merged: number }
  | { error: string }
  | { status: "lock_contention" };

export async function mergeLocationsAction(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown> = {},
): Promise<MergeLocationsResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Forbidden" };
  }
  try {
    const actor = { id: session.user.id, name: session.user.name ?? session.user.email };
    const _result = await applyLocationMerge(targetId, sourceIds, actor, db, fieldResolutions);
    revalidateTag("locations", "max");
    return { success: true, merged: sourceIds.length };
  } catch (err) {
    if (err instanceof Error && err.message === LOCATION_MERGE_LOCK_CONTENTION) {
      return { status: "lock_contention" };
    }
    return { error: err instanceof Error ? err.message : "Failed to merge locations" };
  }
}
```

**Analog 2: `src/lib/location-merge.ts:355-357` (advisory-lock guard inside `db.transaction`):**

```ts
// src/lib/location-merge.ts:355-357 ── existing
if (lockRows[0]?.lock !== true) {
  throw new Error(LOCATION_MERGE_LOCK_CONTENTION);
}
```

**Things to copy:**
- `Result =  {success: true} | {error: string} | {status: "<sentinel>"}` envelope.
- Throw-a-sentinel-string-from-tx-fn-then-catch-in-action pattern. The new sentinel is `LOCKOUT_PREVENTION` (or a typed exported const matching `LOCATION_MERGE_LOCK_CONTENTION`'s shape).
- Path B SQL (RESEARCH lines 936-958) wrapped in `tx.execute(sql\`...\`)`.

---

### B5 — `src/lib/casl/subjects.ts` (`SUBJECT_TABLES` registry)

**Analog: `src/lib/scoping/scoped-query.ts:35-50` (literal-union + assertion pattern)**

```ts
// src/lib/scoping/scoped-query.ts:35-50 ── existing
const VALID_DIMENSION_TYPES = [
  'hotel_group', 'location', 'region', 'product', 'provider', 'location_group',
] as const;

export type DimensionType = (typeof VALID_DIMENSION_TYPES)[number];

// (in scopes-internal.ts:55-63)
export function assertValidDimensionType(
  value: string,
): asserts value is DimensionType {
  if (!(VALID_DIMENSION_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Invalid dimensionType: ${value}. Must be one of: ${VALID_DIMENSION_TYPES.join(", ")}`);
  }
}
```

**Things to copy:**
- `as const` array → `(typeof X)[number]` literal union — same shape for `Subject` / `Action`.
- `asserts value is X` runtime guard for action / subject strings coming in via server-action input.

---

### B6 — `src/lib/casl/ability-context.tsx` (`"use client"` provider)

**Analog: `src/components/theme-provider.tsx:1-12` (only existing `"use client"` provider)**

```tsx
// src/components/theme-provider.tsx:1-12 ── ENTIRE FILE
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

**Things to copy:**
- File header `"use client";` directive; pure passthrough provider shape.
- Then graft RESEARCH §Pattern 3 (lines 320-352 of 10-RESEARCH.md) verbatim — `createContext`, `useMemo` over `createMongoAbility(rules)`, `Can = createContextualCan(AbilityContext.Consumer)` export.

**Things to NOT copy:**
- The minimal pass-through of theme-provider — Ability needs a `useMemo` so client doesn't rebuild on every render.

---

### C1 — `src/lib/auth/get-user-ctx.ts` augmentation

**Analog: itself — preserve every existing line.**

**The augmentation diff:**
- After `session = await auth.api.getSession(...)`, call `const ability = await buildAbility(session.user.id);` (which is `cache`-wrapped — second call within the request hits memo).
- Add `ability: AppAbility` to `UserCtx` shape (matching the `UserCtx` in `src/lib/scoping/scoped-query.ts:51-55` — extend that interface).
- Same impersonation branch — but the `buildAbility(targetId)` call uses the impersonated user ID.

---

### C2 — `src/lib/rbac.ts` shim rewrite

**Analog: itself, lines 25-68.**

**Existing shape (preserve signatures):**

```ts
// src/lib/rbac.ts:25-31 ── existing
export async function requireRole(...roles: Role[]) {
  const session = await getSessionOrThrow();
  if (!roles.includes(session.user.role as Role)) {
    throw new Error("Forbidden");
  }
  return session;
}
```

**New body (delegates to ability while preserving signature):**

```ts
// pseudo-code for the shim — actual planner work
export async function requireRole(...roles: Role[]) {
  const session = await getSessionOrThrow();
  // Translate text-role gates to ability checks while signature stays compatible:
  //   admin           → ability.can('manage', 'all')
  //   member, admin   → ability.can('update', subject)  (caller knows the subject)
  //   any text role   → user.role text check (mirror) is OK as a backstop
  const ctx = await getUserCtx();
  if (roles.includes('admin' as Role) && ctx.ability.can('manage', 'all')) return session;
  if (!roles.includes(session.user.role as Role)) throw new Error("Forbidden");
  return session;
}
```

**Things to copy:**
- The `throw new Error("Forbidden")` (matched by all 59 call sites' `try/catch` envelope).
- `getSessionOrThrow` cache-wrap idiom — keep returning the Better-Auth session for callers that consume `session.user.id`/`name`.

**Things to NOT copy:**
- The hardcoded role union body — that gets replaced by ability delegation.

---

### D1 — `src/app/(app)/settings/roles/page.tsx` (RSC list view)

**Analog: `src/app/(app)/settings/users/page.tsx:1-39` (ENTIRE FILE)**

```tsx
// src/app/(app)/settings/users/page.tsx:1-39 ── ENTIRE FILE
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isAdmin } from "@/lib/rbac";
import { listUsers } from "@/app/(app)/settings/users/actions";
import { PageHeader } from "@/components/layout/page-header";
import { UsersPageClient } from "@/app/(app)/settings/users/users-page-client";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

export default async function UsersPage() {
  let userRole = "member";
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    userRole = (session?.user?.role as string) || "member";
  } catch {
    // Session already validated by layout — fallback to non-admin view
  }
  const admin = isAdmin(userRole);

  let initialUsers: UserListItem[] = [];
  if (admin) {
    const result = await listUsers();
    if ("users" in result) {
      initialUsers = result.users;
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Users"
        description="Manage team members, roles, and access to the kiosk tool."
        count={initialUsers.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <UsersPageClient initialUsers={initialUsers} isAdmin={admin} />
      </div>
    </div>
  );
}
```

**Things to copy:**
- The `try { session = ...; userRole = ... } catch { /* layout already validated */ }` pattern — defensive against the layout-already-checked-but-might-blow-up edge.
- `if (admin) { const result = await listX(); if ("users" in result) ... }` envelope unpacking.
- `<PageHeader title="..." description="..." count={N} />` shell.
- `<div className="flex flex-col min-h-0 flex-1"> ... <div className="flex-1 overflow-auto p-4 md:p-6"> <ClientIsland /> </div></div>` layout chrome.

**Things to swap:**
- `userRole === "admin"` → `ctx.ability.can('manage', 'RolePermission')` (or a new `Subject = 'Role'`).
- `isAdmin(userRole)` → planner replaces with the ability check (RESEARCH Q4 audit confirms this stays server-only — no `<Can>` needed in RSC).

---

### D2 — `src/app/(app)/settings/roles/actions.ts`

**Analog: `src/app/(app)/settings/business-events/actions.ts:1-355` (CRUD + audit + result-envelope pattern)**

**Imports** (lines 1-7):

```ts
// src/app/(app)/settings/business-events/actions.ts:1-7 ── existing
"use server";

import { db } from "@/db";
import { businessEvents, eventCategories, user } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";
```

**Result-envelope shape** (lines 41-66 — `listCategories`):

```ts
export async function listCategories(): Promise<
  { categories: CategoryRow[] } | { error: string }
> {
  try {
    await requireRole("admin");
    const rows = await db.select().from(eventCategories).orderBy(eventCategories.name);
    const categories: CategoryRow[] = rows.map((r) => ({ ... }));
    return { categories };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list categories";
    return { error: message };
  }
}
```

**Audit-log on mutation pattern** (lines 73-94 — `createCategory`):

```ts
export async function createCategory(data: { name: string; color: string; isCore?: boolean })
  : Promise<{ success: true; id: string } | { error: string }> {
  try {
    const session = await requireRole("admin");
    const [row] = await db.insert(eventCategories).values({...}).returning({ id: eventCategories.id });
    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "event_category",     // ← new: "role"
      entityId: row.id,
      entityName: data.name,
      action: "create",
    });
    return { success: true, id: row.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create category";
    return { error: message };
  }
}
```

**Things to copy:**
- File-top `"use server";` directive.
- `requireRole("admin")` (will become `requireAbility('manage', 'Role')` after the shim cutover, but signature keeps working through Wave 3).
- Result-envelope discriminated union: `{success: true, ...} | {error: string}` — the planner adds `{success: true, impactedUserCount: number}` for `replaceRolePermissions`.
- `try { ... } catch (error) { return { error: error instanceof Error ? error.message : "..." } }` shape.
- `await writeAuditLog({...})` pattern — see "Shared Pattern: Audit logging".

**Things to NOT copy:**
- The simple single-action pattern won't fit `replaceRolePermissions` — that's a transactional DELETE+INSERT. Use `db.transaction(async (tx) => { ... })` per RESEARCH Q5/Q6 + `src/lib/location-merge.ts:355` advisory-lock pattern.

---

### D3 — `src/app/(app)/settings/roles/[id]/role-editor-client.tsx`

**Analog: `src/app/(app)/settings/business-events/event-form.tsx:1-247` (form-driven editor in Dialog)**

**Form-state pattern** (lines 49-58):

```tsx
const [title, setTitle] = React.useState("");
const [description, setDescription] = React.useState("");
const [categoryId, setCategoryId] = React.useState("");
// ... (one useState per controlled field)
const [saving, setSaving] = React.useState(false);
const [error, setError] = React.useState<string | null>(null);
```

**Submit pattern** (lines 85-118):

```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!title.trim()) { setError("Title is required"); return; }
  // ... validation ...
  setSaving(true);
  setError(null);
  try {
    await onSubmit({ title: title.trim(), description: description.trim() || undefined, ... });
    onOpenChange(false);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to save");
  } finally {
    setSaving(false);
  }
};
```

**Things to copy:**
- Controlled-form `useState` per field; `setError` for inline error rendering.
- `try/catch/finally` around the server-action call with `saving` flag.
- `onSubmit` prop pattern — parent owns the action, child is presentational.

**Things to NOT copy:**
- The flat field list — rule editor is a *repeater* of rows (`useFieldArray` from `react-hook-form` per RESEARCH §Standard Stack: `react-hook-form ^7.71.2` already installed). RESEARCH recommends RHF for the rule rows; `event-form.tsx` doesn't use it (single-shape form). Planner introduces RHF here.

---

### D4 — `src/app/(app)/settings/roles/[id]/editor-internal.ts`

**Analog: `src/app/(app)/settings/users/[id]/scopes-internal.ts:1-193` (canonical "non-server-action helpers" split — ENTIRE FILE)**

**Comment block at the top is the load-bearing pattern (lines 1-19)** — copy verbatim, swap "userScopes" for "rolePermissions":

```ts
// src/app/(app)/settings/users/[id]/scopes-internal.ts:1-19 ── existing
/**
 * Internal helpers + types for userScopes CRUD.
 *
 * This file deliberately does NOT carry the "use server" directive — splitting
 * it from `scopes-actions.ts` is mandatory:
 *
 *   1. A file with "use server" can only export async functions. Type-only
 *      re-exports (DimensionType, Actor, UserScopeRow) confuse the Turbopack
 *      server-action bundler; the emitted module references the type at
 *      runtime and crashes with `ReferenceError: DimensionType is not defined`
 *      on the first POST.
 *
 *   2. Exporting the `_*ForActor` helpers from a "use server" file would
 *      register them as network-callable server-action RPC endpoints —
 *      bypassing the `requireRole('admin')` gate that the public wrappers
 *      enforce. Keeping them here ensures only the public wrappers in
 *      `scopes-actions.ts` are reachable from the network.
 */
```

**Actor pattern + AnyDb** (lines 27-44):

```ts
export type Actor = {
  id: string;
  name: string;
  role: "admin" | "member" | "viewer" | string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = any;
```

**`_*ForActor` helper shape** (lines 65-127):

```ts
export async function _addScopeForActor(
  db: AnyDb,
  actor: Actor,
  userId: string,
  dimensionType: DimensionType,
  dimensionId: string,
): Promise<void> {
  if (actor.role !== "admin") throw new Error("Forbidden");
  assertValidDimensionType(dimensionType);

  await db.insert(userScopes).values({...}).onConflictDoNothing({...});

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "user",
      entityId: userId,
      entityName: "",
      action: "assign",
      field: "userScopes",
      newValue: `${dimensionType}:${dimensionId}`,
    },
    db,
  );
}
```

**Things to copy:**
- The dual-file split (`role-actions.ts` for `"use server"` wrappers ↔ `editor-internal.ts` / `role-internal.ts` for testable helpers). **MANDATORY** per the comment block reasoning.
- `_listFooForActor`, `_addFooForActor`, `_removeFooForActor` naming — leading underscore signals "test-only / internal-only".
- `AnyDb = any` + ESLint disable so testcontainers `node-postgres` and prod `postgres-js` both pass.
- `actor.role !== "admin"` early-throw guard — even though caller already gated, defense-in-depth.
- `await writeAuditLog({...}, db)` — pass the testcontainers `db` through.

---

### D5 — `src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx`

**Analog: `src/components/table/merge-dialog.tsx:1-120` (Dialog with diff/conflict resolution + confirm)**

**Imports** (lines 1-15):

```tsx
"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
```

**Confirm-with-result-envelope pattern** (lines 105-125):

```tsx
async function handleConfirm() {
  if (!targetId || sourceIds.length === 0) return;
  setIsSubmitting(true);
  try {
    const result = await onMerge(targetId, sourceIds, resolutions);
    if ("status" in result && result.status === "lock_contention") {
      toast.error("Another merge is in progress. Wait a moment and try again.");
      return;
    }
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    // success
    onSuccess();
    onOpenChange(false);
  } finally {
    setIsSubmitting(false);
  }
}
```

**Things to copy:**
- Dialog skeleton (Header → Description → diff body → Footer with Cancel + Confirm).
- Discriminated-union result handling — match every shape (`success` / `error` / `status: "lockout_prevention"` for the new sentinel).
- `toast.error(...)` for action failures; success path closes dialog and invokes `onSuccess()` callback.

**Things to NOT copy:**
- The conflict-detection logic (lines 82-101) — different domain. Replace with rule-set-diff (added rules, removed rules, changed rules) display.

---

### E1 — `src/app/(app)/settings/users/[id]/role-actions.ts` + `role-internal.ts`

**Analog: `src/app/(app)/settings/users/[id]/scopes-actions.ts:1-52` + `scopes-internal.ts:65-127`**

**Public wrapper** (`scopes-actions.ts:25-46`):

```ts
async function getActorFromSession(): Promise<Actor> {
  const session = await requireRole("admin");
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    role: (session.user.role as Actor["role"]) ?? "member",
  };
}

export async function listScopes(userId: string): Promise<UserScopeRow[]> {
  const actor = await getActorFromSession();
  return _listScopesForActor(prodDb, actor, userId);
}

export async function addScope(userId: string, dimensionType: DimensionType, dimensionId: string): Promise<void> {
  const actor = await getActorFromSession();
  await _addScopeForActor(prodDb, actor, userId, dimensionType, dimensionId);
}
```

**Things to copy:**
- The exact `getActorFromSession()` helper — re-use idea, define once per actions file.
- `prodDb` (i.e. `db`) injected as first arg of internal helper.
- Wrapper is one-line: `requireRole` → delegate.

---

### E2 — `src/app/(app)/settings/users/[id]/role-assignment-client.tsx`

**Analog: `src/components/admin/manage-scopes-dialog.tsx:1-266`**

**Refresh-on-open pattern** (lines 78-96):

```tsx
const refresh = useCallback(async () => {
  setIsLoading(true);
  try {
    const rows = await listScopes(user.id);
    setScopes(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load scopes";
    toast.error(message);
  } finally {
    setIsLoading(false);
  }
}, [user.id]);

useEffect(() => {
  if (open) {
    void refresh();
  }
}, [open, refresh]);
```

**Add/remove with toast + refetch** (lines 98-132):

```tsx
async function handleAdd() {
  // ... validation ...
  setIsAdding(true);
  try {
    await addScope(user.id, newDimensionType, trimmed);
    toast.success("Scope added");
    setNewDimensionId("");
    await refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add scope";
    toast.error(message);
  } finally {
    setIsAdding(false);
  }
}
```

**Things to copy:**
- `useCallback` `refresh()` + `useEffect(() => { if (open) void refresh(); }, [open, refresh])`.
- `try/catch/finally` with `toast.success` / `toast.error` per mutation; `await refresh()` after mutation.
- Per-row removing-state (`removingId` instead of just a boolean — supports concurrent action attempts).

**Things to NOT copy:**
- The shape stays (role + scope[] vs single scope), but a new role-assignment row needs both a role-picker AND zero-or-more scope-pickers — UI shape extends beyond the current dialog. Planner designs the per-(user, role) row composition; the data flow + idioms are the analog.

---

### F1 — Better-Auth `removeUser` wrapper

**Analog: itself — `src/app/(app)/settings/users/actions.ts:226-253` (current `deleteUser`)**

```ts
// src/app/(app)/settings/users/actions.ts:226-253 ── existing
export async function deleteUser(userId: string) {
  try {
    await requireRole("admin");
    // Clean up non-critical references before deletion
    const { db } = await import("@/db");
    const { session, account, userViews } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(account).where(eq(account.userId, userId));
    await db.delete(userViews).where(eq(userViews.userId, userId));

    await auth.api.removeUser({ body: { userId }, headers: await headers() });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("foreign key") || ...) { return { error: "..." }; }
    return { error: "Failed to delete user" };
  }
}
```

**The diff:**
- Insert `await assertAtLeastOneEffectiveAdmin(db, { excludingUserId: userId });` BEFORE the `auth.api.removeUser` call (so refusing happens before any cascade).
- Catch sentinel error → return `{ error: "Refusing to delete: would leave the system with no effective admin." }`.

---

### G — Client `<Can>` migrations (3 sites)

**Analog: itself in each case.**

**Sidebar (`src/components/layout/app-sidebar.tsx:165`):**

```tsx
// existing
{isAdmin && <NavGroup label="Configure" items={configure} pathname={pathname} />}
// new
<Can I="manage" a="all">
  <NavGroup label="Configure" items={configure} pathname={pathname} />
</Can>
```

**User-menu (`src/components/layout/user-menu.tsx:127`):**

```tsx
// existing
{isAdmin && (
  <>
    <M3DropdownMenuSeparator />
    <M3DropdownMenuLabel>Admin</M3DropdownMenuLabel>
    {systemAdminItems.map(...)}
  </>
)}
// new
<Can I="manage" a="all">
  <M3DropdownMenuSeparator />
  <M3DropdownMenuLabel>Admin</M3DropdownMenuLabel>
  {systemAdminItems.map(...)}
</Can>
```

**Location products (`src/app/(app)/locations/[id]/products/location-products-client.tsx:474`):** same shape, `<Can I="manage" a="LocationProduct">`.

**`<Can>` is imported from** `@/lib/casl/ability-context` (the new file from B6). **Drop** the `useSession` hook reads — `<Can>` reads from `AbilityContext`.

---

### H — Test pattern excerpts

**H1 — Unit test matrix** (analog: `src/lib/scoping/scoped-query.test.ts:1-103`):

```ts
import { describe, it, expect } from 'vitest';
import { buildScopeFilter } from './scoped-query';

const admin = { id: 'a1', userType: 'internal' as const, role: 'admin' as const };
// ... fixtures per role × userType

describe('buildScopeFilter', () => {
  it('returns null (unrestricted) for internal admin with no scopes', () => {
    expect(buildScopeFilter(admin, [])).toBeNull();
  });
  // ...
});
```

**H2 — Integration test setup** (analog: `tests/db/user-scopes-actions.integration.test.ts:1-100`):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import { user, userScopes, auditLogs, hotelGroups, providers as providersTable } from '@/db/schema';
import { _listScopesForActor, _addScopeForActor, type Actor } from '@/app/(app)/settings/users/[id]/scopes-internal';

describe('userScopes CRUD actions (integration)', () => {
  let ctx: TestDbContext;
  const adminActor: Actor = { id: randomUUID(), name: 'Admin User', role: 'admin' };
  // ...

  beforeAll(async () => {
    ctx = await setupTestDb();
    await ctx.db.insert(user).values([...]);
  }, 120_000);

  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  // Tests call _addScopeForActor(ctx.db, adminActor, ...) directly — no mocking next/headers.
});
```

**H3 — Migration / DDL test** (analog: `tests/db/locations-same-name.integration.test.ts:1-80`):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

describe("user_roles backfill (Plan 10-X migration 0051)", () => {
  let ctx: TestDbContext;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it("seeds the three system/tier roles", async () => {
    const rows = await ctx.pool.query(`SELECT name, kind FROM roles ORDER BY name`);
    expect(rows.rows.map(r => r.name).sort()).toEqual(['admin', 'ops-it', 'read-only']);
  });

  // ... assert backfilled user_roles, user_scopes.role_id population, etc.
});
```

**H4 — Playwright spec** (analog: `tests/settings/business-events.spec.ts:1-18`):

```ts
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/roles renders PageHeader with title", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/roles");

  await expect(page.getByRole("heading", { name: "Roles", level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
```

**Things to copy across all test files:**
- `signInAsAdmin(page)` from `tests/helpers/auth` (NOTE: `tests/auth/setup.ts` has `signInAsAdmin` too — both exist; check `helpers/auth.ts` for the canonical export the settings specs import).
- `pageerror` listener + final `expect(pageErrors).toEqual([])` — catches client-render regressions.
- `page.getByRole("heading", { level: 1, name: "..." })` — the canonical heading assertion.
- For action specs, `await expect(page.getByRole("button", { name: /invite user/i })).toBeVisible();`.

**Things to NOT copy:**
- `tests/rbac/viewer-controls.spec.ts:1-63` is a **placeholder** (no seeded viewer user) — RESEARCH explicitly requires the lock-out + `<Can>` specs to actually run a viewer login. Planner needs a non-admin seeded user (creating one is in scope; document in plan).

---

## Shared Patterns

### Audit logging
**Source:** `src/lib/audit.ts:9-62` (`writeAuditLog` signature + entry shape)
**Apply to:** All role/permission/user-role mutating server actions.

```ts
// src/lib/audit.ts:9-43 ── EXISTING SIGNATURE (must extend entityType + action enums via migration before use)
await writeAuditLog(
  {
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "role",                           // ← NEW (currently fixed enum on the type — see "Critical reversals")
    entityId: role.id,
    entityName: role.displayName,
    action: "permissions_replace",                // ← NEW action literal
    metadata: {
      kind: "role.permissions.replace",
      roleId: role.id,
      before: prevRules,
      after: nextRules,
      impactedUserCount: N,
    },
  },
  db,                                             // ← optional second arg; testcontainers pass tx here
);
```

**Verbatim metadata shapes for each kind** — see RESEARCH Q5 (lines 826-908 of 10-RESEARCH.md). Five shapes: `role.permissions.replace`, `role.create`, `role.delete`, `user.roles.assign`, `user.roles.revoke`.

**Critical:** `entityType` and `action` are **TypeScript literal unions** in `audit.ts:13-38`, not Postgres enums. The migration only needs to add the new literal values to the TS file (no SQL ALTER) — but the existing TS-enforced shape means **every new audit kind requires extending `audit.ts:13` AND `audit.ts:16-38`** before the call sites compile. Plan must include this edit.

---

### Server-action result envelope
**Source:** `src/app/(app)/locations/merge-action.ts:37-42` (most evolved variant — has `success` + `error` + `status` discriminator)
**Apply to:** All new server actions in `roles/actions.ts`, `users/[id]/role-actions.ts`.

```ts
export type Result =
  | { success: true; <field>: <type> }            // happy path with payload
  | { error: string }                             // validation / permission / unknown error
  | { status: "lockout_prevention" };             // typed sentinel for the lock-out guard
```

The diff-preview path returns `{ success: true; impactedUserCount: number }` so the modal can confirm "save will affect N users".

---

### `requireRole('admin')` → audit-logged action
**Source:** `src/app/(app)/settings/business-events/actions.ts` — every mutation function in this file
**Apply to:** All role/permission/user-role write paths.

The shape is: `try { const session = await requireRole("admin"); /* DB write */; await writeAuditLog({...session derives actor.../* shape */}); return { success: true }; } catch (error) { return { error: ... } }`. **Through Wave 3, `requireRole("admin")` is the shim that delegates internally to `ability.can('manage', 'all')` per RESEARCH Wave-2 plan.**

---

### Two-file server-action split (mandatory)
**Source:** `src/app/(app)/settings/users/[id]/scopes-actions.ts` + `scopes-internal.ts`
**Apply to:** `roles/actions.ts` + `roles/[id]/editor-internal.ts`; `users/[id]/role-actions.ts` + `users/[id]/role-internal.ts`.

Reason verbatim from `scopes-internal.ts:1-19`:
1. `"use server"` files can only export async functions; type-only re-exports break Turbopack server-action bundling at runtime.
2. Helpers exported from a `"use server"` file become network-callable RPCs — bypassing the `requireRole` gate that lives in the public wrapper.

This pattern is **non-negotiable** in this project; every new server-action surface follows it.

---

### Per-request `react.cache` memoisation
**Source:** `src/lib/auth/get-user-ctx.ts:8`, `src/lib/scoping/scoped-query.ts:23`
**Apply to:** `buildAbility` in `src/lib/casl/ability.ts`.

```ts
import { cache } from "react";
export const getUserCtx = cache(async (): Promise<UserCtx> => { ... });
```

`cache()` dedupes within a single RSC render pass — N islands calling `getUserCtx()` hit the DB once. The new `buildAbility` MUST be `cache`-wrapped or the Ability is re-derived per island (RESEARCH "Anti-Patterns" item 3).

---

### Idempotent migration guards
**Source:** `migrations/0048_phase_09_1_net_amount_gbp_not_null.sql` + `migrations/0045_phase_09_hotel_alerts.sql`
**Apply to:** All three new migration files (0050, 0051, 0052).

- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- `INSERT ... ON CONFLICT DO NOTHING` for seed rows.
- `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='...') THEN ALTER TABLE ... ADD CONSTRAINT ... END IF; END $$;` for CHECK / unique constraints.
- `DO $body$ BEGIN IF EXISTS (... is_nullable='YES'...) THEN ALTER TABLE ... SET NOT NULL; END IF; END $body$;` for NOT NULL flips.
- `--> statement-breakpoint` between every statement.

---

## Critical Reversals & Gotchas (planner MUST surface in PLAN.md)

1. **`user.role` text is NOT dropped.** RESEARCH Q1 reverses CONTEXT §"Default tier mapping" decision. Better Auth admin plugin reads `session.user.role` text in 12 endpoints (`set-role`, `impersonate`, `ban`, `userHasPermission`, ...). Schema additions are **`role_id`-NEVER**; instead, add `user_roles` link table AND keep `user.role` text as denormalised mirror of primary tier (refreshed in same tx as `user_roles` writes via `refreshUserRoleMirror(userId, tx)`). PLAN must call this out as the headline reversal.

2. **`audit.ts` entityType + action literal unions are TS-only.** Adding `"role"`, `"role_permission"`, `"user_role"` (entityTypes) and `"permissions_replace"` (action) requires editing `src/lib/audit.ts:13` and `:16-38` IN THE SAME PR. There is no Postgres enum to ALTER; the union widening is the only ceremony. Do this in Wave 1 before any role action file compiles.

3. **`migrations/0052` may not be needed** — RESEARCH Open-Question OQ-2 says `userScopes.role_id` may stay nullable forever (admin users have zero scope rows). If the planner picks "stay nullable", `0052` is deleted from the plan. The PR is then 2 migrations + code, not 3 migrations + code.

4. **No-analog file: `src/lib/casl/fields.ts` (`getTableColumns` introspection).** RESEARCH §Pattern 2 has the verbatim shape; plan from RESEARCH lines 280-317 directly, no codebase analog.

5. **No close analog for the rule-row repeater UI.** `event-form.tsx` is the closest form-driven editor but is single-shape, not a repeater. Planner introduces `react-hook-form`'s `useFieldArray` — already installed (`^7.71.2`). Surface as a known novel-component task in PLAN.

6. **`tests/rbac/viewer-controls.spec.ts:28-46` are placeholder tests** that document what to assert when a viewer user is seeded. Phase 10 needs a non-admin test user (RESEARCH Wave-0 e2e specs require a viewer login). Plan task: extend `tests/auth/setup.ts` (lines 11-28) with `TEST_OPS_IT` + `TEST_VIEWER` constants and `signInAs(page, fixture)` helper.

7. **`tests/access-control/` directory does not exist.** Wave 0 creates it. Existing `tests/rbac/` (2 files) stays for the v1.0 redaction-parity assertions; the new `tests/access-control/` is for ability-builder + Can-component + role-editor specs (RESEARCH §Validation Architecture).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/casl/fields.ts` | introspection helper | `getTableColumns` → `string[]` | The codebase doesn't currently use `getTableColumns` outside of drizzle-orm internals. Plan from RESEARCH §Pattern 2 (lines 280-317 of 10-RESEARCH.md) verbatim. |
| `src/app/(app)/settings/roles/[id]/role-editor-client.tsx` rule-row repeater | client form | RHF `useFieldArray` over rule rows | No existing form is a repeater; `event-form.tsx` is single-shape. Planner introduces `react-hook-form` `useFieldArray` (lib already installed). |
| `tests/access-control/edit-tier.spec.ts` (live tier-edit-applies-without-deploy) | Playwright e2e | full stack | No existing spec exercises a settings-admin → next-request-effect flow. Pattern: edit via UI, log out, log back in (or wait for `react.cache` reset across requests), assert behaviour change. New idiom; planner specifies. |

---

## Metadata

**Analog search scope:** `src/lib/{auth,rbac,scoping,audit,merge,location-merge}.ts`, `src/db/schema.ts`, `migrations/004{5,6,7,8}*.sql`, `src/app/(app)/settings/{users,business-events,outlet-types}/*`, `src/app/(app)/locations/{merge-action,[id]/page,actions}.ts`, `src/components/{theme-provider,layout/{app-sidebar,user-menu}}.tsx`, `src/components/admin/manage-scopes-dialog.tsx`, `src/components/table/merge-dialog.tsx`, `tests/{rbac,settings,db,auth}/*`.

**Files scanned:** ~38 source + 5 migrations + 8 test files = 51 reads.
**Pattern extraction date:** 2026-05-10
**Re-verify if:** Any file in this map changes shape before the plan is written; particularly `src/lib/audit.ts`, `src/lib/auth/get-user-ctx.ts`, or `src/app/(app)/settings/users/[id]/scopes-internal.ts` (the load-bearing pattern donors).

---

## PATTERN MAPPING COMPLETE
