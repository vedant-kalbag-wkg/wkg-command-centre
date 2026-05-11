import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { type AppAbility } from "./types";
import {
  BANKING_CONTRACT_FIELDS,
  EXTERNAL_ONLY_SENSITIVE_FIELDS,
  applyExternalUserInvariant,
} from "./external-invariant";

/**
 * Canonical role names as stored in the DB (kind column on roles table).
 * Legacy UI labels (member → ops-it, viewer → read-only) are accepted as
 * aliases for backwards-compatibility with existing callers and test fixtures.
 */
type CanonicalRole = "admin" | "ops-it" | "read-only";

/** Legacy role aliases — accepted alongside canonical names. */
type LegacyRole = "member" | "viewer";

type AnyRole = CanonicalRole | LegacyRole | null | undefined;
type UserType = "internal" | "external" | null | undefined;

/** Normalise legacy role aliases to canonical names. */
function normaliseRole(role: AnyRole): CanonicalRole | null {
  if (!role) return null;
  if (role === "member") return "ops-it";
  if (role === "viewer") return "read-only";
  return role as CanonicalRole;
}

/**
 * Builds a seeded AppAbility for a given role + userType combination WITHOUT
 * hitting the database.  Used in tests, Storybook, and seed scripts.
 *
 * Mirrors the exact access semantics enforced by buildAbility() for DB-backed
 * abilities — this is the single source of truth for field-level rule logic.
 *
 * Invariant: applyExternalUserInvariant is ALWAYS applied last so that
 * cannot() rules override any earlier can() grants (CASL deny-wins).
 */
export function buildSeededAbility(role: AnyRole, userType: UserType): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const canonical = normaliseRole(role);

  // --- System short-circuit ---
  if (canonical === null && userType === "system") {
    can("manage", "all");
    return build();
  }

  // --- Admin: full access to everything ---
  if (canonical === "admin") {
    can("manage", "all");
    applyExternalUserInvariant({ cannot }, userType);
    return build();
  }

  if (canonical === "ops-it") {
    // --- ops-it (member): manage everything; can read all Location fields
    //     (external invariant will strip sensitive fields if userType=external)
    can("manage", "all");
    applyExternalUserInvariant({ cannot }, userType);
    return build();
  }

  if (canonical === "read-only") {
    // --- read-only (viewer): broad read access; cannot manage most things;
    //     banking/contract fields blocked; contacts/maintenance allowed for
    //     internal users (external invariant strips them if userType=external).
    can("read", "all");

    // Block banking/contract for ALL viewers regardless of userType
    cannot("read", "Location", [...BANKING_CONTRACT_FIELDS]);

    // Apply external invariant (strips contacts/maintenance for external users)
    applyExternalUserInvariant({ cannot }, userType);
    return build();
  }

  // --- null / unknown role: read-only on safe fields only ---
  // Treat as the most restricted non-guest case.
  can("read", "all");
  cannot("read", "Location", [...BANKING_CONTRACT_FIELDS]);
  cannot("read", "Location", [...EXTERNAL_ONLY_SENSITIVE_FIELDS]);
  applyExternalUserInvariant({ cannot }, userType);
  return build();
}
