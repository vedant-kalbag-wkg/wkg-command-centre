"use server";

/**
 * userScopes CRUD server actions (admin-only).
 *
 * Public actions (`listScopes`, `addScope`, `removeScope`) enforce admin auth
 * via `requireRole('admin')` then delegate to internal helpers (prefixed `_`)
 * which take an explicit `Actor` so they can be unit-tested without mocking
 * `next/headers`. The auth gate itself is covered by `src/lib/rbac.ts`.
 *
 * Invariants enforced here:
 *   - dimensionType is validated against the canonical enum at runtime.
 *   - addScope is idempotent on (userId, dimensionType, dimensionId) via
 *     `onConflictDoNothing` — no error on duplicates.
 *   - removeScope refuses to remove the last remaining scope from a user with
 *     userType='external' (the external-portal access invariant).
 *   - Every mutation writes an audit log entry (action=assign|unassign).
 */

import { and, eq } from "drizzle-orm";
import { db as prodDb } from "@/db";
import { user, userScopes } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import type { DimensionType } from "@/lib/scoping/scoped-query";

// Re-export for callers (UI in Task 3.4) that need the type
export type { DimensionType };

const VALID_DIMENSION_TYPES: readonly DimensionType[] = [
  "hotel_group",
  "location",
  "region",
  "product",
  "provider",
  "location_group",
] as const;

function assertValidDimensionType(value: string): asserts value is DimensionType {
  if (!(VALID_DIMENSION_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid dimensionType: ${value}. Must be one of: ${VALID_DIMENSION_TYPES.join(", ")}`,
    );
  }
}

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

// Drizzle DB shape used by the internal helpers. We intentionally keep this
// loose so the test harness (node-postgres driver) and prod (postgres-js
// driver) can both pass through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ---------------------------------------------------------------------------
// Internal helpers — take an explicit actor + db. Used directly by tests.
// ---------------------------------------------------------------------------

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

  // Fetch the target row so we know which user it belongs to (for the
  // external-user invariant) and what to write into the audit log.
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

  // External-user invariant: refuse to remove the last scope.
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

  await db
    .delete(userScopes)
    .where(and(eq(userScopes.id, scopeId)));

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

// ---------------------------------------------------------------------------
// Public server actions — gate on admin role, delegate to internal helpers.
// ---------------------------------------------------------------------------

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
