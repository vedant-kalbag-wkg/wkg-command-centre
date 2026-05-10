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
autonomous: true
requirements: [AUTH-06, AUTH-07]
must_haves:
  truths:
    - "/settings/users/[id]/page.tsx EXISTS and loads the user + their role assignments + their per-(user, role) scopes — currently the directory has only scopes-actions.ts + scopes-internal.ts with NO page.tsx (RESEARCH Open Questions OQ-1 + PATTERNS §E1)."
    - "Admin can assign a role to a user with optional per-(user, role, dimension) scope binding (AUTH-07 SC4); revocation cascades user_scopes for that (user, role) pair via DB FK."
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

    Per PATTERNS §E2 "Things to NOT copy" — the existing `manage-scopes-dialog.tsx` was per-user-only; the planner extends to (role, scope[]) but for v1.1 we keep scope-add via the existing dialog (which now writes per-(user, role) scope rows because the schema supports it from Plan 10-02). The audit-log captures the scope context via the existing scopes-actions.ts. This UI shape ships per-(user, role) by NOT showing scopes inline; the operator clicks through to the existing scopes dialog from the page (rendered alongside RoleAssignmentClient).

    **Decision (planner — pragmatic for v1.1):** RoleAssignmentClient handles ASSIGN/REVOKE only. Scope binding remains in the existing `<ManageScopesDialog>` from Phase 7/8, but Plan 10-02's schema means scopes ARE per-(user, role). The current scopes dialog needs a roleId picker to know which assignment a scope belongs to — extending it is in scope here:

    Inspect `src/components/admin/manage-scopes-dialog.tsx` — if it doesn't yet pick roleId, extend it to add a roleId dropdown (pulling from the user's assignments) before the dimension/id pair. The scopes-actions.ts will need to take a roleId arg in `addScope` — augmenting that signature requires a tweak. Alternative: SKIP the scope-edit-from-dialog flow in v1.1 and document that scope-binding-per-role is "follow-up after Plan 10-08". 

    **Pragmatic decision for this plan:** Ship the assign/revoke UI cleanly; document the per-(user, role) scope-edit UI extension as a Plan 10-08 close-out item OR a v1.2 carry. The DB schema supports it (Plan 10-02); the audit-log captures it (Plan 10-05); the test integration covers it (Plan 10-01). The UI affordance for editing existing scopes-per-role is a v1.2 polish item. Document in 10-06-SUMMARY.md.
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
- 5 files (4 new + 1 augmented)
- Two-file `"use server"` split applied (role-actions.ts + role-internal.ts) per PATTERNS §"non-negotiable"
- Every mutation transactional + mirror-refresh-in-tx + lockout-guard (revoke only) + audit-log
- deleteUser wraps Better Auth removeUser with assertAtLeastOneEffectiveAdmin (closes RESEARCH §Q6 gap)
- /settings/users/[id]/page.tsx EXISTS (was missing per PATTERNS §"Critical Reversals" item 2)
- All Plan 10-01 better-auth-admin-plugin + lockout-guard integration tests GREEN
- Plan 10-01 user-role-assignment.spec.ts list-clean (full GREEN gate is Plan 10-08)
</success_criteria>

<output>
After completion, create `.planning/phases/10-access-control-extended/10-06-SUMMARY.md` documenting:
- 5 files shipped (4 new + 1 augmented)
- The deleteUser augmentation closing RESEARCH §Q6 last-paragraph gap
- The deferred work: per-(user, role) scope-edit UI in ManageScopesDialog (deferred to v1.2 polish — DB + audit + RPC support is in place; only the dialog UI needs the roleId picker)
- Status of Plan 10-01 RED tests: better-auth-admin-plugin GREEN; user-role-assignment.spec.ts list-clean
</output>
