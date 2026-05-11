import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility } from "./types";

/**
 * Sensitive fields that external users MUST NEVER access, regardless of
 * any explicit can() rules.  Split into two categories:
 *
 * Banking / contract — also blocked for internal viewers:
 */
export const BANKING_CONTRACT_FIELDS = [
  "bankingDetails",
  "contractValue",
  "contractTerms",
  "contractDocuments",
] as const;

/**
 * Contact / maintenance — blocked for external users only; internal
 * viewers may still read these.
 */
export const EXTERNAL_ONLY_SENSITIVE_FIELDS = [
  "keyContactName",
  "keyContactEmail",
  "financeContact",
  "maintenanceFee",
] as const;

/** Union of all fields blocked for external users. */
export const ALL_EXTERNAL_SENSITIVE_FIELDS = [
  ...BANKING_CONTRACT_FIELDS,
  ...EXTERNAL_ONLY_SENSITIVE_FIELDS,
] as const;

type UserType = "internal" | "external" | "system" | null | undefined;

/**
 * Appends cannot() rules to the builder that deny access to sensitive
 * Location fields for external (or unknown) users.
 *
 * Call this LAST before build() — CASL deny-wins, so these cannot() rules
 * override any earlier can() grants.
 *
 * - userType "internal" or "system" → no-op (invariant does not apply)
 * - userType "external", null, or undefined → blocks ALL sensitive fields
 */
export function applyExternalUserInvariant(
  builder: Pick<AbilityBuilder<AppAbility>, "cannot">,
  userType: UserType,
): void {
  // Only internal and system users are exempt from the invariant.
  // null / undefined / "external" all fall through to the deny block.
  if (userType === "internal" || userType === "system") return;

  // Block all sensitive Location fields for external / anonymous users.
  builder.cannot("read", "Location", [...ALL_EXTERNAL_SENSITIVE_FIELDS]);
}
