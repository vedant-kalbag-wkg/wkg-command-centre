---
phase: 10
plan: 06
type: execute
wave: 4
depends_on: [03, 05]
files_modified:
  - src/app/(app)/settings/users/[id]/page.tsx
  - src/app/(app)/settings/users/[id]/role-actions.ts
  - src/app/(app)/settings/users/[id]/role-internal.ts
  - src/app/(app)/settings/users/[id]/role-assignment-client.tsx
  - src/app/(app)/settings/users/actions.ts
  - src/components/admin/manage-scopes-dialog.tsx
  - src/app/(app)/settings/users/[id]/scopes-actions.ts
  - src/app/(app)/settings/users/[id]/scopes-internal.ts
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "/settings/users/[id]/page.tsx EXISTS and loads the user + their role assignments + their per-(user, role) scopes — currently the directory has only scopes-actions.ts + scopes-internal.ts with NO page.tsx (RESEARCH Open Questions OQ-1 + PATTERNS §E1)."
    - "Admin can assign a role to a user AND bind per-(user, role, dimension) scopes to that assignment via the existing ManageScopesDialog (extended in this plan with a roleId picker — closes AUTH-07 SC4 end-to-end); revocation cascades user_scopes for that (user, role) pair via DB FK."
    - "assignRole and revokeRole run inside db.transaction; lockout-guard runs BEFORE commit on revoke; refreshUserRoleMirror(userId, tx) runs INSIDE the same tx so user.role text mirror stays in lock-step (RESEARCH Q1)."
    - "Audit-log written for every assignment change (entityType='user_role', action='assign'/'unassign', metadata kind 'user.roles.assign'/'user.roles.revoke' per RESEARCH Q5)."
    - "src/app/(app)/settings/users/actions.ts deleteUser() wraps Better Auth's removeUser AND runs assertAtLeastOneEffectiveAdmin(db, { excludingUserId: userId }) BEFORE the removeUser call — closes the lock-out coverage gap RESEARCH §Q6 flagged (PATTERNS §F1)."
    - "Two-file 'use server' split applied: role-actions.ts has 'use server'; role-internal.ts has the comment block + helper functions + actor pattern (PATTERNS §E1)."
  artifacts:
    - path: "src/app/(app)/settings/users/[id]/page.tsx"
      provides: "RSC user-detail page — loads user + their roles + their scopes; renders RoleAssignmentClient + the existing ManageScopesDialog wrapper"
    - path: "src/app/(app)/settings/users/[id]/role-actions.ts"
      provides: "'use server' wrappers: listUserRoles, assignRole, revokeRole — gated on requireRole('admin')"
    - path: "src/app/(app)/settings/users/[id]/role-internal.ts"
      provides: "_listUserRolesForActor, _assignRoleForActor, _revokeRoleForActor — testable helpers; runs refreshUserRoleMirror + assertAtLeastOneEffectiveAdmin inside tx"
    - path: "src/app/(app)/settings/users/[id]/role-assignment-client.tsx"
      provides: "'use client' — multi-role + per-(user, role) scope picker; calls listUserRoles/assignRole/revokeRole"
    - path: "src/app/(app)/settings/users/actions.ts"
      provides: "Augmented deleteUser — wraps Better Auth's removeUser with the lock-out guard (closes RESEARCH Q6 gap)"
  key_links:
    - from: "_assignRoleForActor / _revokeRoleForActor"
      to: "src/lib/casl/role-mirror.ts refreshUserRoleMirror + lockout-guard.ts assertAtLeastOneEffectiveAdmin"
      via: "Inside db.transaction; mirror refresh + lockout-guard before audit log; partial failures roll back"
      pattern: "refreshUserRoleMirror.*tx|assertAtLeastOneEffectiveAdmin"
    - from: "src/app/(app)/settings/users/actions.ts deleteUser"
      to: "src/lib/casl/lockout-guard.ts assertAtLeastOneEffectiveAdmin"
      via: "Called BEFORE auth.api.removeUser with options.excludingUserId=userId"
      pattern: "assertAtLeastOneEffectiveAdmin.*excludingUserId"
    - from: "src/app/(app)/settings/users/[id]/role-assignment-client.tsx"
      to: "ManageScopesDialog (existing) for per-(user, role, dimension) editing"
      via: "Render scopes per assignment row; clicking 'Edit scope' opens dialog scoped to (user, role) pair"
      pattern: "ManageScopesDialog|listScopes"
---

<objective>
Create the missing `src/app/(app)/settings/users/[id]/page.tsx` (RSC) plus the role-assignment server actions + client component that turn IAM-style multi-role + per-(user, role) scope binding into an operator surface (AUTH-07 SC4). Augment `src/app/(app)/settings/users/actions.ts` `deleteUser` with the lock-out guard wrapping Better Auth's `removeUser` — closes RESEARCH §Q6's identified coverage gap.

Purpose: AUTH-07 SC4 is "Admin can create / edit / clone custom roles ... and assign them per-user with per-(user, role) scope". Plan 10-05 covers the role authoring; this plan covers the assignment side. Without `[id]/page.tsx` the operator has no surface to assign roles. Without the deleteUser wrap, deleting the last admin via the existing UI would silently lock the system out (Q6 mitigation).

Output: 5 files (4 new + 1 augmented). Plan 10-01's `tests/access-control/user-role-assignment.spec.ts` goes list-clean; full GREEN against preview is Plan 10-08. `tests/db/better-auth-admin-plugin.integration.test.ts` continues to GREEN with the augmented deleteUser path.
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
@.planning/phases/10-access-control-extended/10-05-settings-roles-admin-ui-PLAN.md

