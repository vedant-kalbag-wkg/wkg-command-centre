---
phase: 10
name: access-control-extended
status: OPEN_THREATS
threats_open: 4
threats_mitigated: 10
asvs_level: 2
audited_at: 2026-05-10
auditor: claude-sonnet-4-6 (adversarial stance)
---

# Phase 10 — Security Audit

## OPEN_THREATS

**Phase:** 10 — access-control-extended
**Closed:** 10/14 | **Open:** 4/14
**ASVS Level:** 2

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-10-01 | AuthZ / CASL deny-wins semantics | mitigate | CLOSED | `ability.ts:95` — `applyExternalUserInvariant` called unconditionally last; both `buildAbility` and `buildSeededAbility` paths end with the invariant append |
| T-10-02 | ExternalUser invariant (field strip) | mitigate | CLOSED | `external-invariant.ts:46-56` — `applyExternalUserInvariant` no-ops for internal/system; appends `cannot` rules for all BANKING_CONTRACT_FIELDS and EXTERNAL_ONLY_SENSITIVE_FIELDS for external/null/undefined users |
| T-10-03 | Admin name reservation / privilege escalation via custom role | mitigate | **OPEN** | `editor-internal.ts:181` — `name: input.name` inserted with no RESERVED_ROLE_NAMES check; `role-mirror.ts:60` — raw `assignments[0]?.name` written to `user.role` for custom roles. A custom role named "admin" gains impersonation capability. **→ CR-03** |
| T-10-04 | Lockout guard coverage | mitigate | **OPEN** | `lockout-guard.ts:48` — WHERE clause is `eq(roles.kind, "system")` only. The doc-comment at line 27 describes "system-kind OR admin-named" but `OR eq(roles.name, "admin")` is absent. Custom tier/custom roles named "admin" that hold real admin sessions are not counted by the guard. **→ CR-01** |
| T-10-05 | TOCTOU race in scope removal | mitigate | **OPEN** | `scopes-internal.ts:179-195` — external-user invariant check (line 185-195) and `db.delete` (line 197) are NOT wrapped in a transaction; concurrent removal of the same last scope can pass the guard twice. **→ CR-04** |
| T-10-06 | SQL injection via rule action/subject strings | mitigate | CLOSED | `subjects.ts:43-64` — `assertValidAction` and `assertValidSubject` perform Set-based allowlist lookup before any DB write; Drizzle ORM uses parameterized queries throughout `editor-internal.ts` |
| T-10-07 | Audit log coverage — role and user_role mutations | mitigate | CLOSED | `audit.ts:13-38` — entity types "role", "role_permission", "user_role" and action "permissions_replace" added; all role mutations in `editor-internal.ts` and `role-internal.ts` call `writeAuditLog` inside the same transaction |
| T-10-08 | Audit log coverage — scope mutations (WR-02) | mitigate | **OPEN** | `scopes-internal.ts:131` (`_addScopeForActor`) and line 199 (`_removeScopeForActor`) call `writeAuditLog(…, db)` outside any transaction; a crash between the DML and the audit write leaves the operation logged inconsistently. The audit write itself exists but is non-atomic. **→ WR-02** |
| T-10-09 | Migration 0050 idempotency | mitigate | CLOSED | `0050_phase_10_roles_schema.sql` — all `CREATE TABLE` statements use `IF NOT EXISTS`; constraint additions wrapped in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$` guards |
| T-10-10 | Migration 0051 seed idempotency (role_permissions) | mitigate | **OPEN** | `0051_phase_10_seed_and_backfill.sql:57,80` — Deltas 2 and 3 use `ON CONFLICT DO NOTHING` targeting the `uuid` PRIMARY KEY of `role_permissions`; `0050` defines no UNIQUE constraint on `(role_id, action, subject, inverted)`, so the conflict target never fires and re-runs produce duplicate permission rows. **→ CR-02** |
| T-10-11 | Migration 0052 NOT-NULL operator gate | mitigate | CLOSED | `0052_phase_10_user_scopes_role_id_required.sql:23-33` — entire `ALTER COLUMN` is wrapped in `DO $body$ BEGIN IF EXISTS (SELECT … is_nullable='YES') THEN … END IF; END $body$`; idempotent and operator-gated |
| T-10-12 | SSR/hydration mismatch in AbilityProvider | mitigate | CLOSED | `ability-context.tsx:13-28` — rules are passed as serialized props from the RSC parent; no server-only rules are mixed into the client bundle; `useMemo` dependency on `rules` array reference has a performance impact (WR-03) but no security consequence |
| T-10-13 | Impersonation — ability rebuild for target user | mitigate | CLOSED | `get-user-ctx.ts:28-35` — when `impersonatingId` is set the code calls `buildAbility(target.id)`, not `buildAbility(session.user.id)`; admin does not retain elevated rights during impersonation |
| T-10-14 | Field-level scope leaks (redactSensitiveFields → permittedFieldsOf) | mitigate | CLOSED | `rbac.ts:63-66` imports `BANKING_CONTRACT_FIELDS` and `EXTERNAL_ONLY_SENSITIVE_FIELDS` from `external-invariant.ts`; CASL rules in `ability.ts` also reference the same constants — single source of truth, no divergence possible |

---

## Open Threats (Blockers)

### T-10-03 — Admin name reservation missing (CR-03)

**Category:** Privilege escalation via custom role naming

**Files searched:** `editor-internal.ts`, `role-mirror.ts`

**Mitigation expected:** RESERVED_ROLE_NAMES check blocking "admin", "ops-it", "read-only" names on custom role create/rename; role-mirror fallback should not propagate reserved names to `user.role`

**Evidence of absence:**
- `editor-internal.ts:181` — `name: input.name` inserted directly with no guard
- `editor-internal.ts:380-388` — `_cloneRoleForActor` calls `_createRoleForActor` passing user-supplied name unchanged
- `role-mirror.ts:59-61` — custom role fallback branch writes `assignments[0]?.name ?? null` verbatim; a custom role named "admin" sets `user.role = "admin"`, granting that user impersonation capability via `get-user-ctx.ts:17`

**Impact:** Admin can create a custom role named "admin", assign it to any user, and that user gains the impersonation capability gate in `get-user-ctx.ts`.

---

### T-10-04 — Lockout guard WHERE clause incomplete (CR-01)

**Category:** Lockout prevention bypass

**Files searched:** `lockout-guard.ts`

**Mitigation expected:** Guard counts users who hold ANY effective-admin role (system-kind OR any role whose mirror resolves to "admin")

**Evidence of absence:**
- `lockout-guard.ts:46-51` — WHERE clause is `and(eq(roles.kind, "system"), eq(user.banned, false))`; the `OR eq(roles.name, "admin")` clause described in the doc comment at line 27 is absent
- A tier/custom role named "admin" is not counted; revoking the last system-kind role passes the guard even when admin sessions remain through the name-mirror path

---

### T-10-05 — TOCTOU race in _removeScopeForActor (CR-04)

**Category:** Race condition in scope removal

**Files searched:** `scopes-internal.ts`

**Mitigation expected:** External-user last-scope guard and the DELETE must execute inside a serializable transaction

**Evidence of absence:**
- `scopes-internal.ts:179-195` — `userType` check and `remaining` count are bare `await db.select(…)` calls
- `scopes-internal.ts:197` — `await db.delete(userScopes).where(…)` follows outside any `db.transaction(…)` block
- Two concurrent removal requests can both pass the `remaining.length <= 1` guard before either delete executes

---

### T-10-08 — Non-atomic audit log for scope mutations (WR-02)

**Category:** Audit log integrity

**Files searched:** `scopes-internal.ts`

**Mitigation expected:** `writeAuditLog` called inside the same DB transaction as the DML it records

**Evidence of absence:**
- `scopes-internal.ts:90-145` (`_addScopeForActor`) — no `db.transaction(…)` wrapper; insert at line 113 and `writeAuditLog` at line 131 are separate awaits against `db`
- `scopes-internal.ts:197-215` (`_removeScopeForActor`) — delete at line 197 and `writeAuditLog` at line 199 are separate awaits against `db`
- A crash or connection drop between DML and audit write produces a silent scope mutation

---

### T-10-10 — role_permissions seed not idempotent on re-run (CR-02)

**Category:** Migration safety

**Files searched:** `migrations/0050_phase_10_roles_schema.sql`, `migrations/0051_phase_10_seed_and_backfill.sql`

**Mitigation expected:** `ON CONFLICT DO NOTHING` targeting a unique constraint on `(role_id, action, subject)` in `role_permissions`

**Evidence of absence:**
- `0050_phase_10_roles_schema.sql` — `role_permissions` table is created with only `uuid` PRIMARY KEY; no UNIQUE constraint on `(role_id, action, subject, inverted)` or any subset
- `0051:57` (Delta 2) and `0051:80` (Delta 3) — `ON CONFLICT DO NOTHING` with no conflict target resolves against the uuid PK, which is always unique; the clause is effectively a no-op
- Re-running migration 0051 (e.g., after a failed deployment rollback) duplicates all `ops-it` and `read-only` permission rows, causing `buildAbility` to evaluate duplicate allow/deny rules

---

## Closed Threats — Evidence Summary

| Threat ID | Evidence (file:line) |
|-----------|----------------------|
| T-10-01 deny-wins | `ability.ts:95` — `applyExternalUserInvariant(builder, userType)` is the final call before `builder.build()` |
| T-10-02 external invariant | `external-invariant.ts:46-56` — null/undefined/external userType all enter the block; BANKING_CONTRACT_FIELDS + EXTERNAL_ONLY_SENSITIVE_FIELDS appended as `cannot` |
| T-10-06 SQL injection | `subjects.ts:43-64` — `assertValidAction` / `assertValidSubject` throw on unknown strings; Drizzle ORM parameterizes all values |
| T-10-07 audit coverage (role ops) | `editor-internal.ts` transactions all call `writeAuditLog` inside `tx`; `role-internal.ts:214-231` and `300-317` do the same |
| T-10-09 migration 0050 idempotency | `0050_phase_10_roles_schema.sql` — every DDL block guarded by `IF NOT EXISTS` or exception-handler `DO $$` block |
| T-10-11 migration 0052 NOT-NULL gate | `0052_phase_10_user_scopes_role_id_required.sql:23-33` — operator-gated, idempotent `DO $body$ … IF EXISTS … END` wrapper |
| T-10-12 SSR/hydration | `ability-context.tsx:13-28` — rules passed as RSC props, no server-only data in client bundle |
| T-10-13 impersonation ability rebuild | `get-user-ctx.ts:28-35` — `buildAbility(target.id)` called for impersonated user; admin ability discarded |
| T-10-14 field-level scope leaks | `rbac.ts:63-66` and `ability.ts` both import constants from `external-invariant.ts`; single source of truth |

---

## Known Acknowledged Risks (from 10-REVIEW.md)

The following findings from the prior code review (`10-REVIEW.md`) overlap with the open threats above. They are documented here as acknowledged rather than double-counted.

| Review Finding | Maps to Threat | Status |
|----------------|----------------|--------|
| CR-01 — Lockout guard WHERE clause bug | T-10-04 | OPEN (BLOCKER) |
| CR-02 — Migration 0051 role_permissions seed not idempotent | T-10-10 | OPEN (BLOCKER) |
| CR-03 — Custom role named "admin" privilege escalation | T-10-03 | OPEN (BLOCKER) |
| CR-04 — TOCTOU race in _removeScopeForActor | T-10-05 | OPEN (BLOCKER) |
| WR-01 — Null-deref in _assignRoleForActor fallback path | Unregistered | WARNING (see below) |
| WR-02 — Non-atomic audit log for scope mutations | T-10-08 | OPEN (BLOCKER) |
| WR-03 — AbilityProvider array reference instability | Unregistered | WARNING (see below) |
| IN-01 — role-mirror tier name fallthrough | Subsumed by CR-03 | — |
| IN-02 — buildAbility default userType before null check | Unregistered | INFO (see below) |

---

## Unregistered Flags

The following issues emerged during implementation but have no threat mapping in the Phase 10 threat model.

### WR-01 — Null-deref in _assignRoleForActor conflict fallback

`role-internal.ts:178-185` — when `INSERT … RETURNING` returns an empty array (conflict branch), the code falls back to a `.select()` with `[0].id` accessed without a null check. If the `(userId, roleId)` row is deleted between the insert and the fallback select (extremely narrow window), the expression throws `TypeError: Cannot read properties of undefined (reading 'id')`. Security impact: nil (admin-only operation); correctness impact: silent 500 instead of success.

### WR-03 — AbilityProvider useMemo array reference instability

`ability-context.tsx:20-23` — `useMemo(() => createMongoAbility(rules), [rules])` recreates the ability on every render because the `rules` array prop is a new reference each render. No security impact; ability contents are always server-authoritative. Pure performance issue.

### IN-02 — buildAbility default userType before null check

`ability.ts:22` — `const userType = (u?.userType ?? "internal")` executes before the null check at line 32. An unauthenticated request (u = null) defaults to "internal" at line 22, then hits the null check and applies the external invariant. Deny-wins means the external invariant strips the incorrectly defaulted internal rules. Effective security posture is correct (unauthenticated = no access), but the default is misleading and could become a vulnerability if the null check is ever relocated.

---

## Recommended Pre-Production Actions

The four BLOCKER threats must be remediated before this phase ships to production. Suggested implementation paths (implementation is out of scope for this audit — code is READ-ONLY):

1. **T-10-03 / CR-03 — Admin name reservation**
   - Define `RESERVED_ROLE_NAMES = ["admin", "ops-it", "read-only"]` in `editor-internal.ts`
   - Add guard in `_createRoleForActor` and any rename path before the `db.insert`
   - In `role-mirror.ts:59-61`, check custom role name against RESERVED_ROLE_NAMES; throw or map to null instead of propagating
   - Downstream: `get-user-ctx.ts:17` impersonation gate will then only fire for legitimate system-kind admin assignments

2. **T-10-04 / CR-01 — Lockout guard**
   - Change `lockout-guard.ts:46-51` WHERE clause to:
     `and(or(eq(roles.kind, "system"), eq(roles.name, "admin")), eq(user.banned, false))`
   - After CR-03 fix lands, this broadened guard is consistent with the role-mirror semantics (any role whose mirror resolves to "admin")

3. **T-10-05 / CR-04 — TOCTOU scope removal**
   - Wrap `scopes-internal.ts:156-215` (`_removeScopeForActor`) in `db.transaction(async (tx) => { … })` using `tx` for all reads and the delete
   - Pass `tx` to `writeAuditLog` call at line 199

4. **T-10-08 / WR-02 — Non-atomic audit log for scope mutations**
   - Wrap `scopes-internal.ts:103-144` (`_addScopeForActor`) body in `db.transaction(…)`, pass `tx` to insert and `writeAuditLog`
   - Same wrapping for `_removeScopeForActor` (overlaps with CR-04 fix)

5. **T-10-10 / CR-02 — role_permissions seed idempotency**
   - Add UNIQUE constraint to `role_permissions(role_id, action, subject, inverted)` (new migration)
   - OR rewrite Deltas 2/3 of 0051 as upserts using an explicit `ON CONFLICT (role_id, action, subject, inverted) DO NOTHING`
   - Without this, any deployment rollback/retry doubles the permission rows

---

## Audit Scope

Files audited:

- `src/lib/casl/ability.ts`
- `src/lib/casl/ability-context.tsx`
- `src/lib/casl/external-invariant.ts`
- `src/lib/casl/lockout-guard.ts`
- `src/lib/casl/role-mirror.ts`
- `src/lib/auth/get-user-ctx.ts`
- `src/lib/rbac.ts`
- `src/lib/audit.ts`
- `src/lib/casl/subjects.ts`
- `src/app/(app)/settings/roles/editor-internal.ts`
- `src/app/(app)/settings/roles/actions.ts`
- `src/app/(app)/settings/users/[id]/scopes-internal.ts`
- `src/app/(app)/settings/users/[id]/scopes-actions.ts`
- `src/app/(app)/settings/users/[id]/role-internal.ts`
- `src/app/(app)/settings/users/[id]/role-actions.ts`
- `migrations/0050_phase_10_roles_schema.sql`
- `migrations/0051_phase_10_seed_and_backfill.sql`
- `migrations/0052_phase_10_user_scopes_role_id_required.sql`

ASVS Level 2 controls checked: V1.2 (AuthN Architecture), V4.1 (Access Control Design), V4.2 (Operation Level Access Control), V7.2 (Log Processing), V14.2 (Dependency Integrity).
