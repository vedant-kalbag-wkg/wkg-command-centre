/**
 * Phase 07-06 — DEPRECATED.
 *
 * This script enriched `locations` rows with Monday-sourced address /
 * region / hotel-group data, keyed by the now-removed `locations.outlet_code`.
 * Migration 0040 dropped that column; the v2 runbook
 * (`scripts/v2-wipe-and-reseed.ts`) re-derives every `locations` row from
 * Monday at reseed time using the new `mondayItemId` idempotency key, so
 * enrichment is no longer a separate step — it's part of the structural
 * reseed.
 *
 * Kept as a hard-fail stub so the `db:enrich:locations` npm script
 * surfaces a clear deprecation message rather than silently failing on a
 * dropped column reference.
 */

console.error(
  "scripts/enrich-locations-from-monday.ts is deprecated post-Phase-07-06. " +
    "Re-derive locations via the v2 wipe-and-reseed runbook instead: " +
    "`npx tsx scripts/v2-wipe-and-reseed.ts --apply`.",
);
process.exit(2);