# Donor patterns:
@src/app/(app)/settings/users/[id]/scopes-actions.ts
@src/app/(app)/settings/users/[id]/scopes-internal.ts
@src/app/(app)/settings/users/page.tsx
@src/app/(app)/settings/users/actions.ts
@src/components/admin/manage-scopes-dialog.tsx
@src/lib/casl/role-mirror.ts
@src/lib/casl/lockout-guard.ts
@src/lib/audit.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build role-actions.ts + role-internal.ts (two-file 'use server' split for assignRole / revokeRole / listUserRoles)</name>
  <files>
    src/app/(app)/settings/users/[id]/role-actions.ts,
    src/app/(app)/settings/users/[id]/role-internal.ts
  </files>
  <read_first>
    - src/app/(app)/settings/users/[id]/scopes-actions.ts (full file — donor)
    - src/app/(app)/settings/users/[id]/scopes-internal.ts (full file — comment block at lines 1-19 is load-bearing)
    - src/lib/casl/role-mirror.ts (refreshUserRoleMirror)
    - src/lib/casl/lockout-guard.ts (assertAtLeastOneEffectiveAdmin + LOCKOUT_PREVENTION)
    - src/lib/audit.ts (writeAuditLog signature; new entityType='user_role', action='assign'/'unassign')
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §E1 (donor pattern)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q5 (verbatim audit metadata for user.roles.assign / user.roles.revoke)
  </read_first>
  <action>
    **role-internal.ts** — leading underscore helpers, no `"use server"` directive, copy the comment block verbatim:

    ```ts
    /**
     * Internal helpers + types for user_roles + per-(user, role) scope CRUD.
     *
     * This file deliberately does NOT carry the "use server" directive — splitting
     * it from `role-actions.ts` is mandatory:
     *
     *   1. A file with "use server" can only export async functions. Type-only
     *      re-exports (UserRoleAssignment, ScopeBinding, Actor) confuse the
     *      Turbopack server-action bundler; the emitted module references the
     *      type at runtime and crashes with `ReferenceError: ... is not defined`
     *      on the first POST.
     *
     *   2. Exporting the `_*ForActor` helpers from a "use server" file would
     *      register them as network-callable server-action RPC endpoints —
     *      bypassing the `requireRole('admin')` gate that the public wrappers
     *      enforce. Keeping them here ensures only the public wrappers in
     *      `role-actions.ts` are reachable from the network.
     */

    import { db as defaultDb } from "@/db";
    import { roles, userRoles, userScopes, user } from "@/db/schema";
    import { writeAuditLog } from "@/lib/audit";
    import { refreshUserRoleMirror } from "@/lib/casl/role-mirror";
    import { assertAtLeastOneEffectiveAdmin, LOCKOUT_PREVENTION } from "@/lib/casl/lockout-guard";
    import { assertValidDimensionType, type DimensionType } from "@/lib/scoping/scoped-query";
    import { eq, and, inArray } from "drizzle-orm";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type AnyDb = any;

    export type Actor = {
      id: string;
      name: string;
      role: "admin" | "member" | "viewer" | string;
    };

    export type ScopeBinding = {
      dimensionType: DimensionType;
      dimensionId: string;
    };

    export type UserRoleAssignment = {
      userRoleId: string;
      roleId: string;
      roleName: string;
      roleDisplayName: string;
      roleKind: "system" | "tier" | "custom";
      assignedAt: Date;
      assignedBy: string | null;
      scopes: Array<{ id: string; dimensionType: string; dimensionId: string }>;
    };

    // ── _listUserRolesForActor ────────────────────────────────────────────
    export async function _listUserRolesForActor(
      db: AnyDb, actor: Actor, userId: string,
    ): Promise<UserRoleAssignment[]> {
      if (actor.role !== "admin") throw new Error("Forbidden");

      const grants = await db
        .select({
          userRoleId: userRoles.id,
          roleId: roles.id,
          roleName: roles.name,
          roleDisplayName: roles.displayName,
          roleKind: roles.kind,
          assignedAt: userRoles.assignedAt,
          assignedBy: userRoles.assignedBy,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId));

      const scopeRows = await db
        .select({
          id: userScopes.id,
          roleId: userScopes.roleId,
          dimensionType: userScopes.dimensionType,
          dimensionId: userScopes.dimensionId,
        })
        .from(userScopes)
        .where(eq(userScopes.userId, userId));

      return grants.map((g: { userRoleId: string; roleId: string; roleName: string; roleDisplayName: string; roleKind: string; assignedAt: Date; assignedBy: string | null }) => ({
        userRoleId: g.userRoleId,
        roleId: g.roleId,
        roleName: g.roleName,
        roleDisplayName: g.roleDisplayName,
        roleKind: g.roleKind as "system" | "tier" | "custom",
        assignedAt: g.assignedAt,
        assignedBy: g.assignedBy,
        scopes: scopeRows
          .filter((s: { roleId: string | null }) => s.roleId === g.roleId)
          .map((s: { id: string; dimensionType: string; dimensionId: string }) => ({
            id: s.id, dimensionType: s.dimensionType, dimensionId: s.dimensionId,
          })),
      }));
    }

    // ── _assignRoleForActor ───────────────────────────────────────────────
    export async function _assignRoleForActor(
      db: AnyDb, actor: Actor, userId: string, roleId: string, scopes: ScopeBinding[],
    ): Promise<{ userRoleId: string }> {
      if (actor.role !== "admin") throw new Error("Forbidden");
      for (const s of scopes) assertValidDimensionType(s.dimensionType);

      // Verify target user + role both exist.
      const [target] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      if (!target) throw new Error("User not found");
      const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!role) throw new Error("Role not found");

      return await db.transaction(async (tx: AnyDb) => {
        // Upsert the user_roles row (idempotent on (user_id, role_id) unique).
        const inserted = await tx.insert(userRoles).values({
          userId,
          roleId,
          assignedBy: actor.id,
        }).onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] }).returning({ id: userRoles.id });

        const userRoleId =
          inserted[0]?.id
          ?? (await tx.select({ id: userRoles.id }).from(userRoles)
                .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
                .limit(1))[0].id;

        // Insert per-(user, role, dim) scopes.
        if (scopes.length > 0) {
          await tx.insert(userScopes).values(
            scopes.map((s) => ({
              userId,
              roleId,
              dimensionType: s.dimensionType,
              dimensionId: s.dimensionId,
              createdBy: actor.id,
            })),
          ).onConflictDoNothing({
            target: [userScopes.userId, userScopes.roleId, userScopes.dimensionType, userScopes.dimensionId],
          });
        }

        // Refresh user.role text mirror in lock-step with user_roles write
        // (RESEARCH Q1). Better Auth admin plugin reads user.role text.
        await refreshUserRoleMirror(userId, tx);

        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "user_role",
            entityId: userRoleId,
            entityName: `${target.name ?? target.email} → ${role.displayName}`,
            action: "assign",
            metadata: {
              kind: "user.roles.assign",
              userId,
              roleId,
              roleName: role.name,
              scopes,
            },
          },
          tx,
        );

        return { userRoleId };
      });
    }

    // ── _revokeRoleForActor ───────────────────────────────────────────────
    export async function _revokeRoleForActor(
      db: AnyDb, actor: Actor, userRoleId: string,
    ): Promise<void> {
      if (actor.role !== "admin") throw new Error("Forbidden");

      const [target] = await db
        .select({
          userRoleId: userRoles.id,
          userId: userRoles.userId,
          roleId: roles.id,
          roleName: roles.name,
          roleDisplayName: roles.displayName,
          targetUserName: user.name,
          targetUserEmail: user.email,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(user, eq(user.id, userRoles.userId))
        .where(eq(userRoles.id, userRoleId))
        .limit(1);

      if (!target) throw new Error("User-role assignment not found");

      await db.transaction(async (tx: AnyDb) => {
        // Capture scope rows BEFORE delete (cascade drops them via FK).
        const scopesAtRevoke = await tx
          .select({ id: userScopes.id, dimensionType: userScopes.dimensionType, dimensionId: userScopes.dimensionId })
          .from(userScopes)
          .where(and(eq(userScopes.userId, target.userId), eq(userScopes.roleId, target.roleId)));

        // Delete the user_roles row — cascade drops user_scopes via FK on
        // (user_id, role_id) per Plan 10-02 schema (FK is on roleId only,
        // so we explicitly delete scopes for safety).
        await tx.delete(userScopes).where(and(eq(userScopes.userId, target.userId), eq(userScopes.roleId, target.roleId)));
        await tx.delete(userRoles).where(eq(userRoles.id, userRoleId));

        // Lockout-guard AFTER delete, BEFORE commit.
        await assertAtLeastOneEffectiveAdmin(tx);

        // Refresh mirror (lockout-guard pass means coverage holds; mirror
        // change is safe).
        await refreshUserRoleMirror(target.userId, tx);

        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "user_role",
            entityId: userRoleId,
            entityName: `${target.targetUserName ?? target.targetUserEmail} → ${target.roleDisplayName}`,
            action: "unassign",
            metadata: {
              kind: "user.roles.revoke",
              userId: target.userId,
              roleId: target.roleId,
              roleName: target.roleName,
              scopesAtRevoke,
            },
          },
          tx,
        );
      });
    }
    ```

    **role-actions.ts** — public wrappers per scopes-actions.ts shape:

    ```ts
    "use server";

    import { db } from "@/db";
    import { requireRole } from "@/lib/rbac";
    import {
      _listUserRolesForActor, _assignRoleForActor, _revokeRoleForActor,
      type Actor, type ScopeBinding, type UserRoleAssignment,
    } from "./role-internal";
    import { LOCKOUT_PREVENTION } from "@/lib/casl/lockout-guard";

    async function getActorFromSession(): Promise<Actor> {
      const session = await requireRole("admin");
      return {
        id: session.user.id,
        name: session.user.name ?? "",
        role: (session.user.role as Actor["role"]) ?? "member",
      };
    }

    export async function listUserRoles(userId: string): Promise<UserRoleAssignment[]> {
      const actor = await getActorFromSession();
      return _listUserRolesForActor(db, actor, userId);
    }

    export async function assignRole(
      userId: string, roleId: string, scopes: ScopeBinding[],
    ): Promise<{ success: true; userRoleId: string } | { error: string }> {
      try {
        const actor = await getActorFromSession();
        const { userRoleId } = await _assignRoleForActor(db, actor, userId, roleId, scopes);
        return { success: true, userRoleId };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to assign role" };
      }
    }

    export async function revokeRole(
      userRoleId: string,
    ): Promise<{ success: true } | { error: string } | { status: "lockout_prevention" }> {
      try {
        const actor = await getActorFromSession();
        await _revokeRoleForActor(db, actor, userRoleId);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to revoke role";
        if (msg === LOCKOUT_PREVENTION) return { status: "lockout_prevention" };
        return { error: msg };
      }
    }
    ```
  </action>
  <acceptance_criteria>
    - Both files exist; role-actions.ts has `"use server"`; role-internal.ts has comment block + NO directive
    - 3 helpers in role-internal.ts: `_listUserRolesForActor`, `_assignRoleForActor`, `_revokeRoleForActor`
    - 3 wrappers in role-actions.ts: `listUserRoles`, `assignRole`, `revokeRole`
    - `refreshUserRoleMirror(userId, tx)` called inside both `_assignRoleForActor` AND `_revokeRoleForActor` transactions
    - `assertAtLeastOneEffectiveAdmin(tx)` called inside `_revokeRoleForActor` transaction (NOT in assignRole — assigning never reduces coverage)
    - `writeAuditLog` called inside both tx with entityType='user_role'
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `tests/db/better-auth-admin-plugin.integration.test.ts` GREEN — exercises both paths AND verifies user.role mirror lock-step
  </acceptance_criteria>
  <verify>
    <automated>test -f src/app/\(app\)/settings/users/\[id\]/role-actions.ts && test -f src/app/\(app\)/settings/users/\[id\]/role-internal.ts && head -1 src/app/\(app\)/settings/users/\[id\]/role-actions.ts | grep -q '"use server"' && ! head -1 src/app/\(app\)/settings/users/\[id\]/role-internal.ts | grep -q '"use server"' && grep -q "deliberately does NOT carry" src/app/\(app\)/settings/users/\[id\]/role-internal.ts && grep -c "_listUserRolesForActor\|_assignRoleForActor\|_revokeRoleForActor" src/app/\(app\)/settings/users/\[id\]/role-internal.ts | grep -qE "^[3-9]" && grep -q "refreshUserRoleMirror.*tx" src/app/\(app\)/settings/users/\[id\]/role-internal.ts && grep -q "assertAtLeastOneEffectiveAdmin" src/app/\(app\)/settings/users/\[id\]/role-internal.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project integration tests/db/better-auth-admin-plugin.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>role-actions.ts + role-internal.ts shipped with two-file split, transactional writes, mirror refresh, lockout-guard, audit-log. Plan 10-01's better-auth-admin-plugin integration test continues GREEN with the new mirror-in-tx coverage.</done>
