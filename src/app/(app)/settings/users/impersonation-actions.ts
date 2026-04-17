"use server";

import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const COOKIE_USER_ID = "impersonating_user_id";
const COOKIE_USER_NAME = "impersonating_user_name";
const MAX_AGE = 3600; // 1 hour

export async function startImpersonation(targetUserId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Auth check — current user must be admin
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { success: false, error: "Not authenticated" };

    const currentRole = (session.user.role as string) ?? "member";
    if (currentRole !== "admin") return { success: false, error: "Forbidden — admin only" };

    // 2. Lookup target user
    const [target] = await db
      .select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);

    if (!target) return { success: false, error: "Target user not found" };
    if (target.id === session.user.id) return { success: false, error: "Cannot impersonate yourself" };
    if (target.role === "admin") return { success: false, error: "Cannot impersonate another admin" };
    if (target.banned) return { success: false, error: "Cannot impersonate a banned user" };

    // 3. Set httpOnly cookies
    const cookieStore = await cookies();
    const cookieOptions = {
      maxAge: MAX_AGE,
      path: "/",
      sameSite: "strict" as const,
      httpOnly: true,
    };

    cookieStore.set(COOKIE_USER_ID, target.id, cookieOptions);
    cookieStore.set(COOKIE_USER_NAME, target.name || target.id, cookieOptions);

    // 4. Audit log
    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name || session.user.email,
      entityType: "impersonation",
      entityId: target.id,
      entityName: target.name || target.id,
      action: "start_impersonation",
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start impersonation";
    return { success: false, error: message };
  }
}

export async function stopImpersonation(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const cookieStore = await cookies();

    const targetId = cookieStore.get(COOKIE_USER_ID)?.value ?? "unknown";
    const targetName = cookieStore.get(COOKIE_USER_NAME)?.value ?? "unknown";

    // 1. Delete impersonation cookies
    cookieStore.delete(COOKIE_USER_ID);
    cookieStore.delete(COOKIE_USER_NAME);

    // 2. Audit log
    if (session?.user) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name || session.user.email,
        entityType: "impersonation",
        entityId: targetId,
        entityName: targetName,
        action: "stop_impersonation",
      });
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop impersonation";
    return { success: false, error: message };
  }
}
