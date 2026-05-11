"use server";

import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  _listRolesForActor,
  _getRoleForActor,
  _createRoleForActor,
  _replaceRolePermissionsForActor,
  _deleteRoleForActor,
  _cloneRoleForActor,
  type Actor,
  type RoleListItem,
  type RoleDetail,
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

export async function listRoles(): Promise<
  { roles: RoleListItem[] } | { error: string }
> {
  try {
    const actor = await getActorFromSession();
    const rows = await _listRolesForActor(db, actor);
    return { roles: rows };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list roles" };
  }
}

export async function getRole(
  roleId: string,
): Promise<{ role: RoleDetail } | { error: string }> {
  try {
    const actor = await getActorFromSession();
    const role = await _getRoleForActor(db, actor, roleId);
    if (!role) return { error: "Role not found" };
    return { role };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch role" };
  }
}

export async function createRole(input: {
  name: string;
  displayName: string;
  description?: string;
  rules: RawRule[];
}): Promise<{ success: true; id: string } | { error: string }> {
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
): Promise<
  | { success: true; impactedUserCount: number }
  | { error: string }
  | { status: "lockout_prevention" }
> {
  try {
    const actor = await getActorFromSession();
    const { impactedUserCount } = await _replaceRolePermissionsForActor(
      db,
      actor,
      roleId,
      rules,
    );
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
