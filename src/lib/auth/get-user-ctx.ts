import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { UserCtx } from "@/lib/scoping/scoped-query";

export async function getUserCtx(): Promise<UserCtx> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  return {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as "admin" | "member" | "viewer" | null,
  };
}
