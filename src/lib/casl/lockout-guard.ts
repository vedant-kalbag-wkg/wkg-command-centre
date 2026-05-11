import { eq, and, or } from "drizzle-orm";
import { roles, user, userRoles } from "@/db/schema";

type AnyDb = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LockoutGuardOptions {
  /**
   * The userId that is about to lose admin access (being removed or demoted).
   * The guard excludes this user from the effective-admin count.
   */
  excludeUserId?: string;
}

/**
 * Sentinel error thrown when an operation would remove the last effective admin.
 *
 * Callers should catch this specifically:
 *   try { await assertAtLeastOneEffectiveAdmin(db); }
 *   catch (e) { if (e instanceof Error && e.message === "LOCKOUT_PREVENTION") ... }
 */
export const LOCKOUT_PREVENTION = "LOCKOUT_PREVENTION" as const;

/**
 * Asserts that at least one active admin will remain after a role change.
 *
 * "Effective admin" = a non-banned user with a system-kind or admin-named
 * role assignment (the same set that gets `manage all` in buildAbility).
 *
 * Throws Error("LOCKOUT_PREVENTION") if the guard would trip.
 * No-ops when more than one effective admin remains after the exclusion.
 *
 * @param db   Drizzle client or transaction — accepts AnyDb for tx support.
 * @param opts Optional exclusion options.
 */
export async function assertAtLeastOneEffectiveAdmin(
  db: AnyDb,
  opts: LockoutGuardOptions = {},
): Promise<void> {
  // Join user_roles → roles → user to find non-banned admins.
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(user, eq(userRoles.userId, user.id))
    .where(
      and(
        // Either a system-kind role or one literally named "admin"
        or(eq(roles.kind, "system"), eq(roles.name, "admin")),
        eq(user.banned, false),
      ),
    );

  // Filter out the user that would be losing access.
  const remaining = opts.excludeUserId
    ? rows.filter((r: { userId: string }) => r.userId !== opts.excludeUserId)
    : rows;

  if (remaining.length === 0) {
    throw new Error(LOCKOUT_PREVENTION);
  }
}
