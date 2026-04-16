"use server";

import { z } from "zod/v4";
import { auth } from "@/lib/auth";
import { requireRole, type Role } from "@/lib/rbac";
import { headers } from "next/headers";

const emailSchema = z.email("Invalid email address");
const roleSchema = z.enum(["admin", "member", "viewer"]);

export async function inviteUser(email: string, role: Role) {
  try {
    await requireRole("admin");

    const validatedEmail = emailSchema.parse(email);
    const validatedRole = roleSchema.parse(role);

    const createResult = await auth.api.createUser({
      body: {
        email: validatedEmail,
        role: "user", // Better Auth only accepts "user" | "admin" at creation
        name: "",
        password: crypto.randomUUID(), // Temporary password — user sets via reset link
      },
      headers: await headers(),
    });

    // Set the actual role after creation (Better Auth createUser only supports "user"|"admin")
    const created = createResult as Record<string, unknown> | null;
    const userId =
      (created?.id as string) ??
      ((created?.user as Record<string, unknown>)?.id as string);
    if (userId) {
      await auth.api.setRole({
        body: { userId, role: validatedRole as "user" | "admin" },
        headers: await headers(),
      });
    }

    // The password reset email IS the invite email (per RESEARCH.md Pattern 5)
    await auth.api.requestPasswordReset({
      body: {
        email: validatedEmail,
        redirectTo: "/set-password",
      },
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to invite user";
    return { error: message };
  }
}

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  createdAt: Date;
};

export async function listUsers(): Promise<
  { users: UserListItem[] } | { error: string }
> {
  try {
    await requireRole("admin");

    const result = await auth.api.listUsers({
      headers: await headers(),
      query: { limit: 100 },
    });

    const users: UserListItem[] = (result.users ?? []).map((u) => ({
      id: u.id,
      name: u.name || "",
      email: u.email,
      role: (u.role as string) || "member",
      banned: !!(u.banned),
      createdAt: new Date(u.createdAt),
    }));

    return { users };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list users";
    return { error: message };
  }
}

export async function changeUserRole(userId: string, newRole: Role) {
  try {
    await requireRole("admin");

    const validatedRole = roleSchema.parse(newRole);

    await auth.api.setRole({
      body: { userId, role: validatedRole as "user" | "admin" },
      headers: await headers(),
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to change role";
    return { error: message };
  }
}

export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; role?: string }
) {
  try {
    await requireRole("admin");

    // Update name/email via direct DB update (Better Auth admin API updateUser is unreliable for these fields)
    const { db } = await import("@/db");
    const { user } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) {
      emailSchema.parse(data.email);
      updates.email = data.email;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(user).set(updates).where(eq(user.id, userId));
    }

    // Role change via Better Auth API
    if (data.role) {
      const validatedRole = roleSchema.parse(data.role);
      await auth.api.setRole({
        body: { userId, role: validatedRole as "user" | "admin" },
        headers: await headers(),
      });
    }

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update user";
    return { error: message };
  }
}

export async function deactivateUser(userId: string) {
  try {
    await requireRole("admin");

    // LOCKED DECISION: deactivate only, no permanent deletion — records preserved for audit trail
    await auth.api.banUser({
      body: { userId, banReason: "Deactivated by admin" },
      headers: await headers(),
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to deactivate user";
    return { error: message };
  }
}

export async function reactivateUser(userId: string) {
  try {
    await requireRole("admin");

    await auth.api.unbanUser({
      body: { userId },
      headers: await headers(),
    });

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reactivate user";
    return { error: message };
  }
}

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

    await auth.api.removeUser({
      body: { userId },
      headers: await headers(),
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // FK constraint = user is referenced by locations, audit logs, etc.
    if (message.includes("foreign key") || message.includes("violates") || message.includes("constraint")) {
      return { error: "Cannot delete this user — they are referenced by locations or other records. Deactivate them instead." };
    }
    return { error: "Failed to delete user" };
  }
}

export async function bulkDeleteUsers(userIds: string[]) {
  try {
    await requireRole("admin");

    const { db } = await import("@/db");
    const { session, account, userViews } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    let deleted = 0;
    const skipped: string[] = [];
    for (const userId of userIds) {
      try {
        await db.delete(session).where(eq(session.userId, userId));
        await db.delete(account).where(eq(account.userId, userId));
        await db.delete(userViews).where(eq(userViews.userId, userId));
        await auth.api.removeUser({
          body: { userId },
          headers: await headers(),
        });
        deleted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("foreign key") || msg.includes("violates") || msg.includes("constraint")) {
          skipped.push(userId);
        } else {
          throw err;
        }
      }
    }

    if (skipped.length > 0 && deleted === 0) {
      return { error: "Cannot delete — all selected users are referenced by locations or other records. Deactivate them instead." };
    }
    if (skipped.length > 0) {
      return { success: true, count: deleted, warning: `${skipped.length} user(s) skipped — referenced by other records` };
    }
    return { success: true, count: deleted };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete users";
    return { error: message };
  }
}

export async function bulkDeactivateUsers(userIds: string[]) {
  try {
    await requireRole("admin");

    let deactivated = 0;
    for (const userId of userIds) {
      await auth.api.banUser({
        body: { userId, banReason: "Deactivated by admin" },
        headers: await headers(),
      });
      deactivated++;
    }

    return { success: true, count: deactivated };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to deactivate users";
    return { error: message };
  }
}
