import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export type Role = "admin" | "member" | "viewer";

export type UserCtx = {
  userType: "internal" | "external";
  role: "admin" | "member" | "viewer" | null;
};

export async function getSessionOrThrow() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function requireRole(...roles: Role[]) {
  const session = await getSessionOrThrow();
  if (!roles.includes(session.user.role as Role)) {
    throw new Error("Forbidden");
  }
  return session;
}

export function isAdmin(role: string): boolean {
  return role === "admin";
}

export function canAccessSensitiveFields(user: UserCtx): boolean {
  // Invariant: external users never see sensitive fields, regardless of role.
  if (user.userType === "external") return false;
  // Internal: admin + member can see/edit; viewer sees redacted.
  return user.role === "admin" || user.role === "member";
}

export function redactSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  user: UserCtx
): T {
  if (canAccessSensitiveFields(user)) return data;
  const redacted: Record<string, unknown> = { ...data };
  const sensitiveKeys: string[] = [
    "bankingDetails",
    "contractValue",
    "contractTerms",
    "contractDocuments",
  ];
  if (user.userType === "external") {
    sensitiveKeys.push(
      "keyContactName",
      "keyContactEmail",
      "financeContact",
      "maintenanceFee"
    );
  }
  for (const k of sensitiveKeys) {
    if (k in redacted) redacted[k] = null;
  }
  return redacted as T;
}
