import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export type Role = "admin" | "member" | "viewer";

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

export function canAccessSensitiveFields(role: string): boolean {
  // LOCKED DECISION: Admin + Member can see/edit; Viewer sees redacted
  return role === "admin" || role === "member";
}

export function redactSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  role: string
): T {
  if (canAccessSensitiveFields(role)) return data;
  return {
    ...data,
    bankingDetails: null,
    contractValue: null,
    contractTerms: null,
    contractDocuments: null,
  };
}
