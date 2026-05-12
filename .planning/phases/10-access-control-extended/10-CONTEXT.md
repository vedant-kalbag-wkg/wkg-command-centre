# Phase 10: Access Control Extended — CONTEXT

**Phase number:** 10
**Phase name:** Access Control Extended
**Milestone:** v1.1 — Data foundation + email
**Branch:** `gsd/phase-10-access-control-extended`
**Captured:** 2026-05-10
**Mode:** discuss (default), 4/4 areas covered

---

## Domain

Replace the codebase's hardcoded role checks (`requireRole(...)`, `canAccessSensitiveFields`, `redactSensitiveFields`) with a CASL `Ability` built per-request from DB-backed JSON rule rows, and ship admin UIs for editing tier-default rule sets and authoring custom granular roles. Existing 3-role coverage (Admin / Ops-IT / Read-only) preserved as default tiers; `userScopes` continues to drive scoping conditions, evolved to per-(user, role) granularity.

This phase is independent of the v1.1 data/email arc and does not block, nor is blocked by, Phase 11.

---

## Locked at scoping (do not re-discuss)

These were decided in `REQUIREMENTS.md` → Architectural Decisions and `.planning/research/v1.1-rbac-model.md`:

| Item | Decision |
|---|---|
| Library | **CASL** — `@casl/ability@^6.8.1` + `@casl/react@^6.0.0` |
| Integration point | Extend `src/lib/auth/get-user-ctx.ts`; build Ability after Better Auth's `getSession`; attach to `UserCtx` |
| Field redaction migration | `redactSensitiveFields(data, user)` → `permittedFieldsOf(ability, 'read', subject)` |
| `userScopes` | Preserved; feeds CASL `conditions` |
| Default tier coverage | Admin / Ops-IT / Read-only preserved; no behavioural regression for current users |
| Admin UI | Tier rule editing without deploy is a hard requirement (success criterion #2) |
| Custom roles | Authorable via admin UI; per-role rule set (subjects × actions × fields × conditions); per-user assignment (success criterion #4) |
| Ops surface convention | "No manual SQL for ops" — operator-facing destructive ops are first-class admin UI features, not scripts |

---

## Canonical refs

**MUST be read by researcher / planner / executor before acting:**

- `ROADMAP.md` → Phase 10 — `/.planning/ROADMAP.md`
- v1.1 architectural decisions (RBAC row) — `.planning/REQUIREMENTS.md`
- v1.1 RBAC research note — `.planning/research/v1.1-rbac-model.md` (TL;DR, Options Considered, Permission model sketch, Implementation note)
- Existing RBAC code site for migration — `src/lib/rbac.ts`
- Existing user-context builder (CASL integration target) — `src/lib/auth/get-user-ctx.ts`
- Existing scoping primitives — `src/lib/scoping/scoped-query.ts` (and `.test.ts`)
- Existing redaction call sites — `src/app/(app)/locations/actions.ts`, `src/app/(app)/locations/new/page.tsx`, `src/app/(app)/locations/[id]/page.tsx`
- Existing role-gate call sites — `src/lib/merge.ts` (×3), `src/lib/analytics/cache-scope.ts`, `src/lib/geocoding/pipeline.ts`, `src/app/(app)/settings/users/actions.ts`, all admin server actions
- Existing schema — `src/db/schema.ts` (search `userScopes`, `user`, role plumbing)
- User-edit + scope CRUD — `src/app/(app)/settings/users/[id]/scopes-internal.ts`, `scopes-actions.ts`
- Project memory — `~/.claude/projects/-Users-vedant-Work-WeKnowGroup-wkg-kiosk-tool/memory/no_manual_sql_for_ops.md` (admin UI > script convention)

---

## Prior decisions carried forward

From earlier v1.1 phases (Phase 7 → 9.1):

- **Admin UI > scripts** for any recurring destructive operator op (locked 2026-05-03; reaffirmed in Phase 7 / DATA-02 location-merge).
- **Audit-log every operator action** with actor + selected IDs + canonical target — same shape as DATA-02 merges.
- **Drizzle migrations are atomic per PR** — schema + backfill + cutover land together, no straddling deploys.
- **`react.cache` per-request memoisation** for session/scope lookups (used in `getSessionOrThrow`, `getUserCtx`, `scopedQuery`) — extend the same idiom for ability building.
- **External users (`userType='external'`) are a contract-grade safety boundary** — Phase 1 invariant; cost of accidental exposure is legal, not bug-fix risk.

---

## Code context (existing reusable assets)

| Asset | Location | Reuse plan |
|---|---|---|
| Session cache + role gate | `src/lib/rbac.ts` (`getSessionOrThrow`, `requireRole`) | `getSessionOrThrow` kept; `requireRole(...roles)` rewritten to delegate to `ability.can('manage', 'all')` or per-action checks; legacy text-role param dropped |
| User-context builder | `src/lib/auth/get-user-ctx.ts` | Primary integration point — append rule loading + scope derivation + `Ability` build before return |
| Field redactor | `src/lib/rbac.ts` (`canAccessSensitiveFields`, `redactSensitiveFields`) | Internals replaced by `permittedFieldsOf` call against the request's `Ability`; signatures kept temporarily so call sites compile during migration, then call sites rewritten |
| Scoping core | `src/lib/scoping/scoped-query.ts` (`buildScopeFilter`, `userScopes` loader) | `userScopes` query evolves to per-(user, role); `buildScopeFilter` continues to drive SQL filtering; CASL `conditions` derived from the same data via the Ability builder |
| Audit log | existing `auditLogs` table + writers (`src/lib/audit.ts`) | Reused for role/permission edit events + role-assignment events; no new logging substrate |
| Settings shell + admin pages | `src/app/(app)/settings/*` (existing tree) | New `/settings/roles` lives here; copies pattern from `/settings/users`, `/settings/outlet-types`, etc. |
| Impersonation | `impersonating_user_id` cookie + branch in `getUserCtx` | Untouched; impersonated UserCtx will get its own `Ability` built off the impersonated user's role grants |

---

## Decisions

### 1. Rules persistence schema

| Decision | Value |
|---|---|
| Storage shape | Hybrid: `roles` table (`id`, `name`, `kind: 'system' \| 'tier' \| 'custom'`, `display_name`, `description`) + `role_permissions` rows (`role_id`, `action`, `subject`, `fields jsonb`, `conditions jsonb`, `inverted bool`) |
| Edit semantics | Replace-all on save: `DELETE FROM role_permissions WHERE role_id = X` then `INSERT` the new set in a single transaction. Whole-set diff captured in `auditLogs`. |
| Conditions wiring | **Option B** — rule rows are scope-agnostic. The Ability builder in `getUserCtx` layers in derived scope rules from the user's per-(user, role) scope assignments. Builder owns the subject → scope-dimension mapping (e.g. `Kiosk → regionId via location`). |
| Subject + action taxonomy | CRUD + named domain actions. Actions ∈ `{ read, create, update, delete, merge, impersonate, import, export, silence_alert }`. Subjects in PascalCase mapping to entities (`Kiosk`, `Location`, `User`, `AuditLog`, `Analytics`, `RolePermission`, `EmailLog`, ...). A subject → Drizzle-table registry powers `permittedFieldsOf` and field-picker autocomplete in the admin UI. |

### 2. Default tier mapping + role identity

| Decision | Value |
|---|---|
| Tier identity | Admin is `kind='system'` — uneditable, always grants `manage all`. Ops-IT and Read-only ship as `kind='tier'` editable seed rows whose rule sets can be edited via admin UI without deploy. |
| `user.role` migration | Replace `user.role` text column with `user.role_id` FK to `roles` in one migration. Backfill: `'admin' → Admin`, `'member' → Ops-IT`, `'viewer' → Read-only`. All `requireRole` / `canAccessSensitiveFields` call sites switched in lock-step in the same PR. |
| `system` role | Bypasses CASL entirely. `getUserCtx` short-circuits without building an Ability for `userType='system'` (or the historical `'system'` value); ETL/cron/scripts continue to use the raw DB driver and never invoke `ability.can()`. |
| External-user invariant | **Code-level guard in the Ability builder**, NOT in rule data. Regardless of role rules, external users (`userType='external'`) have the hardcoded sensitive-key set stripped from `permittedFieldsOf` results. Defense-in-depth: an admin cannot grant external users `bankingDetails` access via the UI. |

### 3. Custom-role assignment model (IAM-style)

| Decision | Value |
|---|---|
| Assignment shape | **IAM-style multi-role.** `user_roles (user_id, role_id, assigned_at, assigned_by)` link table. Each user has N roles; effective `Ability` = union/precedence of all assigned roles. |
| Scope binding | **Scope attaches at assignment time, not on the role definition.** Roles are scope-agnostic templates (`Ops-IT`, `Banking Auditor`). `userScopes` evolves to per-(user, role, dimension): `(user_id, role_id, dimension_type, dimension_id)`. User A can have `Ops-IT` scoped to South West; user B can have `Ops-IT` scoped to North. The Ability builder loads scopes per (user, role) pairing and emits scope conditions on rules from that role only. |
| Conflict resolution | **Explicit-deny-wins** (AWS IAM semantics). Roles can grant OR deny via `inverted: true` rules. Effective = (union of grants) MINUS (union of denies). Admin UI must surface deny overrides visually in any "effective permissions" view. |

### 4. Admin-UI authoring shape

| Decision | Value |
|---|---|
| Primary authoring surface | **Form-driven GUI.** Add-rule wizard: subject multi-select → action chips → field picker (auto-populated from the subject's Drizzle column list with `*` / `**` wildcard chips) → condition builder (key/op/value with autocomplete). Each rule is a form row with an Allow/Deny toggle. No raw JSON editor in v1.1. |
| Page location | **New `/settings/roles` page**, sibling to `/settings/users`. List view of all roles → drill into one role for the rule editor. User-to-role assignment stays on `/settings/users/[id]`. |
| Save safety | **Diff preview + impacted-users count** before confirm. Surface (a) rule-level diff (added / removed / changed rules), (b) count of users currently assigned this role, (c) confirmation modal. No simulation, no protected-tier UI guards in v1.1 (Admin's `kind='system'` already prevents accidental admin-tier edits at the data layer). |

---

## Open research questions for planner / researcher

These are downstream concerns the planner must surface answers to before tasks are written.

1. **Better Auth role-plugin compatibility.** Better Auth's session middleware reads `session.user.role` as text. Dropping `user.role` requires either (a) replacing Better Auth's role-plugin role-read with a custom session-augmenter that derives role names from `user_roles → roles.name`, or (b) keeping `user.role` text as a denormalised mirror of the user's primary tier (still authoritative-by-`role_id` for permissions). Pick one; document in PLAN.
2. **Field-list registry derivation.** The form-driven editor needs "valid fields for subject X." Two paths: (a) auto-derived at build time from Drizzle schema introspection (single source of truth, no drift), (b) hand-maintained `subject → string[]` map in `src/lib/casl/subjects.ts`. Decide; the answer determines whether new tables auto-appear in the role editor.
3. **Atomicity of the migration PR.** Schema (`roles`, `role_permissions`, `user_roles`, `userScopes` reshape) → seeded defaults → call-site rewrites → Better Auth session adjustment → `user.role` text drop. Determine whether all of this lands in one PR or whether `user.role` text drop is a follow-up plan in this same phase.
4. **CASL on the client.** `@casl/react`'s `<Can>` component for client-side gating (e.g. hiding a "Merge" button when `ability.cannot('merge', 'Location')`). Decide which existing client-rendered UI gates migrate (the v1.0 audit listed several role-conditional renders); the rest stay server-only.
5. **Audit-log shape for role edits.** Reuse the existing `auditLogs` table/writer; design the `details` jsonb shape — likely `{ kind: 'role.permissions.replace', role_id, before: rules[], after: rules[] }` and `{ kind: 'user.roles.assign', user_id, role_id, scope: {...} }`. Confirm against `src/lib/audit.ts` writers.
6. **Validation: lock-out prevention at write-time.** Even though the UI v1.1 cut the protected-tier guards, the server action must still refuse to save a state where zero users have an effective `manage all` permission. Cheap server-side check; no UI surface beyond an error toast.

---

## Out of scope for Phase 10 (deferred / explicitly excluded)

- **JSON rule editor.** Form-driven only in v1.1. If admins outgrow the form (complex `$or` conditions, deep field paths), revisit in a later milestone.
- **Impersonation simulator** ("simulate as user X" preview before save). Useful but heavier; defer.
- **UI-layer protected-tier guards** beyond `kind='system'` data-layer enforcement. Lock-out prevention done server-side only.
- **Group / hierarchy / role-inheritance.** No "Ops-IT extends Read-only"; flat roles with explicit rule sets only.
- **Multi-tenant role isolation.** Roles are global; no per-`hotel_group` role authoring scope.
- **Better Auth plugin authoring** (a custom CASL Better Auth plugin). The integration is a pure post-session derivation; no plugin needed.
- **SSO / external IdP.** Out of v1.1 entirely.
- **Time-bound role grants** (assigned_until). Not in v1.1; assignments are permanent until revoked.

---

## Success criteria (from ROADMAP — restated for verifier)

1. CASL `Ability` built in `get-user-ctx`; per-(user, role) scope assignments drive `conditions`.
2. Configurable Ops-IT / Read-only tier rules persisted as JSON in DB; admin UI for tier editing without deploy.
3. `redactSensitiveFields` replaced by `permittedFieldsOf(ability, 'read', subject)` drop-in across all call sites.
4. Admin can create / edit / clone custom roles (subjects × actions × fields × conditions) and assign them per-user with per-(user, role) scope.
5. Existing 3-role coverage (Admin / Ops-IT / Read-only) preserved as default tier definitions; no behavioural regression for current users.
6. External-user `bankingDetails` / sensitive-key invariant preserved as a code-level guard in the Ability builder, immune to admin-UI editing.

---

## Next steps

```
/gsd-plan-phase 10
```

Researcher reads this CONTEXT.md and the canonical refs above, then writes RESEARCH.md answering the six open questions. Planner consumes both to produce the plan.