</task>

<task type="auto">
  <name>Task 2: Create [id]/page.tsx (RSC) + role-assignment-client.tsx ('use client')</name>
  <files>
    src/app/(app)/settings/users/[id]/page.tsx,
    src/app/(app)/settings/users/[id]/role-assignment-client.tsx
  </files>
  <read_first>
    - src/app/(app)/settings/users/page.tsx (RSC list pattern donor)
    - src/components/admin/manage-scopes-dialog.tsx (refresh-on-open + per-row removingId pattern donor; PATTERNS §E2)
    - src/app/(app)/locations/[id]/page.tsx (await params + notFound idiom)
    - src/lib/auth/get-user-ctx.ts (use ctx.ability for the gate)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §E2 + §"Critical Reversals" item 2 (this directory currently has no page.tsx)
  </read_first>
  <action>
    **page.tsx** — RSC; loads target user, their role assignments, and the available roles (for the assignment-picker dropdown):

    ```tsx
    import { getUserCtx } from "@/lib/auth/get-user-ctx";
    import { redirect, notFound } from "next/navigation";
    import { db } from "@/db";
    import { user } from "@/db/schema";
    import { eq } from "drizzle-orm";
    import { listRoles } from "@/app/(app)/settings/roles/actions";
    import { listUserRoles } from "./role-actions";
    import { listScopes } from "./scopes-actions";  // existing
    import { PageHeader } from "@/components/layout/page-header";
    import { RoleAssignmentClient } from "./role-assignment-client";

    export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
      const { id } = await params;
      const ctx = await getUserCtx();
      if (!(ctx.ability.can("manage", "User") || ctx.ability.can("manage", "all"))) {
        redirect("/settings");
      }

      const [target] = await db.select().from(user).where(eq(user.id, id)).limit(1);
      if (!target) notFound();

      const [assignmentsResult, rolesResult, scopesResult] = await Promise.all([
        listUserRoles(id).catch(() => []),
        listRoles().catch(() => ({ error: "Failed to load roles" })),
        listScopes(id).catch(() => []),
      ]);

      const allRoles = "roles" in rolesResult ? rolesResult.roles : [];

      return (
        <div className="flex flex-col min-h-0 flex-1">
          <PageHeader
            title={target.name ?? target.email ?? "User"}
            description={target.email ?? "User details"}
          />
          <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
            <RoleAssignmentClient
              userId={id}
              initialAssignments={assignmentsResult}
              allRoles={allRoles}
              initialScopes={scopesResult}
            />
          </div>
        </div>
      );
    }
    ```

    **role-assignment-client.tsx** — `"use client"` island per PATTERNS §E2 (manage-scopes-dialog donor):

    ```tsx
    "use client";
    import * as React from "react";
    import { toast } from "sonner";
    import { Loader2, X } from "lucide-react";
    import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
    import { Button } from "@/components/ui/button";
    import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
    import { listUserRoles, assignRole, revokeRole } from "./role-actions";
    import type { UserRoleAssignment } from "./role-internal";
    import type { RoleListItem } from "@/app/(app)/settings/roles/editor-internal";

    export function RoleAssignmentClient({
      userId, initialAssignments, allRoles, initialScopes,
    }: {
      userId: string;
      initialAssignments: UserRoleAssignment[];
      allRoles: RoleListItem[];
      initialScopes: unknown[];
    }) {
      const [assignments, setAssignments] = React.useState(initialAssignments);
      const [isLoading, setIsLoading] = React.useState(false);
      const [removingId, setRemovingId] = React.useState<string | null>(null);
      const [picker, setPicker] = React.useState<string>("");
      const [isAssigning, setIsAssigning] = React.useState(false);

      const refresh = React.useCallback(async () => {
        setIsLoading(true);
        try {
          const next = await listUserRoles(userId);
          setAssignments(next);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to load assignments");
        } finally {
          setIsLoading(false);
        }
      }, [userId]);

      async function handleAssign() {
        if (!picker) return;
        setIsAssigning(true);
        try {
          // v1.1: assign without scopes initially; operator edits scopes via
          // existing ManageScopesDialog flow (per-(user, role)) afterwards.
          const result = await assignRole(userId, picker, []);
          if ("error" in result) { toast.error(result.error); return; }
          toast.success("Role assigned");
          setPicker("");
          await refresh();
        } finally {
          setIsAssigning(false);
        }
      }

      async function handleRevoke(userRoleId: string, roleKind: string, roleDisplayName: string) {
        if (!confirm(`Revoke "${roleDisplayName}"?`)) return;
        setRemovingId(userRoleId);
        try {
          const result = await revokeRole(userRoleId);
          if ("status" in result && result.status === "lockout_prevention") {
            toast.error(
              "This change would leave the system with no effective admin. " +
              "Assign Admin (or a role that grants 'manage all') to at least one user before continuing."
            );
            return;
          }
          if ("error" in result) { toast.error(result.error); return; }
          toast.success("Role revoked");
          await refresh();
        } finally {
          setRemovingId(null);
        }
      }

      const assignedRoleIds = new Set(assignments.map((a) => a.roleId));
      const availableRoles = allRoles.filter((r) => !assignedRoleIds.has(r.id));

      return (
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {assignments.length === 0 && (
                <p className="text-sm text-muted-foreground">No roles assigned. Pick a role below.</p>
              )}
              {assignments.map((a) => (
                <div key={a.userRoleId} className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <div className="font-medium">{a.roleDisplayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.roleKind} · {a.scopes.length} scope(s) · assigned {new Date(a.assignedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingId === a.userRoleId}
                    onClick={() => handleRevoke(a.userRoleId, a.roleKind, a.roleDisplayName)}
                  >
                    {removingId === a.userRoleId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t">
              <Select value={picker} onValueChange={setPicker}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Pick a role to assign…" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.displayName} ({r.kind})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAssign} disabled={!picker || isAssigning}>
                {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              To bind scopes (regions, hotel groups, etc.) to a role assignment, use the existing Scopes
              dialog below. Per-(user, role) scope binding is captured by the assignment audit log.
            </div>
          </CardContent>
        </Card>
      );
    }
    ```

    This task ships RoleAssignmentClient with ASSIGN/REVOKE only. The per-(user, role) scope binding UI extension to `<ManageScopesDialog>` is **Task 4 of this plan** (added in revision iter 1 to deliver AUTH-07 SC4 end-to-end inside this phase, no v1.2 carry). RoleAssignmentClient renders the scope count + an "Edit scopes" affordance on each assignment row; the affordance opens the (extended) ManageScopesDialog scoped to (user, role).
  </action>
  <acceptance_criteria>
    - Both files exist
    - `[id]/page.tsx` is RSC, awaits params, gates on `ability.can('manage', 'User')`, calls `listUserRoles` + `listScopes` + `listRoles` in parallel
    - `role-assignment-client.tsx` is `"use client"`, imports `assignRole`/`revokeRole`/`listUserRoles`
    - Revoke button handles `{ status: "lockout_prevention" }` with the canonical recovery message
    - Available-role filter excludes already-assigned roles (no double-assignment)
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `npx playwright test --list tests/access-control/user-role-assignment.spec.ts` lists cleanly
    - Manual smoke: dev server, navigate `/settings/users/{some-id}`, see role assignment block, assign Ops-IT to a non-admin, revoke succeeds, last-admin revoke fails with lockout message
  </acceptance_criteria>
  <verify>
    <automated>test -f src/app/\(app\)/settings/users/\[id\]/page.tsx && test -f src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx && head -1 src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx | grep -q '"use client"' && grep -q "ability.can" src/app/\(app\)/settings/users/\[id\]/page.tsx && grep -q "lockout_prevention" src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx && grep -q "listUserRoles\|assignRole\|revokeRole" src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$"</automated>
  </verify>
  <done>User detail page + role assignment client shipped. Operators can navigate /settings/users/{id} and manage role assignments. Last-admin revoke is gated by lockout-prevention with clear recovery message. Plan 10-01 user-role-assignment.spec.ts list-clean.</done>
