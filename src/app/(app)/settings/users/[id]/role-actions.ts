"use server";

import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  _listUserRolesForActor,
  _assignRoleForActor,
  _revokeRoleForActor,
  type Actor,
  type ScopeBinding,
  type UserRoleAssignment,
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

export async function listUserRoles(
  userId: string,
): Promise<UserRoleAssignment[]> {
  const actor = await getActorFromSession();
  return _listUserRolesForActor(db, actor, userId);
}

export async function assignRole(
  userId: string,
  roleId: string,
  scopes: ScopeBinding[],
): Promise<{ success: true; userRoleId: string } | { error: string }> {
  try {
    const actor = await getActorFromSession();
    const { userRoleId } = await _assignRoleForActor(
      db,
      actor,
      userId,
      roleId,
      scopes,
    );
    return { success: true, userRoleId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to assign role",
    };
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
    const msg =
      err instanceof Error ? err.message : "Failed to revoke role";
    if (msg === LOCKOUT_PREVENTION) return { status: "lockout_prevention" };
    return { error: msg };
  }
}
