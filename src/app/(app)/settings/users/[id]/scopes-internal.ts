/**
 * Internal helpers + types for userScopes CRUD.
 *
 * This file deliberately does NOT carry the "use server" directive — splitting
 * it from `scopes-actions.ts` is mandatory:
 *
 *   1. A file with "use server" can only export async functions. Type-only
 *      re-exports (DimensionType, Actor, UserScopeRow) confuse the Turbopack
 *      server-action bundler; the emitted module references the type at
 *      runtime and crashes with `ReferenceError: DimensionType is not defined`
 *      on the first POST.
 *
 *   2. Exporting the `_*ForActor` helpers from a "use server" file would
 *      register them as network-callable server-action RPC endpoints —
 *      bypassing the `requireRole('admin')` gate that the public wrappers
 *      enforce. Keeping them here ensures only the public wrappers in
 *      `scopes-actions.ts` are reachable from the network.
 */

import { and, eq } from "drizzle-orm";
import { user, userScopes } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import type { DimensionType } from "@/lib/scoping/scoped-query";

export type { DimensionType };

export type Actor = {
  id: string;
  name: string;
  role: "admin" | "member" | "viewer" | string;
};

export type UserScopeRow = {
  id: string;
  userId: string;
  dimensionType: DimensionType;
  dimensionId: string;
  createdAt: Date;
};

// Drizzle DB shape — kept loose so testcontainers (node-postgres) and prod
// (postgres-js) drivers can both pass through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = any;

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

export async function _listScopesForActor(
  db: AnyDb,
  actor: Actor,
  userId: string,
): Promise<UserScopeRow[]> {
  if (actor.role !== "admin") {
    throw new Error("Forbidden");
  }
  const rows = await db
    .select({
      id: userScopes.id,
      userId: userScopes.userId,
      dimensionType: userScopes.dimensionType,
      dimensionId: userScopes.dimensionId,
      createdAt: userScopes.createdAt,
    })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));
  return rows as UserScopeRow[];
}

export async function _addScopeForActor(
  db: AnyDb,
  actor: Actor,
  userId: string,
  dimensionType: DimensionType,
  dimensionId: string,
): Promise<void> {
  if (actor.role !== "admin") {
    throw new Error("Forbidden");
  }
  assertValidDimensionType(dimensionType);

  await db
    .insert(userScopes)
    .values({
      userId,
      dimensionType,
      dimensionId,
      createdBy: actor.id,
    })
    .onConflictDoNothing({
      target: [
        userScopes.userId,
        userScopes.dimensionType,
        userScopes.dimensionId,
      ],
    });

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "user",
      entityId: userId,
      entityName: "",
      action: "assign",
      field: "userScopes",
      newValue: `${dimensionType}:${dimensionId}`,
    },
    db,
  );
}

export async function _removeScopeForActor(
  db: AnyDb,
  actor: Actor,
  scopeId: string,
): Promise<void> {
  if (actor.role !== "admin") {
    throw new Error("Forbidden");
  }

  const existing = await db
    .select({
      id: userScopes.id,
      userId: userScopes.userId,
      dimensionType: userScopes.dimensionType,
      dimensionId: userScopes.dimensionId,
    })
    .from(userScopes)
    .where(eq(userScopes.id, scopeId))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Scope not found: ${scopeId}`);
  }
  const row = existing[0] as {
    id: string;
    userId: string;
    dimensionType: DimensionType;
    dimensionId: string;
  };

  const targetUser = await db
    .select({ userType: user.userType })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1);

  if (targetUser.length > 0 && targetUser[0].userType === "external") {
    const remaining = await db
      .select({ id: userScopes.id })
      .from(userScopes)
      .where(eq(userScopes.userId, row.userId));
    if (remaining.length <= 1) {
      throw new Error(
        "Cannot remove last scope from external user — external users must have at least one scope row",
      );
    }
  }

  await db.delete(userScopes).where(and(eq(userScopes.id, scopeId)));

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "user",
      entityId: row.userId,
      entityName: "",
      action: "unassign",
      field: "userScopes",
      oldValue: `${row.dimensionType}:${row.dimensionId}`,
    },
    db,
  );
}
