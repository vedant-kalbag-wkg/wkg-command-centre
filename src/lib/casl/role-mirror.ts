import { eq, and } from "drizzle-orm";
import { roles, user, userRoles } from "@/db/schema";

type AnyDb = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Refreshes the denormalised `user.role` text column to match the user's
 * primary tier assignment in `user_roles`.
 *
 * The `user.role` column is a Better Auth plugin column used for
 * fast session-level checks (e.g. requireRole()). It must stay in sync
 * with `user_roles` whenever role assignments change.
 *
 * Sync logic:
 *  1. If the user has a `kind='system'` role assignment → role = "admin"
 *  2. Else find the highest-privilege tier role (admin > ops-it > read-only)
 *     and map it: admin → "admin", ops-it → "member", read-only → "viewer"
 *  3. If no role assignment exists → role = null
 *
 * Accepts an optional `db` argument so callers inside a transaction can
 * pass the transaction client, keeping the write atomic with other changes.
 */
export async function refreshUserRoleMirror(
  userId: string,
  db?: AnyDb,
): Promise<void> {
  const { db: defaultDb } = await import("@/db");
  const client: AnyDb = db ?? defaultDb;

  // Fetch all role assignments for this user, joined with the role record.
  const assignments = await client
    .select({
      kind: roles.kind,
      name: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  let mirroredRole: string | null = null;

  if (assignments.length === 0) {
    mirroredRole = null;
  } else {
    // System role wins unconditionally.
    const hasSystem = assignments.some((a: { kind: string }) => a.kind === "system");
    if (hasSystem) {
      mirroredRole = "admin";
    } else {
      // Find highest-privilege tier: admin > ops-it > read-only
      const nameSet = new Set(assignments.map((a: { name: string }) => a.name));
      if (nameSet.has("admin")) {
        mirroredRole = "admin";
      } else if (nameSet.has("ops-it")) {
        mirroredRole = "member";
      } else if (nameSet.has("read-only")) {
        mirroredRole = "viewer";
      } else {
        // Custom roles — mirror as null. Writing the raw custom role name is
        // unsafe: a custom role named "admin" would mirror to user.role="admin"
        // granting manage:all via the system short-circuit in ability.ts.
        // Custom roles carry no text-mirror privilege; ability is derived from
        // user_roles + role_permissions at build time.
        mirroredRole = null;
      }
    }
  }

  await client
    .update(user)
    .set({ role: mirroredRole, updatedAt: new Date() })
    .where(eq(user.id, userId));
}
