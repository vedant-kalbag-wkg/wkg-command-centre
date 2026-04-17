import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import type { UserCtx } from "@/lib/scoping/scoped-query";

export async function getUserCtx(): Promise<UserCtx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  const cookieStore = await cookies();
  const impersonatingId = cookieStore.get("impersonating_user_id")?.value;

  if (impersonatingId && (session.user.role as string) === "admin") {
    const { db } = await import("@/db");
    const { user } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [target] = await db
      .select({ id: user.id, userType: user.userType, role: user.role })
      .from(user)
      .where(eq(user.id, impersonatingId))
      .limit(1);

    if (target) {
      return {
        id: target.id,
        userType: (target.userType ?? "internal") as "internal" | "external",
        role: (target.role ?? null) as "admin" | "member" | "viewer" | null,
      };
    }
  }

  return {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as "admin" | "member" | "viewer" | null,
  };
}
