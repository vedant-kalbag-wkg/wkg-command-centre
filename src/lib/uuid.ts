/**
 * Phase 9.1 gap closure (CR-01 / WR-04) — centralised UUID-shape validator.
 *
 * URL `searchParams` -> `parseIdParam` -> SQL builder paths in analytics pages
 * MUST gate ids through `isUuid` (or `assertUuidArray`) before the strings reach
 * Drizzle. RFC 4122 form, case-insensitive. Variants 1-5 accepted (the app
 * generates v4 via Postgres `gen_random_uuid()`, but auth tables seed test
 * fixtures with v1).
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function assertUuid(value: string): asserts value is string {
  if (!isUuid(value)) {
    throw new Error("Invalid UUID: " + JSON.stringify(value));
  }
}

export function assertUuidArray(values: string[]): asserts values is string[] {
  for (const v of values) {
    if (!isUuid(v)) {
      throw new Error("Invalid UUID in array: " + JSON.stringify(v));
    }
  }
}
