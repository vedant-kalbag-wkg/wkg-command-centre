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
