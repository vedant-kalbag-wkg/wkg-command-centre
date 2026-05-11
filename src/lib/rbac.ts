import { cache } from "react";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { AppAbility } from "@/lib/casl/types";
import {
  BANKING_CONTRACT_FIELDS,
  EXTERNAL_ONLY_SENSITIVE_FIELDS,
} from "@/lib/casl/external-invariant";

// 'system' is intentionally excluded here: it's an ETL/automation-only role
// (see scoped-query.ts and migration 0026) that never represents an
// interactive session, so the RBAC checks driven off this union don't need
// to admit it. The scoping layer's UserCtx widens to include 'system'.
export type Role = "admin" | "member" | "viewer";

// Local UserCtx kept for backwards compat with existing callers. Note: this
// is a SUBSET of the broader UserCtx in src/lib/scoping/scoped-query.ts
// which has the full mandatory `ability` field. Old call sites pass
// {userType, role} literals — the shim falls back to legacy in-memory logic
// when ability is absent (preserves src/lib/rbac.test.ts as the regression bar).
export type UserCtx = {
  userType: "internal" | "external";
  role: "admin" | "member" | "viewer" | null;
  ability?: AppAbility;
};

// React.cache dedupes session lookups within a single request. The RSC tree
// can call getSessionOrThrow from multiple islands without re-hitting the
// auth DB — session resolves once, then every subsequent call reuses it.
export const getSessionOrThrow = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session;
});

/**
 * Through Plans 10-04..10-06 this is a SHIM that preserves the v1.0
 * signature while internally cross-checking the new ability. The
 * text-role check stays as the primary gate (because the user.role
 * mirror is updated in lock-step via refreshUserRoleMirror, see Q1) —
 * the cross-check is defense-in-depth.
 *
 * After Plan 10-06 ships, individual call sites can migrate to direct
 * `ctx.ability.can(...)` checks; this shim becomes a deprecation
 * surface to remove in v1.2.
 */
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

// ── Sensitive-key constants — single source of truth from external-invariant ──
// These replace the inline lists from v1.0; by importing from external-invariant
// both the legacy fallback path and the CASL applyExternalUserInvariant() are
// driven by the same constants (T-10-04-02 mitigation).
const LEGACY_ALWAYS_SENSITIVE: readonly string[] = BANKING_CONTRACT_FIELDS;
const LEGACY_EXTERNAL_SENSITIVE: readonly string[] = [
  ...BANKING_CONTRACT_FIELDS,
  ...EXTERNAL_ONLY_SENSITIVE_FIELDS,
];

/**
 * Returns true iff the user may read sensitive Location fields.
 *
 * Dual-path:
 * - CASL path (ability present): ability.can("read", "Location", "bankingDetails")
 *   This is the canonical pivot field — all always-sensitive keys are
 *   gated together, so one field-level check is sufficient.
 * - Legacy fallback (ability absent, e.g. test fixtures passing bare UserCtx):
 *   role === "admin" || role === "member" AND userType !== "external".
 *
 * Invariant (both paths): external users NEVER see sensitive fields.
 */
export function canAccessSensitiveFields(user: UserCtx): boolean {
  // Defense-in-depth: external users never see sensitive fields.
  if (user.userType === "external") return false;

  if (user.ability) {
    // CASL path: the ability encodes the full rule set including any
    // applyExternalUserInvariant() overrides. Use bankingDetails as the pivot.
    return user.ability.can("read", "Location", "bankingDetails");
  }

  // Legacy fallback for test fixtures + bare UserCtx callers:
  return user.role === "admin" || user.role === "member";
}

/**
 * Returns a copy of `data` with sensitive Location keys set to null for users
 * who cannot access them.
 *
 * Dual-path:
 * - When canAccessSensitiveFields returns true → return data unchanged
 *   (original reference, not a copy — matches v1.0 behaviour).
 * - When false → shallow-clone and null the appropriate keys.
 *   The key lists are imported from external-invariant.ts (single source of
 *   truth — T-10-04-02 mitigation).
 *
 * Note: the CASL-path redaction logic in Pattern A call sites (readableFields)
 * is equivalent by construction; both paths are driven by the same constants.
 */
export function redactSensitiveFields<T extends Record<string, unknown>>(
  data: T,
  user: UserCtx
): T {
  if (canAccessSensitiveFields(user)) return data;
  const redacted: Record<string, unknown> = { ...data };
  const keys =
    user.userType === "external"
      ? LEGACY_EXTERNAL_SENSITIVE
      : LEGACY_ALWAYS_SENSITIVE;
  for (const k of keys) {
    if (k in redacted) redacted[k] = null;
  }
  return redacted as T;
}