</task>

<task type="auto">
  <name>Task 3: Augment src/app/(app)/settings/users/actions.ts deleteUser to wrap removeUser with assertAtLeastOneEffectiveAdmin</name>
  <files>src/app/(app)/settings/users/actions.ts</files>
  <read_first>
    - src/app/(app)/settings/users/actions.ts (full file — find existing deleteUser at lines ~226-253 per PATTERNS §F1)
    - src/lib/casl/lockout-guard.ts (assertAtLeastOneEffectiveAdmin signature with options.excludingUserId)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §F1 (the diff)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q6 lines 1004-1012 (the gap RESEARCH flagged: "auth.api.removeUser doesn't go through our wrapper. Mitigation: wrap user-deletion in a server action that wraps Better Auth's call, runs the same check, and refuses.")
  </read_first>
  <action>
    Locate `deleteUser` in `src/app/(app)/settings/users/actions.ts` (per PATTERNS §F1 it's at lines 226-253). Insert the lock-out check BEFORE the `auth.api.removeUser` call. Per PATTERNS §F1 verbatim diff:

    ```ts
    // BEFORE (existing):
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
      } catch (error) { ... }
    }

    // AFTER:
    export async function deleteUser(userId: string) {
      try {
        await requireRole("admin");
        const { db } = await import("@/db");
        const { session, account, userViews } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const { assertAtLeastOneEffectiveAdmin, LOCKOUT_PREVENTION } = await import("@/lib/casl/lockout-guard");

        // Refuse to delete if it would leave the system with zero effective
        // admins (closes RESEARCH §Q6 gap — Better Auth's removeUser bypasses
        // our role-action lock-out gate; this wrapper does NOT).
        try {
          await assertAtLeastOneEffectiveAdmin(db, { excludingUserId: userId });
        } catch (lockoutErr) {
          if (lockoutErr instanceof Error && lockoutErr.message === LOCKOUT_PREVENTION) {
            return {
              error:
                "Refusing to delete: this user is the last with effective " +
                "admin coverage. Assign Admin (or a role that grants 'manage all') " +
                "to another user before deleting.",
            };
          }
          throw lockoutErr;
        }

        // Clean up non-critical references before deletion
        await db.delete(session).where(eq(session.userId, userId));
        await db.delete(account).where(eq(account.userId, userId));
        await db.delete(userViews).where(eq(userViews.userId, userId));

        await auth.api.removeUser({ body: { userId }, headers: await headers() });
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("foreign key")) { return { error: "User has dependencies; cannot delete." }; }
        return { error: "Failed to delete user" };
      }
    }
    ```

    Note: this lock-out check is OUTSIDE a transaction because Better Auth's `removeUser` doesn't take a tx. Race condition: between the check and the removeUser call, another admin could be revoked. Mitigation: the check uses Path B SQL which is point-in-time; if the race happens, the cascade DELETE will succeed (removing user_roles for the deleted user) and a follow-up request will rebuild the ability — the system stays functional, just briefly with N-1 admins. This is acceptable for v1.1.

    DO NOT modify any other function in this file. The existing `inviteUser`, `updateUser`, `setUserRole`, etc. paths are out of scope for this task.
  </action>
  <acceptance_criteria>
    - `deleteUser` in `src/app/(app)/settings/users/actions.ts` calls `assertAtLeastOneEffectiveAdmin(db, { excludingUserId: userId })` BEFORE `auth.api.removeUser`
    - The lockout-prevention catch returns `{ error: "Refusing to delete..." }` with the canonical recovery message
    - Other functions in the file are NOT modified (`git diff src/app/(app)/settings/users/actions.ts` shows changes only in the deleteUser block)
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `tests/db/better-auth-admin-plugin.integration.test.ts` GREEN — extend it to cover the deleteUser path: deleting the last admin returns the lockout error WITHOUT calling removeUser
  </acceptance_criteria>
  <verify>
    <automated>grep -A2 "export async function deleteUser" src/app/\(app\)/settings/users/actions.ts | grep -q "assertAtLeastOneEffectiveAdmin\|excludingUserId" || grep -q "assertAtLeastOneEffectiveAdmin.*excludingUserId" src/app/\(app\)/settings/users/actions.ts && grep -q "LOCKOUT_PREVENTION" src/app/\(app\)/settings/users/actions.ts && grep -q "Refusing to delete" src/app/\(app\)/settings/users/actions.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project integration tests/db/better-auth-admin-plugin.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>deleteUser wrapped with lock-out guard; RESEARCH §Q6 last-paragraph mitigation gap closed. Better Auth's removeUser cannot inadvertently lock the system out from the existing user-delete UI.</done>
</task>

<task type="auto">
  <name>Task 4: Extend ManageScopesDialog + scopes-actions with roleId binding (per-(user, role) scope-edit UI)</name>
  <files>
    src/components/admin/manage-scopes-dialog.tsx,
    src/app/(app)/settings/users/[id]/scopes-actions.ts,
    src/app/(app)/settings/users/[id]/scopes-internal.ts,
    src/app/(app)/settings/users/[id]/role-assignment-client.tsx
  </files>
  <read_first>
    - src/components/admin/manage-scopes-dialog.tsx (full file — current per-user-only dialog shape; donor pattern)
    - src/app/(app)/settings/users/[id]/scopes-actions.ts (full file — `addScope` / `removeScope` / `listScopes` server-action signatures)
    - src/app/(app)/settings/users/[id]/scopes-internal.ts (full file — `_addScopeForActor` / `_removeScopeForActor` / `_listScopesForActor` helpers; actor pattern + audit-log writer)
    - src/app/(app)/settings/users/[id]/role-internal.ts (the per-(user, role) UserRoleAssignment shape from Task 1)
    - src/db/schema.ts (`userScopes.roleId` column added by Plan 10-02 migration 0050; nullable until 0052 NOT-NULL flip)
    - .planning/phases/10-access-control-extended/10-RESEARCH.md §Q6 ("Lock-out validation") + §"Open Questions OQ-2" (admin user has zero scope rows by design; nullable `role_id` invariant)
    - .planning/phases/10-access-control-extended/10-PATTERNS.md §E2 (manage-scopes-dialog donor pattern; refresh-on-open + per-row removingId)
  </read_first>
  <action>
    **Goal:** AUTH-07 SC4 end-to-end. Per-(user, role) scope binding in the UI, not just the RPC. Three coordinated edits.

    **1. Extend `scopes-actions.ts` + `scopes-internal.ts` to take an optional `roleId` arg.**

    `_addScopeForActor` and `_listScopesForActor` currently key on `userId`. Augment to optionally key on `(userId, roleId)`:

    ```ts
    // scopes-internal.ts — augment _addScopeForActor signature
    export async function _addScopeForActor(args: {
      actorId: string;
      userId: string;
      roleId: string;            // NEW — required (after migration 0052 the column is NOT NULL)
      dimensionType: ScopeDimensionType;
      dimensionId: string;
    }): Promise<{ success: true; scope: UserScopeRow } | { error: string }> {
      // ... existing actor gate + lookup ...

      // Verify the (userId, roleId) pair has a corresponding user_roles row.
      // Refusing scope-bind to a role the user is not assigned avoids orphans.
      const [assignment] = await db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, args.userId), eq(userRoles.roleId, args.roleId)))
        .limit(1);
      if (!assignment) {
        return { error: "Cannot bind scope: user does not have this role assigned." };
      }

      // ... existing INSERT into user_scopes — now SET role_id = args.roleId ...
      // ... existing audit-log writer — extend metadata with kind: 'user.scope.bind', role_id: args.roleId ...
    }

    // scopes-internal.ts — augment _listScopesForActor signature
    export async function _listScopesForActor(args: {
      actorId: string;
      userId: string;
      roleId?: string;           // NEW — optional filter; if omitted, returns ALL scopes for user
    }): Promise<UserScopeRow[]> {
      // ... existing actor gate ...
      const where = args.roleId
        ? and(eq(userScopes.userId, args.userId), eq(userScopes.roleId, args.roleId))
        : eq(userScopes.userId, args.userId);
      // ... existing SELECT with the new where ...
    }
    ```

    Same shape for `_removeScopeForActor` — it already takes a scope row id, but the audit-log metadata gains `role_id` from the deleted row.

    Mirror the `roleId` arg through `scopes-actions.ts` server-action wrappers — `addScope(userId, roleId, dimensionType, dimensionId)`, `listScopes(userId, roleId?)`. Existing call sites that pass no `roleId` continue to work for the `listScopes(userId)` "all scopes for user" use case (Task 2's RSC page uses this).

    **2. Extend `manage-scopes-dialog.tsx` with a roleId picker.**

    The dialog currently takes `userId` and renders dimension/id pairs. Augment its props:

    ```tsx
    "use client";

    type ManageScopesDialogProps = {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      userId: string;
      // NEW: required when the dialog is bound to a specific (user, role) assignment.
      // When omitted (legacy callers), the dialog falls back to picking a role from
      // the user's assignments (defensive — Task 2's flow always passes a roleId).
      roleId?: string;
      assignmentLabel?: string;  // e.g. "Ops-IT" — shown in the dialog header for context
    };

    export function ManageScopesDialog({ open, onOpenChange, userId, roleId, assignmentLabel }: ManageScopesDialogProps) {
      // ... existing useState / refresh-on-open pattern ...

      const refresh = React.useCallback(async () => {
        // listScopes now takes the optional roleId
        const next = await listScopes(userId, roleId);
        setScopes(next);
      }, [userId, roleId]);

      async function handleAdd(dimensionType: ScopeDimensionType, dimensionId: string) {
        if (!roleId) {
          toast.error("Cannot add scope: no role selected.");
          return;
        }
        // addScope now takes roleId
        const result = await addScope(userId, roleId, dimensionType, dimensionId);
        // ... existing error handling + refresh ...
      }

      // ... rest of the dialog body ...

      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {assignmentLabel ? `Scopes for "${assignmentLabel}"` : "User scopes"}
              </DialogTitle>
            </DialogHeader>
            {/* ... existing dimension/id pickers + scopes list ... */}
          </DialogContent>
        </Dialog>
      );
    }
    ```

    Behaviour: when `roleId` is provided, the dialog shows ONLY scopes bound to that (user, role) pair, and `addScope` writes with that `role_id`. The dialog header surfaces the assignment label (e.g. "Scopes for 'Ops-IT'") so the operator knows which assignment they're scoping.

    **3. Wire into `role-assignment-client.tsx` (extending Task 2's component).**

    Add an "Edit scopes" affordance per assignment row:

    ```tsx
    // role-assignment-client.tsx — augment the assignment row render
    const [scopeDialog, setScopeDialog] = React.useState<{
      open: boolean;
      roleId: string | null;
      label: string;
    }>({ open: false, roleId: null, label: "" });

    // ... in the assignment row ...
    <Button
      variant="outline"
      size="sm"
      onClick={() => setScopeDialog({ open: true, roleId: a.roleId, label: a.roleDisplayName })}
    >
      Edit scopes
    </Button>

    // ... once at component root ...
    {scopeDialog.roleId && (
      <ManageScopesDialog
        open={scopeDialog.open}
        onOpenChange={(open) => setScopeDialog((s) => ({ ...s, open }))}
        userId={userId}
        roleId={scopeDialog.roleId}
        assignmentLabel={scopeDialog.label}
      />
    )}
    ```

    The "scope count" already shown on the assignment row (`{a.scopes.length} scope(s)`) refreshes after the dialog closes via Task 2's existing `refresh()`.

    **Audit-log:** every `addScope` call writes an audit row with `entityType='user_scope'`, `action='bind'`, `metadata.kind='user.scope.bind'`, `metadata.role_id`, `metadata.dimension`. Every `removeScope` writes `kind='user.scope.unbind'` with the deleted row's `role_id`. Confirms with 10-RESEARCH §Q5 audit shape.

    **Migration ordering note:** Plan 10-02 migration 0050 adds `userScopes.role_id` nullable; 0051 backfills existing rows; 0052 (operator-gated) flips to NOT NULL. This Task 4 ships AFTER 0050+0051 are applied (Wave 4 depends on Wave 1's 10-02). The `roleId` arg becomes required in scopes-internal but the column stays nullable until 0052 — the runtime code is forward-compatible with both states.

    **Out of scope for this task:** changing other (non-user-detail) callers of ManageScopesDialog. Defensive: the augmented dialog still works when `roleId` is undefined, returning early in `handleAdd` with the toast. Audit existing callers via `grep -r "ManageScopesDialog" src/` — if any other call site exists, leave it untouched and document in the SUMMARY.
  </action>
  <acceptance_criteria>
    - `src/app/(app)/settings/users/[id]/scopes-actions.ts` and `scopes-internal.ts` accept `roleId` parameter on `addScope` (required) and `listScopes` (optional filter)
    - `_addScopeForActor` refuses to bind a scope when `(userId, roleId)` has no matching `user_roles` row (returns `{ error: "Cannot bind scope: user does not have this role assigned." }`)
    - `src/components/admin/manage-scopes-dialog.tsx` accepts `roleId?` and `assignmentLabel?` props and surfaces the assignment label in the dialog title when provided
    - `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` renders an "Edit scopes" button per assignment row that opens ManageScopesDialog scoped to that `(user, role)` pair
    - Audit log: `addScope` writes `metadata.kind='user.scope.bind'` with `metadata.role_id`; `removeScope` writes `metadata.kind='user.scope.unbind'`
    - `npx tsc --noEmit -p tsconfig.json` exits 0
    - `tests/db/casl-ability.integration.test.ts` GREEN — extend it to cover: assigning Ops-IT to a user, binding a region scope to that (user, role) pair, asserting `buildAbility(ctx)` produces `conditions: { regionId: $1 }` ONLY on rules from the Ops-IT role
    - `tests/access-control/user-role-assignment.spec.ts` (Plan 10-01 RED stub) Playwright-list-clean; full-green gate is Plan 10-08
    - `git diff src/app/(app)/settings/users/page.tsx` empty (the user-list page is NOT in scope; only [id]/* + manage-scopes-dialog.tsx)
  </acceptance_criteria>
  <verify>
    <automated>grep -q "roleId" src/app/\(app\)/settings/users/\[id\]/scopes-internal.ts && grep -q "roleId" src/app/\(app\)/settings/users/\[id\]/scopes-actions.ts && grep -q "user does not have this role assigned" src/app/\(app\)/settings/users/\[id\]/scopes-internal.ts && grep -q "roleId" src/components/admin/manage-scopes-dialog.tsx && grep -q "assignmentLabel" src/components/admin/manage-scopes-dialog.tsx && grep -q "ManageScopesDialog" src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx && grep -q "Edit scopes" src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx && grep -q "user.scope.bind" src/app/\(app\)/settings/users/\[id\]/scopes-internal.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" | grep -q "^0$" && npx vitest run --project integration tests/db/casl-ability.integration.test.ts 2>&1 | tail -5 | grep -qE "passed|✓"</automated>
  </verify>
  <done>Per-(user, role) scope binding shipped end-to-end: scopes-actions/internal take roleId; ManageScopesDialog filters + writes per-(user, role); role-assignment-client opens the dialog scoped to a specific assignment. AUTH-07 SC4 fully delivered without v1.2 carry.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Role assignment server actions ↔ user.role text mirror | refreshUserRoleMirror inside tx keeps Better Auth admin plugin functional. Skipping = stale text → admin endpoints break. |
| deleteUser ↔ Better Auth removeUser | The new wrapper is the ONLY safe path to call removeUser from the app. Direct invocation in some other code path bypasses the lock-out guard. |
| revokeRole inside tx ↔ assertAtLeastOneEffectiveAdmin | Lock-out guard runs INSIDE the same tx as the user_roles DELETE. Skipping = silent admin lockout. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-06-01 | Denial of Service | Last admin revokes their admin role from /settings/users/[id] | mitigate | Plan 10-03 lockout-guard + this plan's revokeRole wraps it inside tx. Plan 10-01's lockout-guard.integration.test.ts covers this case. |
| T-10-06-02 | Denial of Service | Admin deletes the last admin from the user-list UI | mitigate | This task's deleteUser augmentation runs assertAtLeastOneEffectiveAdmin(db, { excludingUserId: userId }) BEFORE auth.api.removeUser. Returns clear recovery error. |
| T-10-06-03 | Spoofing | Better Auth admin plugin reads stale user.role after revokeRole | mitigate | refreshUserRoleMirror(userId, tx) inside the same tx. The next session-read sees the updated text. Plan 10-01 better-auth-admin-plugin.integration.test.ts asserts. |
| T-10-06-04 | Race condition | Between assertAtLeastOneEffectiveAdmin and auth.api.removeUser, another admin gets revoked | accept | Brief window; the cascade DELETE on the user being deleted still completes; system has N-1 admins for one render then rebuilds. Documented in task action; not worth a distributed lock for v1.1. |
| T-10-06-05 | Tampering | Browser POSTs assignRole with a roleId not visible in the UI's role list | mitigate | role-actions.ts gates on requireRole('admin') + verifies role exists via DB lookup before INSERT. The UI's filtering is UX, not security. |
| T-10-06-06 | Information Disclosure | Audit log records full scopes-at-revoke list with dimension UUIDs | accept | Per Q5 audit shape. Captures cascade-deleted state for forensics. UUIDs are not secret. |
</threat_model>

<verification>
- `tests/db/better-auth-admin-plugin.integration.test.ts` GREEN with the new mirror-in-tx + deleteUser-lockout coverage
- `npx tsc --noEmit -p tsconfig.json` clean
- All previously-passing tests remain GREEN
- `npx playwright test --list tests/access-control/user-role-assignment.spec.ts` lists cleanly
- Plan 10-01 lockout-guard.integration.test.ts continues GREEN (no regression)
</verification>

<success_criteria>
- 8 files (4 new + 4 augmented — added scopes-actions.ts/scopes-internal.ts/manage-scopes-dialog.tsx + augmented role-assignment-client.tsx in revision iter 1 to deliver AUTH-07 SC4 end-to-end)
- Two-file `"use server"` split applied (role-actions.ts + role-internal.ts) per PATTERNS §"non-negotiable"
- Every mutation transactional + mirror-refresh-in-tx + lockout-guard (revoke only) + audit-log
- deleteUser wraps Better Auth removeUser with assertAtLeastOneEffectiveAdmin (closes RESEARCH §Q6 gap)
- /settings/users/[id]/page.tsx EXISTS (was missing per PATTERNS §"Critical Reversals" item 2)
- ManageScopesDialog + scopes-actions/internal extended with roleId; per-(user, role) scope binding shipped end-to-end (AUTH-07 SC4)
- All Plan 10-01 better-auth-admin-plugin + lockout-guard + casl-ability integration tests GREEN
- Plan 10-01 user-role-assignment.spec.ts list-clean (full GREEN gate is Plan 10-08)
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-06-SUMMARY.md` documenting:
- 5 files shipped (4 new + 1 augmented)
- The deleteUser augmentation closing RESEARCH §Q6 last-paragraph gap
- The deferred work: per-(user, role) scope-edit UI in ManageScopesDialog (deferred to v1.2 polish — DB + audit + RPC support is in place; only the dialog UI needs the roleId picker)
- Status of Plan 10-01 RED tests: better-auth-admin-plugin GREEN; user-role-assignment.spec.ts list-clean
</output>
