---
phase: 10
plan: 05
type: execute
wave: 3
depends_on: [03]
files_modified:
  - src/app/(app)/settings/roles/page.tsx
  - src/app/(app)/settings/roles/role-list-client.tsx
  - src/app/(app)/settings/roles/actions.ts
  - src/app/(app)/settings/roles/editor-internal.ts
  - src/app/(app)/settings/roles/[id]/page.tsx
  - src/app/(app)/settings/roles/[id]/role-editor-client.tsx
  - src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx
  - src/app/(app)/settings/roles/new/page.tsx
  - src/app/(app)/settings/page.tsx
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "Admin can browse all roles at /settings/roles, drill into one, edit its rule set, see a diff preview + impacted-users count, save, and have the change apply to the next request — without deploy (per AUTH-06 SC2 + AUTH-07 SC4)."
    - "The two-file 'use server' split is enforced verbatim — actions.ts has 'use server', editor-internal.ts is a sibling helper file with NO directive (PATTERNS.md §\"Two-file server-action split (mandatory)\"). Helpers are called _<verb>ForActor and take db as first arg for testcontainers compatibility."
    - "Save flow is transactional: DELETE existing role_permissions WHERE role_id=X, INSERT the new set, run assertAtLeastOneEffectiveAdmin(tx) BEFORE commit, write audit log, all in one db.transaction. Partial failures roll back."
    - "Audit-log entries land for every role mutation: role.create, role.permissions.replace, role.delete (per RESEARCH Q5 verbatim metadata shapes)."
    - "Lock-out guard refuses to save when the change would leave zero effective admins — server-action returns { status: 'lockout_prevention' }; modal shows the operator the recovery path."
    - "system role (kind='system' = Admin) is uneditable — UI disables Save; server action explicitly rejects replaceRolePermissions on a system role with { error: 'System roles are immutable.' }."
  artifacts:
    - path: "src/app/(app)/settings/roles/page.tsx"
      provides: "RSC list view of all roles with display name, kind, description, assigned-user count, edit/clone/delete actions; gated on ability.can('manage', 'Role')"
    - path: "src/app/(app)/settings/roles/role-list-client.tsx"
      provides: "'use client' island — Create-role + Clone buttons, table renderer, dialogs"
    - path: "src/app/(app)/settings/roles/actions.ts"
      provides: "'use server' wrappers: listRoles, getRole, createRole, replaceRolePermissions, deleteRole, cloneRole — each gated on requireRole('admin') and writes audit log"
    - path: "src/app/(app)/settings/roles/editor-internal.ts"
      provides: "_listRolesForActor, _getRoleForActor, _createRoleForActor, _replaceRolePermissionsForActor, _deleteRoleForActor, _cloneRoleForActor — testable helpers with db: AnyDb first arg + diff/impacted-users helpers"
    - path: "src/app/(app)/settings/roles/[id]/page.tsx"
      provides: "RSC detail view loading the role + its rules; renders the editor client island"
    - path: "src/app/(app)/settings/roles/[id]/role-editor-client.tsx"
      provides: "'use client' form-driven rule editor — react-hook-form + useFieldArray over rule rows; subject multi-select, action chips, field picker, condition builder, allow/deny toggle per row"
    - path: "src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx"
      provides: "'use client' diff preview + impacted-users count + confirm modal; handles result envelope { success } / { error } / { status: 'lockout_prevention' }"
    - path: "src/app/(app)/settings/roles/new/page.tsx"
      provides: "Create-role flow RSC wrapper — empty form, on submit creates role + initial rule set in one action"
    - path: "src/app/(app)/settings/page.tsx"
      provides: "Settings hub gains a 'Roles' tile linking to /settings/roles, gated on ability.can('manage', 'Role')"
  key_links:
    - from: "src/app/(app)/settings/roles/actions.ts replaceRolePermissions"
      to: "src/lib/casl/lockout-guard.ts assertAtLeastOneEffectiveAdmin"
      via: "Inside db.transaction, after DELETE+INSERT, before commit"
      pattern: "assertAtLeastOneEffectiveAdmin"
    - from: "src/app/(app)/settings/roles/actions.ts every mutation"
      to: "src/lib/audit.ts writeAuditLog"
      via: "entityType='role'/'role_permission' + action='create'/'permissions_replace'/'delete' + metadata jsonb (RESEARCH Q5 shapes)"
      pattern: "writeAuditLog\\("
    - from: "src/app/(app)/settings/roles/[id]/role-editor-client.tsx"
      to: "src/lib/casl/subjects.ts SUBJECT_TABLES + src/lib/casl/fields.ts fieldsOfSubject"
      via: "Subject multi-select pulls from KNOWN_SUBJECTS; field picker per-subject auto-completes from fieldsOfSubject(subject)"
      pattern: "KNOWN_SUBJECTS|fieldsOfSubject"
    - from: "src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx"
      to: "result envelope from replaceRolePermissions"
      via: "discriminated union: { success, impactedUserCount } | { error } | { status: 'lockout_prevention' }"
      pattern: "lockout_prevention"
---

<objective>
Build the `/settings/roles` admin UI: list view, create flow, drill-in detail with form-driven rule editor, diff-preview-with-impacted-users-count modal, save-flow with transactional DELETE+INSERT + lockout-guard + audit-log. This satisfies AUTH-06 SC2 (admin UI for tier editing without deploy) and AUTH-07 SC4 (admin can create/edit/clone custom roles).

