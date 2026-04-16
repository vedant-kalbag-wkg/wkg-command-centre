"use server";

/**
 * Public server actions for userScopes CRUD. Each gates on
 * `requireRole('admin')` then delegates to a non-server-action helper in
 * `./scopes-internal.ts`.
 *
 * Implementation, types, and the testable internal helpers all live in the
 * sibling file. See `scopes-internal.ts` for the rationale — splitting them
 * is mandatory for both runtime correctness (Turbopack server-action bundling)
 * and security (only the wrapped functions become network-callable RPCs).
 */

import { db as prodDb } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  _addScopeForActor,
  _listScopesForActor,
  _removeScopeForActor,
  type Actor,
  type DimensionType,
  type UserScopeRow,
} from "./scopes-internal";

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

export async function addScope(
  userId: string,
  dimensionType: DimensionType,
  dimensionId: string,
): Promise<void> {
  const actor = await getActorFromSession();
  await _addScopeForActor(prodDb, actor, userId, dimensionType, dimensionId);
}

export async function removeScope(scopeId: string): Promise<void> {
  const actor = await getActorFromSession();
  await _removeScopeForActor(prodDb, actor, scopeId);
}
