import { createHash } from "node:crypto";

/**
 * Returns the SHA-256 hex digest of the given UTF-8 string.
 * Used to produce idempotency keys keyed on (poc_user_id, run_iso_week).
 */
export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
