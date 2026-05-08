/**
 * Phase 07-06 — DEPRECATED.
 *
 * This script created stub `locations` rows by `outlet_code` for sales-CSV
 * outlets that didn't already have a matching location. With outlet_code
 * removed from `locations` and the v2 dimension-resolver now routing
 * unmatched sales rows to the LOCATION_NEEDED sentinel for operator triage
 * via the merge UI, the "create a stub" flow is gone — the sentinel +
 * merge primitive (Plan 07-03) is the canonical path.
 *
 * Kept as a hard-fail stub so callers see a clear deprecation message.
 */

console.error(
  "scripts/stub-missing-outlets.ts is deprecated post-Phase-07-06. " +
    "Unmatched outlets now route to the LOCATION_NEEDED sentinel; triage " +
    "via the merge UI at /settings/duplicates.",
);
process.exit(2);
