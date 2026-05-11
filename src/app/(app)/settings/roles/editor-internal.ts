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

import { roles, rolePermissions, userRoles } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import {
  assertAtLeastOneEffectiveAdmin,
  LOCKOUT_PREVENTION,
} from "@/lib/casl/lockout-guard";
import { refreshUserRoleMirror } from "@/lib/casl/role-mirror";
import { assertValidAction, assertValidSubject } from "@/lib/casl/subjects";
import type { RawRule } from "@/lib/casl/types";
import { eq, sql } from "drizzle-orm";

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
  assignedUserCount: number;
};

/**
 * Role names that cannot be used for custom roles.
 * These names are reserved by the system to prevent privilege escalation:
 * - "admin" mirrors to user.role = "admin" which grants manage:all in ability.ts
 * - "system" is the system kind sentinel
 * - "ops-it" and "read-only" are the tier role names
 */
export const RESERVED_ROLE_NAMES = new Set(["admin", "system", "ops-it", "read-only"]);

function assertNotReservedName(name: string): void {
  if (RESERVED_ROLE_NAMES.has(name)) {
    throw new Error(
      `Role name "${name}" is reserved and cannot be used for custom roles.`,
    );
  }
}

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
export async function _listRolesForActor(
  db: AnyDb,
  actor: Actor,
): Promise<RoleListItem[]> {
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
  return (
    data as Array<{
      id: string;
      name: string;
      kind: string;
      display_name: string;
      description: string | null;
      assigned_user_count: number;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as "system" | "tier" | "custom",
    displayName: r.display_name,
    description: r.description,
    assignedUserCount: r.assigned_user_count,
  }));
}

// ── _getRoleForActor ─────────────────────────────────────────────────
export async function _getRoleForActor(
  db: AnyDb,
  actor: Actor,
  roleId: string,
): Promise<RoleDetail | null> {
  if (actor.role !== "admin") throw new Error("Forbidden");
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) return null;
  const ruleRows = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const rules: RawRule[] = ruleRows.map(
    (r: {
      action: string;
      subject: string;
      fields: unknown;
      conditions: unknown;
      inverted: boolean;
    }) => ({
      action: r.action,
      subject: r.subject,
      fields: (r.fields as string[] | null) ?? null,
      conditions: (r.conditions as Record<string, unknown> | null) ?? null,
      inverted: r.inverted,
    }),
  );

  // Count assigned users for the detail view
  const countRows = await db.execute(sql`
    SELECT COUNT(DISTINCT user_id)::int AS count
    FROM user_roles
    WHERE role_id = ${roleId}
  `);
  const countData = (countRows as { rows?: unknown[] }).rows ?? (countRows as unknown[]);
  const assignedUserCount =
    ((countData as Array<{ count: number }>)[0]?.count as number) ?? 0;

  return {
    id: role.id,
    name: role.name,
    kind: role.kind as "system" | "tier" | "custom",
    displayName: role.displayName,
    description: role.description ?? null,
    rules,
    assignedUserCount,
  };
}

// ── _createRoleForActor ──────────────────────────────────────────────
export async function _createRoleForActor(
  db: AnyDb,
  actor: Actor,
  input: {
    name: string;
    displayName: string;
    description?: string;
    rules: RawRule[];
  },
): Promise<{ id: string }> {
  if (actor.role !== "admin") throw new Error("Forbidden");
  assertNotReservedName(input.name);
  validateRules(input.rules);

  return await db.transaction(async (tx: AnyDb) => {
    const [created] = await tx
      .insert(roles)
      .values({
        name: input.name,
        kind: "custom" as const,
        displayName: input.displayName,
        description: input.description ?? null,
      })
      .returning({ id: roles.id });

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

  const [target] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!target) throw new Error("Role not found");
  assertNotSystem(target, "edit permissions on");

  return await db.transaction(async (tx: AnyDb) => {
    const beforeRows = await tx
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    const before: RawRule[] = beforeRows.map(
      (r: {
        action: string;
        subject: string;
        fields: unknown;
        conditions: unknown;
        inverted: boolean;
      }) => ({
        action: r.action,
        subject: r.subject,
        fields: (r.fields as string[] | null) ?? null,
        conditions: (r.conditions as Record<string, unknown> | null) ?? null,
        inverted: r.inverted,
      }),
    );

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

    const countRows = await tx.execute(sql`
      SELECT COUNT(DISTINCT user_id)::int AS count
      FROM user_roles
      WHERE role_id = ${roleId}
    `);
    const countData =
      (countRows as { rows?: unknown[] }).rows ??
      (countRows as unknown as unknown[]);
    const count =
      ((countData as Array<{ count: number }>)[0]?.count as number) ?? 0;

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
  const [target] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!target) throw new Error("Role not found");
  assertNotSystem(target, "delete");

  await db.transaction(async (tx: AnyDb) => {
    // Capture impacted users BEFORE the cascade.
    const impactedRows = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    const impactedUserIds = impactedRows.map(
      (r: { userId: string }) => r.userId,
    );

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

// Re-export LOCKOUT_PREVENTION so callers in actions.ts can import it
// from a single module without also needing to import from lockout-guard.
export { LOCKOUT_PREVENTION };
