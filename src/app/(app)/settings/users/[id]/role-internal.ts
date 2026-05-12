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

import { roles, userRoles, userScopes, user } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { refreshUserRoleMirror } from "@/lib/casl/role-mirror";
import { assertAtLeastOneEffectiveAdmin } from "@/lib/casl/lockout-guard";
// DEVIATION: assertValidDimensionType is not exported from scoped-query — defined locally below
import type { DimensionType } from "@/lib/scoping/scoped-query";
import { eq, and } from "drizzle-orm";

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

// DEVIATION: local definition — assertValidDimensionType is NOT exported from @/lib/scoping/scoped-query
export const VALID_DIMENSION_TYPES: readonly DimensionType[] = [
  "hotel_group",
  "location",
  "region",
  "product",
  "provider",
  "location_group",
] as const;

export function assertValidDimensionType(
  value: string,
): asserts value is DimensionType {
  if (!(VALID_DIMENSION_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid dimensionType: ${value}. Must be one of: ${VALID_DIMENSION_TYPES.join(", ")}`,
    );
  }
}

// ── _listUserRolesForActor ────────────────────────────────────────────
export async function _listUserRolesForActor(
  db: AnyDb,
  actor: Actor,
  userId: string,
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

  return grants.map(
    (g: {
      userRoleId: string;
      roleId: string;
      roleName: string;
      roleDisplayName: string;
      roleKind: string;
      assignedAt: Date;
      assignedBy: string | null;
    }) => ({
      userRoleId: g.userRoleId,
      roleId: g.roleId,
      roleName: g.roleName,
      roleDisplayName: g.roleDisplayName,
      roleKind: g.roleKind as "system" | "tier" | "custom",
      assignedAt: g.assignedAt,
      assignedBy: g.assignedBy,
      scopes: scopeRows
        .filter((s: { roleId: string | null }) => s.roleId === g.roleId)
        .map(
          (s: { id: string; dimensionType: string; dimensionId: string }) => ({
            id: s.id,
            dimensionType: s.dimensionType,
            dimensionId: s.dimensionId,
          }),
        ),
    }),
  );
}

// ── _assignRoleForActor ───────────────────────────────────────────────
//
// Scope semantics are ADD-ONLY: the `scopes` array is inserted via
// onConflictDoNothing keyed on (user_id, role_id, dimension_type, dimension_id),
// so repeated calls with different scope sets ADD to the user-role's scope
// list, never replace it. The admin UI's "Assign role" flow always passes
// `scopes: []` and routes scope changes through ManageScopesDialog +
// addUserScope/removeUserScope (which delete + insert atomically). Server-
// side callers (seeders, fixtures, migrations) wanting replace semantics
// must clear existing rows for (user_id, role_id) themselves before calling.
export async function _assignRoleForActor(
  db: AnyDb,
  actor: Actor,
  userId: string,
  roleId: string,
  scopes: ScopeBinding[],
): Promise<{ userRoleId: string }> {
  if (actor.role !== "admin") throw new Error("Forbidden");
  for (const s of scopes) assertValidDimensionType(s.dimensionType);

  // Verify target user + role both exist.
  const [target] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) throw new Error("User not found");
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) throw new Error("Role not found");

  return await db.transaction(async (tx: AnyDb) => {
    // Upsert the user_roles row (idempotent on (user_id, role_id) unique).
    const inserted = await tx
      .insert(userRoles)
      .values({
        userId,
        roleId,
        assignedBy: actor.id,
      })
      .onConflictDoNothing({
        target: [userRoles.userId, userRoles.roleId],
      })
      .returning({ id: userRoles.id });

    const fallback = await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);
    const userRoleId = inserted[0]?.id ?? fallback[0]?.id;
    if (!userRoleId) throw new Error("Failed to resolve userRoleId after upsert");

    // Insert per-(user, role, dim) scopes.
    if (scopes.length > 0) {
      await tx
        .insert(userScopes)
        .values(
          scopes.map((s) => ({
            userId,
            roleId,
            dimensionType: s.dimensionType,
            dimensionId: s.dimensionId,
            createdBy: actor.id,
          })),
        )
        .onConflictDoNothing({
          target: [
            userScopes.userId,
            userScopes.roleId,
            userScopes.dimensionType,
            userScopes.dimensionId,
          ],
        });
    }

    // Refresh user.role text mirror in lock-step with user_roles write.
    // Better Auth admin plugin reads user.role text.
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
  db: AnyDb,
  actor: Actor,
  userRoleId: string,
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
      .select({
        id: userScopes.id,
        dimensionType: userScopes.dimensionType,
        dimensionId: userScopes.dimensionId,
      })
      .from(userScopes)
      .where(
        and(
          eq(userScopes.userId, target.userId),
          eq(userScopes.roleId, target.roleId),
        ),
      );

    // Delete the user_roles row — cascade drops user_scopes via FK on
    // (user_id, role_id) per Plan 10-02 schema (FK is on roleId only,
    // so we explicitly delete scopes for safety).
    await tx
      .delete(userScopes)
      .where(
        and(
          eq(userScopes.userId, target.userId),
          eq(userScopes.roleId, target.roleId),
        ),
      );
    await tx.delete(userRoles).where(eq(userRoles.id, userRoleId));

    // Lockout-guard AFTER delete, BEFORE commit.
    // No excludeUserId option — the row is already deleted above.
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