Purpose: This plan turns ability.can(...) from a programmatic capability into a operator-authorable surface. The two-file `"use server"` split (actions.ts + editor-internal.ts per PATTERNS §\"Two-file server-action split (mandatory)\") is non-negotiable — this is the canonical pattern in the project and skipping it has caused real prod outages (per scopes-internal.ts:1-19 comment block — Turbopack RPC bundler crash).

Output: 9 files in `src/app/(app)/settings/roles/` + `[id]/` + `new/` trees. Plan 10-01's Playwright spec `tests/access-control/role-editor.spec.ts` goes GREEN (against local dev or testcontainers — full preview-alias run is in Plan 10-08). Settings hub gains a Roles tile.
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

# Donor patterns:
@src/app/(app)/settings/users/page.tsx
@src/app/(app)/settings/users/users-page-client.tsx
@src/app/(app)/settings/users/[id]/scopes-actions.ts
@src/app/(app)/settings/users/[id]/scopes-internal.ts
@src/app/(app)/settings/business-events/actions.ts
@src/app/(app)/settings/business-events/event-form.tsx
@src/app/(app)/locations/[id]/page.tsx
@src/app/(app)/settings/page.tsx
@src/components/table/merge-dialog.tsx
@src/lib/casl/types.ts
@src/lib/casl/subjects.ts
@src/lib/casl/fields.ts
@src/lib/casl/seed.ts
@src/lib/casl/lockout-guard.ts
@src/lib/audit.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build the server-action surface (actions.ts + editor-internal.ts) — list/get/create/update/delete/clone with transactional DELETE+INSERT, lockout-guard, audit-log</name>
  <files>
    src/app/(app)/settings/roles/actions.ts,
    src/app/(app)/settings/roles/editor-internal.ts
  </files>
  <read_first>
    - src/app/(app)/settings/users/[id]/scopes-actions.ts (canonical "use server" wrapper donor — full file)
    - src/app/(app)/settings/users/[id]/scopes-internal.ts (canonical helper file with comment block at lines 1-19 — load-bearing donor; ENTIRE FILE)
    - src/app/(app)/settings/business-events/actions.ts (CRUD + audit + result-envelope donor)
    - src/lib/audit.ts (writeAuditLog signature)
    - src/lib/casl/lockout-guard.ts (assertAtLeastOneEffectiveAdmin + LOCKOUT_PREVENTION)
    - src/lib/casl/types.ts (RawRule, Subject, Action, ACTIONS, SUBJECTS)
    - src/lib/casl/subjects.ts (assertValidAction, assertValidSubject, KNOWN_SUBJECTS)
    - src/lib/casl/seed.ts (DEFAULT_ROLE_RULES — clone uses these for the system role copy)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §D2 + §D4 + §\"Two-file server-action split (mandatory)\"
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q5 (verbatim audit metadata shapes for role.create / role.permissions.replace / role.delete) + §Q6 (lockout-guard SQL inside transaction)
  </read_first>
  <behavior>
    Plan 10-01 RED tests this satisfies (must turn GREEN):
    - `tests/db/lockout-guard.integration.test.ts` — already GREEN from Plan 10-03; this plan reuses the helper.
    - The full Playwright role-editor + edit-tier specs need server actions to exist; this task provides them.

    Behaviour contract — every action returns a discriminated-union result envelope:

    | Action | Success shape | Error shapes |
    |---|---|---|
    | `listRoles()` | `{ roles: RoleListItem[] }` | `{ error }` |
    | `getRole(id)` | `{ role: RoleDetail }` | `{ error }` (404 → "Not found") |
    | `createRole(input)` | `{ success: true, id }` | `{ error }` |
    | `replaceRolePermissions(roleId, rules)` | `{ success: true, impactedUserCount }` | `{ error }` OR `{ status: "lockout_prevention" }` |
    | `deleteRole(roleId)` | `{ success: true }` | `{ error }` OR `{ status: "lockout_prevention" }` |
    | `cloneRole(srcRoleId, newName, newDisplayName)` | `{ success: true, id }` | `{ error }` |

    Hard rules:
    - System roles (kind='system') are immutable: `replaceRolePermissions` and `deleteRole` reject with `{ error: "System roles are immutable." }` BEFORE any DB write.
    - Every mutation runs inside `db.transaction(async (tx) => {...})`. Lock-out guard runs INSIDE the transaction, BEFORE writeAuditLog (so the audit log doesn't record a failed save).
    - Mutations that touch role.kind='tier' or 'custom' MUST refresh `user.role` text mirror for every user assigned to the role IF the rule change could affect their primary tier. **Decision:** for `replaceRolePermissions`, do NOT refresh mirrors — replacing rules on an existing role doesn't change user_roles assignments, so user.role text is unaffected. For `deleteRole`, the cascade DELETE drops user_roles rows; iterate impacted users and call refreshUserRoleMirror(userId, tx) per user inside the same tx. Document in the SUMMARY.
  </behavior>
  <action>
    **editor-internal.ts** — author this file FIRST (per PATTERNS §\"Two-file server-action split (mandatory)\"; the comment block at the top is load-bearing):

    Header verbatim port from `scopes-internal.ts:1-19`, swap "userScopes" for "rolePermissions":

    ```ts
    /**
     * Internal helpers + types for role + role_permission CRUD.
     *
     * This file deliberately does NOT carry the "use server" directive — splitting
     * it from `actions.ts` is mandatory:
     *
     *   1. A file with "use server" can only export async functions. Type-only
     *      re-exports (RoleListItem, RoleDetail, RawRule, Actor) confuse the
     *      Turbopack server-action bundler; the emitted module references the
     *      type at runtime and crashes with `ReferenceError: ... is not defined`
     *      on the first POST.
     *
     *   2. Exporting the `_*ForActor` helpers from a "use server" file would
     *      register them as network-callable server-action RPC endpoints —
     *      bypassing the `requireRole('admin')` gate that the public wrappers
     *      enforce. Keeping them here ensures only the public wrappers in
     *      `actions.ts` are reachable from the network.
     */

    import { db as defaultDb } from "@/db";
    import { roles, rolePermissions, userRoles, user } from "@/db/schema";
    import { writeAuditLog } from "@/lib/audit";
    import { assertAtLeastOneEffectiveAdmin, LOCKOUT_PREVENTION } from "@/lib/casl/lockout-guard";
    import { refreshUserRoleMirror } from "@/lib/casl/role-mirror";
    import { assertValidAction, assertValidSubject } from "@/lib/casl/subjects";
    import type { RawRule } from "@/lib/casl/types";
    import { eq, sql, inArray } from "drizzle-orm";
    import { randomUUID } from "node:crypto";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type AnyDb = any;

    export type Actor = {
      id: string;
      name: string;
      role: "admin" | "member" | "viewer" | string;
    };

    export type RoleListItem = {
      id: string;
      name: string;
      kind: "system" | "tier" | "custom";
      displayName: string;
      description: string | null;
      assignedUserCount: number;
    };

    export type RoleDetail = {
      id: string;
      name: string;
      kind: "system" | "tier" | "custom";
      displayName: string;
      description: string | null;
      rules: RawRule[];
    };

    function assertNotSystem(role: { kind: string }, op: string): void {
      if (role.kind === "system") {
        throw new Error(`System roles are immutable. Cannot ${op} a system role.`);
      }
    }

    function validateRules(rules: RawRule[]): void {
      for (const r of rules) {
        assertValidAction(r.action);
        assertValidSubject(r.subject);
        if (r.fields !== null && r.fields !== undefined && !Array.isArray(r.fields)) {
          throw new Error(`Invalid rule.fields shape: must be string[] or null`);
        }
      }
    }

    // ── _listRolesForActor ───────────────────────────────────────────────
    export async function _listRolesForActor(db: AnyDb, actor: Actor): Promise<RoleListItem[]> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      const rows = await db.execute(sql`
        SELECT r.id, r.name, r.kind, r.display_name, r.description,
               COUNT(DISTINCT ur.user_id)::int AS assigned_user_count
        FROM roles r
        LEFT JOIN user_roles ur ON ur.role_id = r.id
        GROUP BY r.id, r.name, r.kind, r.display_name, r.description
        ORDER BY (r.kind = 'system') DESC, (r.kind = 'tier') DESC, r.name ASC
      `);
      const data = (rows as { rows?: unknown[] }).rows ?? (rows as unknown[]);
      return (data as Array<{ id: string; name: string; kind: string; display_name: string; description: string | null; assigned_user_count: number }>).map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as "system" | "tier" | "custom",
        displayName: r.display_name,
        description: r.description,
        assignedUserCount: r.assigned_user_count,
      }));
    }

    // ── _getRoleForActor ─────────────────────────────────────────────────
    export async function _getRoleForActor(db: AnyDb, actor: Actor, roleId: string): Promise<RoleDetail | null> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!role) return null;
      const ruleRows = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const rules: RawRule[] = ruleRows.map((r: { action: string; subject: string; fields: unknown; conditions: unknown; inverted: boolean }) => ({
        action: r.action,
        subject: r.subject,
        fields: (r.fields as string[] | null) ?? null,
        conditions: (r.conditions as Record<string, unknown> | null) ?? null,
        inverted: r.inverted,
      }));
      return {
        id: role.id,
        name: role.name,
        kind: role.kind as "system" | "tier" | "custom",
        displayName: role.displayName,
        description: role.description ?? null,
        rules,
      };
    }

    // ── _createRoleForActor ──────────────────────────────────────────────
    export async function _createRoleForActor(
      db: AnyDb,
      actor: Actor,
      input: { name: string; displayName: string; description?: string; rules: RawRule[] },
    ): Promise<{ id: string }> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      validateRules(input.rules);

      return await db.transaction(async (tx: AnyDb) => {
        const [created] = await tx.insert(roles).values({
          name: input.name,
          kind: "custom" as const,
          displayName: input.displayName,
          description: input.description ?? null,
        }).returning({ id: roles.id });

        if (input.rules.length > 0) {
          await tx.insert(rolePermissions).values(
            input.rules.map((r) => ({
              roleId: created.id,
              action: r.action,
              subject: r.subject,
              fields: r.fields ?? null,
              conditions: r.conditions ?? null,
              inverted: r.inverted ?? false,
            })),
          );
        }

        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "role",
            entityId: created.id,
            entityName: input.displayName,
            action: "create",
            metadata: {
              kind: "role.create",
              roleName: input.name,
              roleDisplayName: input.displayName,
              initialRules: input.rules,
            },
          },
          tx,
        );

        return { id: created.id };
      });
    }

    // ── _replaceRolePermissionsForActor ──────────────────────────────────
    export async function _replaceRolePermissionsForActor(
      db: AnyDb,
      actor: Actor,
      roleId: string,
      newRules: RawRule[],
    ): Promise<{ impactedUserCount: number }> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      validateRules(newRules);

      const [target] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!target) throw new Error("Role not found");
      assertNotSystem(target, "edit permissions on");

      return await db.transaction(async (tx: AnyDb) => {
        const beforeRows = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        const before: RawRule[] = beforeRows.map((r: { action: string; subject: string; fields: unknown; conditions: unknown; inverted: boolean }) => ({
          action: r.action,
          subject: r.subject,
          fields: (r.fields as string[] | null) ?? null,
          conditions: (r.conditions as Record<string, unknown> | null) ?? null,
          inverted: r.inverted,
        }));

        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (newRules.length > 0) {
          await tx.insert(rolePermissions).values(
            newRules.map((r) => ({
              roleId,
              action: r.action,
              subject: r.subject,
              fields: r.fields ?? null,
              conditions: r.conditions ?? null,
              inverted: r.inverted ?? false,
            })),
          );
        }

        // Lockout-guard runs INSIDE the tx, AFTER the DELETE+INSERT, BEFORE
        // commit. If admin-coverage drops to zero, the throw rolls back the
        // whole transaction.
        await assertAtLeastOneEffectiveAdmin(tx);

        const [{ count }] = await tx.execute(sql`
          SELECT COUNT(DISTINCT user_id)::int AS count
          FROM user_roles
          WHERE role_id = ${roleId}
        `).then((r: { rows?: unknown[] }) => (r.rows as Array<{ count: number }>) ?? (r as unknown as Array<{ count: number }>));

        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "role",
            entityId: roleId,
            entityName: target.displayName,
            action: "permissions_replace",
            metadata: {
              kind: "role.permissions.replace",
              roleId,
              roleName: target.name,
              before,
              after: newRules,
              impactedUserCount: count,
            },
          },
          tx,
        );

        return { impactedUserCount: count };
      });
    }

    // ── _deleteRoleForActor ──────────────────────────────────────────────
    export async function _deleteRoleForActor(
      db: AnyDb,
      actor: Actor,
      roleId: string,
    ): Promise<void> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      const [target] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!target) throw new Error("Role not found");
      assertNotSystem(target, "delete");

      await db.transaction(async (tx: AnyDb) => {
        // Capture impacted users BEFORE the cascade.
        const impactedRows = await tx.select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, roleId));
        const impactedUserIds = impactedRows.map((r: { userId: string }) => r.userId);

        // Cascade DELETE drops user_roles + role_permissions for this role.
        await tx.delete(roles).where(eq(roles.id, roleId));

        // Lockout-guard AFTER cascade.
        await assertAtLeastOneEffectiveAdmin(tx);

        // Refresh user.role text mirror for every impacted user (their primary
        // tier may have changed if the deleted role was their primary).
        for (const userId of impactedUserIds) {
          await refreshUserRoleMirror(userId, tx);
        }

        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "role",
            entityId: roleId,
            entityName: target.displayName,
            action: "delete",
            metadata: {
              kind: "role.delete",
              roleName: target.name,
              impactedUserIds,
            },
          },
          tx,
        );
      });
    }

    // ── _cloneRoleForActor ────────────────────────────────────────────────
    export async function _cloneRoleForActor(
      db: AnyDb,
      actor: Actor,
      srcRoleId: string,
      newName: string,
      newDisplayName: string,
    ): Promise<{ id: string }> {
      const src = await _getRoleForActor(db, actor, srcRoleId);
      if (!src) throw new Error("Source role not found");
      // Cloned roles are always 'custom' regardless of source kind.
      return await _createRoleForActor(db, actor, {
        name: newName,
        displayName: newDisplayName,
        description: `Cloned from ${src.displayName}`,
        rules: src.rules,
      });
    }
    ```

    **actions.ts** — public wrappers (`"use server"` + thin requireRole gate + delegate to internal):

    Verbatim port of `scopes-actions.ts` shape:

    ```ts
    "use server";

    import { db } from "@/db";
    import { requireRole } from "@/lib/rbac";
    import {
      _listRolesForActor, _getRoleForActor, _createRoleForActor,
      _replaceRolePermissionsForActor, _deleteRoleForActor, _cloneRoleForActor,
      type Actor, type RoleListItem, type RoleDetail,
    } from "./editor-internal";
    import type { RawRule } from "@/lib/casl/types";
    import { LOCKOUT_PREVENTION } from "@/lib/casl/lockout-guard";

    async function getActorFromSession(): Promise<Actor> {
      const session = await requireRole("admin");
      return {
        id: session.user.id,
        name: session.user.name ?? "",
        role: (session.user.role as Actor["role"]) ?? "member",
      };
    }

    export async function listRoles(): Promise<{ roles: RoleListItem[] } | { error: string }> {
      try {
        const actor = await getActorFromSession();
        const rows = await _listRolesForActor(db, actor);
        return { roles: rows };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to list roles" };
      }
    }

    export async function getRole(roleId: string): Promise<{ role: RoleDetail } | { error: string }> {
      try {
        const actor = await getActorFromSession();
        const role = await _getRoleForActor(db, actor, roleId);
        if (!role) return { error: "Role not found" };
        return { role };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to fetch role" };
      }
    }

    export async function createRole(
      input: { name: string; displayName: string; description?: string; rules: RawRule[] },
    ): Promise<{ success: true; id: string } | { error: string }> {
      try {
        const actor = await getActorFromSession();
        const { id } = await _createRoleForActor(db, actor, input);
        return { success: true, id };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to create role" };
      }
    }

    export async function replaceRolePermissions(
      roleId: string,
      rules: RawRule[],
    ): Promise<{ success: true; impactedUserCount: number } | { error: string } | { status: "lockout_prevention" }> {
      try {
        const actor = await getActorFromSession();
        const { impactedUserCount } = await _replaceRolePermissionsForActor(db, actor, roleId, rules);
        return { success: true, impactedUserCount };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save permissions";
        if (msg === LOCKOUT_PREVENTION) return { status: "lockout_prevention" };
        return { error: msg };
      }
    }

    export async function deleteRole(
      roleId: string,
    ): Promise<{ success: true } | { error: string } | { status: "lockout_prevention" }> {
      try {
        const actor = await getActorFromSession();
        await _deleteRoleForActor(db, actor, roleId);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete role";
        if (msg === LOCKOUT_PREVENTION) return { status: "lockout_prevention" };
        return { error: msg };
      }
    }

    export async function cloneRole(
      srcRoleId: string,
      newName: string,
      newDisplayName: string,
    ): Promise<{ success: true; id: string } | { error: string }> {
      try {
        const actor = await getActorFromSession();
        const { id } = await _cloneRoleForActor(db, actor, srcRoleId, newName, newDisplayName);
        return { success: true, id };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to clone role" };
      }
    }
    ```
  </action>
  <acceptance_criteria>
    - Both files exist; `actions.ts` has `"use server"` directive at top; `editor-internal.ts` does NOT
    - editor-internal.ts has the ENTIRE comment block from scopes-internal.ts:1-19 (verbatim, with userScopes→rolePermissions swap)
    - 6 helper functions in editor-internal.ts: `_listRolesForActor`, `_getRoleForActor`, `_createRoleForActor`, `_replaceRolePermissionsForActor`, `_deleteRoleForActor`, `_cloneRoleForActor`
    - 6 wrappers in actions.ts: `listRoles`, `getRole`, `createRole`, `replaceRolePermissions`, `deleteRole`, `cloneRole`
    - `assertAtLeastOneEffectiveAdmin` called inside the tx in `_replaceRolePermissionsForActor` AND `_deleteRoleForActor`
    - `writeAuditLog` called inside the tx in every mutation helper
    - `assertNotSystem` early-throw in replaceRolePermissions and deleteRole
    - `validateRules` throws on invalid action/subject literals (assertValidAction / assertValidSubject)
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `tests/db/lockout-guard.integration.test.ts` GREEN (already was; this task doesn't regress it)
  </acceptance_criteria>
  <verify>
    <automated>test -f src/app/\(app\)/settings/roles/actions.ts && test -f src/app/\(app\)/settings/roles/editor-internal.ts && head -1 src/app/\(app\)/settings/roles/actions.ts | grep -q '"use server"' && ! head -1 src/app/\(app\)/settings/roles/editor-internal.ts | grep -q '"use server"' && grep -q "deliberately does NOT carry" src/app/\(app\)/settings/roles/editor-internal.ts && [ "$(grep -c "_listRolesForActor\|_getRoleForActor\|_createRoleForActor\|_replaceRolePermissionsForActor\|_deleteRoleForActor\|_cloneRoleForActor" src/app/\(app\)/settings/roles/editor-internal.ts)" -ge 6 ] && grep -q "assertAtLeastOneEffectiveAdmin" src/app/\(app\)/settings/roles/editor-internal.ts && grep -q "writeAuditLog" src/app/\(app\)/settings/roles/editor-internal.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project integration tests/db/lockout-guard.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>actions.ts + editor-internal.ts shipped per the two-file split; transactional DELETE+INSERT with lockout-guard + audit-log; system-role immutability enforced; result-envelope discriminated unions in place. Plan 10-05 next-task can build the UI on top.</done>
</task>

<task type="auto">
  <name>Task 2: Build the RSC list page + create flow + 'use client' role-list-client.tsx</name>
  <files>
    src/app/(app)/settings/roles/page.tsx,
    src/app/(app)/settings/roles/role-list-client.tsx,
    src/app/(app)/settings/roles/new/page.tsx,
    src/app/(app)/settings/page.tsx
  </files>
  <read_first>
    - src/app/(app)/settings/users/page.tsx (RSC list donor — full file; PATTERNS §D1 marks this exact)
    - src/app/(app)/settings/users/users-page-client.tsx (client island donor — drives dialogs + calls server actions)
    - src/app/(app)/settings/page.tsx (settings hub — donor for adding the Roles tile)
    - src/app/(app)/locations/new/page.tsx (RSC create-flow wrapper)
    - src/components/layout/page-header.tsx (PageHeader component)
    - src/lib/auth/get-user-ctx.ts (use ctx.ability.can('manage', 'Role') instead of role-text)
  </read_first>
  <action>
    **page.tsx** — direct port of `settings/users/page.tsx:1-39` with userRole logic replaced by `ability.can('manage', 'Role')`:

    ```tsx
    import { getUserCtx } from "@/lib/auth/get-user-ctx";
    import { listRoles } from "./actions";
    import type { RoleListItem } from "./editor-internal";
    import { PageHeader } from "@/components/layout/page-header";
    import { RoleListClient } from "./role-list-client";

    export default async function RolesPage() {
      let canManage = false;
      try {
        const ctx = await getUserCtx();
        canManage = ctx.ability.can("manage", "Role") || ctx.ability.can("manage", "all");
      } catch {
        // layout has already validated; fall through to non-admin view
      }

      let initialRoles: RoleListItem[] = [];
      if (canManage) {
        const result = await listRoles();
        if ("roles" in result) {
          initialRoles = result.roles;
        }
      }

      return (
        <div className="flex flex-col min-h-0 flex-1">
          <PageHeader
            title="Roles"
            description="Manage RBAC roles, permissions, and tier defaults. Changes apply on the next request."
            count={initialRoles.length}
          />
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <RoleListClient initialRoles={initialRoles} canManage={canManage} />
          </div>
        </div>
      );
    }
    ```

    **role-list-client.tsx** — `"use client"` island following `users-page-client.tsx` shape:

    Renders a table (Role / Kind / Description / Assigned Users / Actions). Per row: an "Edit" link to `/settings/roles/{id}`, a "Clone" button, a "Delete" button (disabled for system roles). A top-right "Create role" button links to `/settings/roles/new`.

    Discriminated-union handling for the Delete action — handle `{ status: "lockout_prevention" }` by toasting a clear recovery message:
    > "This change would leave the system with no effective admin. Assign Admin (or a role that grants 'manage all') to at least one user before continuing."

    System-role detection: rows where `role.kind === "system"` get the Delete button visually disabled with a tooltip "System roles cannot be deleted." (Server-action also rejects, but the UI gate is for affordance clarity.)

    Use `sonner`'s `toast` for success/failure feedback (matches existing settings-tree convention).

    **new/page.tsx** — small RSC wrapper that renders an empty role-editor-client (the same client component used in `[id]/role-editor-client.tsx` from Task 3). For Task 2, the new page can render a simpler "Create role" form: name (slug), display name, description; on submit, call `createRole({ name, displayName, description, rules: [] })` and redirect to `/settings/roles/{id}` for rule editing.

    ```tsx
    // src/app/(app)/settings/roles/new/page.tsx — RSC wrapper
    import { getUserCtx } from "@/lib/auth/get-user-ctx";
    import { redirect } from "next/navigation";
    import { CreateRoleClient } from "./create-role-client";  // OR inline the form into [id] editor

    export default async function NewRolePage() {
      const ctx = await getUserCtx();
      if (!(ctx.ability.can("manage", "Role") || ctx.ability.can("manage", "all"))) {
        redirect("/settings");
      }
      return <CreateRoleClient />;
    }
    ```

    For brevity, you MAY combine the new role form into `role-list-client.tsx` as a "Create" dialog instead of a separate page — that mirrors `users-page-client.tsx` which has its create dialog inline. **Recommended**: dialog inside `role-list-client.tsx` that calls `createRole({...})` and redirects via `router.push('/settings/roles/{id}')` on success. If you go this route, `new/page.tsx` becomes a redirect-only wrapper or is dropped (drop is fine — adjust files_modified if so).

    **settings/page.tsx** — add the Roles tile to the existing settings hub. Find the existing tile pattern (one of the 5 admin tiles at lines ~65-140) and add a new tile. The tile is gated on `ability.can('manage', 'Role')`.

    Per RESEARCH Q4 audit: this stays SERVER-ONLY (RSC), no `<Can>` wrapper. The check is direct `ability.can(...)`.
  </action>
  <acceptance_criteria>
    - `src/app/(app)/settings/roles/page.tsx` exists; uses getUserCtx + ability.can('manage', 'Role') for the gate (NO `isAdmin`/`role==='admin'` checks)
    - `src/app/(app)/settings/roles/role-list-client.tsx` is `"use client"` and renders a table with rows from initialRoles + dialogs/buttons
    - `src/app/(app)/settings/roles/new/page.tsx` exists OR the Create flow is consolidated into the dialog inside role-list-client.tsx (decide and document)
    - `src/app/(app)/settings/page.tsx` gains a Roles tile linked to `/settings/roles`, gated on ability.can('manage', 'Role')
    - System roles render with Delete button disabled
    - The page handles all three result envelope shapes (`{success}`/`{error}`/`{status:"lockout_prevention"}`) with appropriate toasts
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx playwright test --list tests/access-control/role-editor.spec.ts` lists the spec cleanly
  </acceptance_criteria>
  <verify>
    <automated>test -f src/app/\(app\)/settings/roles/page.tsx && test -f src/app/\(app\)/settings/roles/role-list-client.tsx && head -1 src/app/\(app\)/settings/roles/role-list-client.tsx | grep -q '"use client"' && grep -q "ability.can" src/app/\(app\)/settings/roles/page.tsx && grep -q "lockout_prevention" src/app/\(app\)/settings/roles/role-list-client.tsx && grep -q "/settings/roles" src/app/\(app\)/settings/page.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>List page + client island + create flow + settings-hub tile shipped. Operator can navigate /settings → Roles → see all 3 seeded roles + any custom roles + click "Create role". Plan 10-01's role-editor.spec.ts list-and-heading assertions go GREEN.</done>
</task>

<task type="auto">
  <name>Task 3: Build the rule-editor RSC + client form (react-hook-form + useFieldArray) + diff-preview-modal</name>
  <files>
    src/app/(app)/settings/roles/[id]/page.tsx,
    src/app/(app)/settings/roles/[id]/role-editor-client.tsx,
    src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx
  </files>
  <read_first>
    - src/app/(app)/locations/[id]/page.tsx (RSC detail donor with await params + notFound)
    - src/app/(app)/settings/business-events/event-form.tsx (form-driven editor donor — controlled state pattern; PATTERNS §D3)
    - src/components/table/merge-dialog.tsx (Dialog with diff + confirm + result envelope handling — donor for diff-preview-modal; PATTERNS §D5)
    - src/lib/casl/types.ts (RawRule shape) + subjects.ts (KNOWN_SUBJECTS) + fields.ts (fieldsOfSubject)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §D3 ("rule-row repeater is new pattern, no exact analog") + §"No Analog Found" item 2
    - package.json (confirm react-hook-form ^7.71.2 is installed — RESEARCH §Standard Stack)
  </read_first>
  <action>
    **[id]/page.tsx** — RSC detail; loads role + delegates to client editor:

    ```tsx
    import { getUserCtx } from "@/lib/auth/get-user-ctx";
    import { getRole } from "../actions";
    import { notFound, redirect } from "next/navigation";
    import { PageHeader } from "@/components/layout/page-header";
    import { RoleEditorClient } from "./role-editor-client";

    export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
      const { id } = await params;
      const ctx = await getUserCtx();
      if (!(ctx.ability.can("manage", "Role") || ctx.ability.can("manage", "all"))) {
        redirect("/settings");
      }
      const result = await getRole(id);
      if ("error" in result) {
        if (result.error === "Role not found") notFound();
        // Render an error banner — keep PageHeader structure
        return (
          <div className="flex flex-col min-h-0 flex-1">
            <PageHeader title="Role" description={result.error} />
          </div>
        );
      }
      return (
        <div className="flex flex-col min-h-0 flex-1">
          <PageHeader title={result.role.displayName} description={`Kind: ${result.role.kind}`} />
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <RoleEditorClient role={result.role} />
          </div>
        </div>
      );
    }
    ```

    **[id]/role-editor-client.tsx** — `"use client"` form-driven editor with useFieldArray:

    Use `react-hook-form`'s `useForm` + `useFieldArray` to manage the rule rows. Per row, render:
    - Subject multi-select (autocomplete from KNOWN_SUBJECTS)
    - Action chips (chip-style toggles, ACTIONS as the universe)
    - Field picker (conditional on subject — uses fieldsOfSubject(subject) for autocomplete; null/undefined = "all fields")
    - Condition builder (key/op/value rows; minimal viable — text input for JSON OR a simple key + dropdown op + value composition; v1.1 may ship with a textarea that accepts MongoDB-syntax JSON if the structured builder is too much scope — DECIDE and document)
    - Allow/Deny toggle (inverted boolean)

    Top-right buttons: Cancel | Preview & Save. Preview opens the diff-preview-modal.

    System roles (kind='system') render with all controls disabled and a banner "System roles are immutable. Their rule set is enforced by the ability builder's short-circuit and not editable here."

    The conditions composition decision:
    - **Decision (planner picks):** v1.1 ships with a per-row textarea labelled "Conditions (JSON)" that accepts a MongoDB-style query JSON (e.g. `{"regionId": {"$in": ["uuid1"]}}`). zod-validates on submit (`z.string().refine(s => { try { return typeof JSON.parse(s) === 'object'; } catch { return false; } })`). A "Builder mode" GUI is deferred to v1.2 per CONTEXT §"Out of scope: Raw JSON rule editor" — wait, CONTEXT explicitly says NO raw JSON editor in v1.1. Re-read: §Decision 4.Q4.1 "Form-driven GUI ✓; No raw JSON editor in v1.1." So conditions MUST be a structured builder. **Compromise:** v1.1 ships with structured builder for the COMMON case (key + `=` op + value, multi-value via chips for `$in`); for the rare `$or`/`$nor`/`$not` case, render a "Switch to JSON" link that opens a per-rule textarea — this textarea's existence is documented as a known v1.1 escape hatch, not the primary surface. Implement structured builder for keys derived from `fieldsOfSubject(subject)` joined with the scope-dimension fields (regionId, hotelGroupId, locationId, productId).

    Submit flow:
    1. zod-validates the form (every rule has a non-empty subject + action; conditions JSON parses).
    2. Compares against the original role.rules → computes added/removed/changed rules.
    3. Opens the diff-preview-modal with the diff payload.
    4. Modal calls `replaceRolePermissions(roleId, newRules)` on confirm.

    **[id]/diff-preview-modal.tsx** — `"use client"` modal following merge-dialog.tsx shape (PATTERNS §D5):

    ```tsx
    "use client";
    import * as React from "react";
    import { Loader2 } from "lucide-react";
    import { toast } from "sonner";
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { Button } from "@/components/ui/button";
    import { replaceRolePermissions } from "../actions";
    import type { RawRule } from "@/lib/casl/types";

    type Diff = { added: RawRule[]; removed: RawRule[]; changed: { before: RawRule; after: RawRule }[] };

    export function DiffPreviewModal({
      open, onOpenChange, roleId, diff, newRules, onSuccess,
    }: {
      open: boolean;
      onOpenChange: (b: boolean) => void;
      roleId: string;
      diff: Diff;
      newRules: RawRule[];
      onSuccess: () => void;
    }) {
      const [isSubmitting, setIsSubmitting] = React.useState(false);

      async function handleConfirm() {
        setIsSubmitting(true);
        try {
          const result = await replaceRolePermissions(roleId, newRules);
          if ("status" in result && result.status === "lockout_prevention") {
            toast.error(
              "This change would leave the system with no effective admin. " +
              "Assign Admin (or a role that grants 'manage all') to at least one user before continuing."
            );
            return;
          }
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`Saved. ${result.impactedUserCount} user(s) impacted.`);
          onSuccess();
          onOpenChange(false);
        } finally {
          setIsSubmitting(false);
        }
      }

      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confirm rule changes</DialogTitle>
              <DialogDescription>
                {diff.added.length} added, {diff.removed.length} removed, {diff.changed.length} changed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Render added/removed/changed sections — list each rule's action+subject */}
              {/* impacted-users count is fetched on-demand or already present in diff payload */}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    ```

    The impacted-users count is computed server-side as part of `replaceRolePermissions` return — but per CONTEXT decision the modal must surface it BEFORE confirm. Two options:
    1. Fetch the count on modal open via a separate server action `getRoleImpactedUserCount(roleId)` (one extra RPC).
    2. Compute it client-side from the role detail (we already loaded it on page load).

    Pick (2) — the role detail's `assignedUserCount` is already loaded by `_listRolesForActor` and passed to the editor (extend `getRole` to include it if not already). Plumb through.
  </action>
  <acceptance_criteria>
    - `src/app/(app)/settings/roles/[id]/page.tsx` exists; uses getUserCtx + ability check; awaits params (Next 15 / React 19 idiom)
    - `src/app/(app)/settings/roles/[id]/role-editor-client.tsx` is "use client", uses react-hook-form + useFieldArray for rule rows
    - System roles render the editor disabled
    - Subject multi-select uses KNOWN_SUBJECTS; field picker uses fieldsOfSubject
    - Conditions builder is structured (NOT a free-form JSON textarea as primary surface) per CONTEXT §4.Q4.1
    - `src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx` is "use client", handles result envelope (success / error / lockout_prevention), uses toast.error/success
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx playwright test --list tests/access-control/role-editor.spec.ts tests/access-control/edit-tier.spec.ts` lists cleanly
  </acceptance_criteria>
  <verify>
    <automated>test -f src/app/\(app\)/settings/roles/\[id\]/page.tsx && test -f src/app/\(app\)/settings/roles/\[id\]/role-editor-client.tsx && test -f src/app/\(app\)/settings/roles/\[id\]/diff-preview-modal.tsx && head -1 src/app/\(app\)/settings/roles/\[id\]/role-editor-client.tsx | grep -q '"use client"' && head -1 src/app/\(app\)/settings/roles/\[id\]/diff-preview-modal.tsx | grep -q '"use client"' && grep -q "useFieldArray" src/app/\(app\)/settings/roles/\[id\]/role-editor-client.tsx && grep -q "lockout_prevention" src/app/\(app\)/settings/roles/\[id\]/diff-preview-modal.tsx && grep -q "KNOWN_SUBJECTS\|SUBJECTS" src/app/\(app\)/settings/roles/\[id\]/role-editor-client.tsx && grep -q "fieldsOfSubject" src/app/\(app\)/settings/roles/\[id\]/role-editor-client.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>Detail page + form-driven rule editor + diff-preview modal shipped. The full /settings/roles → drill-in → edit → confirm → save flow works against local dev. Plan 10-08 runs the spec against the preview alias as the merge gate.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser (admin form) ↔ /settings/roles server actions | All admin authoring happens here. Bypass = unauthorised role edit. |
| `replaceRolePermissions` transaction ↔ assertAtLeastOneEffectiveAdmin | Lockout-guard runs INSIDE the tx, BEFORE commit. Skipping = production lockout. |
| System roles (kind='system') ↔ replaceRolePermissions / deleteRole | Both server actions reject before any DB write. UI affordance is informational only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-05-01 | Elevation of Privilege | Admin grants external user banking via custom role rule data | mitigate | external-invariant.ts code-level guard (Plan 10-03) appended LAST in builder. Plan 10-01 unit test enforces. UI doesn't need to refuse — the rule data is irrelevant; the invariant strips at runtime regardless. |
| T-10-05-02 | Denial of Service | Admin saves a state with zero effective admins (lockout) | mitigate | assertAtLeastOneEffectiveAdmin (Path B SQL) inside replaceRolePermissions tx + deleteRole tx. Plan 10-01 lockout-guard.integration.test.ts is the gate. UI surfaces clear recovery message. |
| T-10-05-03 | Tampering | Browser bypasses Cancel button by directly POSTing to /actions endpoint | mitigate | requireRole('admin') gate in every wrapper; the helper file's leading underscore + non-server-action directive means _<verb>ForActor is NOT network-callable. Per scopes-internal.ts:1-19 comment block. |
| T-10-05-04 | Information Disclosure | Audit log records full rule sets including conditions (UUID PII?) | accept | UUIDs are not secret; the audit log is admin-readable. Per Phase 9.1 audit pattern. |
| T-10-05-05 | Repudiation | Admin edits role permissions and removes audit log entry | mitigate | audit_logs is append-only by project convention (no UPDATE/DELETE on the table). writeAuditLog runs INSIDE the same tx as the role write — partial state impossible. |
| T-10-05-06 | Tampering | replaceRolePermissions called with non-existent action/subject literal | mitigate | validateRules (assertValidAction + assertValidSubject) throws BEFORE any DB write. Plan 10-03 ensures these literals are restricted to ACTIONS / SUBJECTS unions. |
| T-10-05-07 | Elevation of Privilege | System role (Admin) editor/deletor reaches DB write | mitigate | assertNotSystem early-throw in editor-internal helpers. UI also disables the controls. Two redundant gates. |
</threat_model>

<verification>
- `tests/db/lockout-guard.integration.test.ts` GREEN
- `tests/db/casl-ability.integration.test.ts` + `custom-role.integration.test.ts` GREEN (no regression)
- `npx tsc --noEmit -p tsconfig.json` clean
- `npx playwright test --list tests/access-control/role-editor.spec.ts tests/access-control/edit-tier.spec.ts` lists cleanly
- Manual smoke: dev server boots, /settings/roles loads, drill-in opens editor, save triggers diff modal
- Settings-hub tile gated on ability (visible to admin, hidden to viewer)
</verification>

<success_criteria>
- 9 files in `src/app/(app)/settings/roles/` tree (or 8 if new/page.tsx is consolidated into a dialog)
- Two-file `"use server"` split enforced verbatim
- Every mutation transactional + lockout-guarded + audit-logged
- System roles immutable (server-action rejection + UI disable)
- Form-driven rule editor with structured conditions builder (NO primary-surface JSON textarea)
- Diff preview + impacted-users count + lockout-prevention message in modal
- Settings hub Roles tile gated on ability
- All Plan 10-01 RED Playwright role-editor + edit-tier specs are list-clean (full GREEN gate is Plan 10-08 against preview alias)
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-05-SUMMARY.md` documenting:
- 9 files shipped (or 8 if new/page.tsx consolidated)
- The conditions-builder shape decision (structured vs JSON-fallback link)
- Whether new/page.tsx exists or was consolidated into role-list-client dialog
- Audit-log entry shapes used (kinds: role.create, role.permissions.replace, role.delete) — verify they match RESEARCH §Q5 verbatim
- Status of Plan 10-01 RED Playwright specs: list-clean (full GREEN against preview is Plan 10-08)
</output>
