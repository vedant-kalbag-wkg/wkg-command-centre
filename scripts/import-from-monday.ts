/**
 * Phase 07-06 — DEPRECATED.
 *
 * This was the v1 Monday → locations / kiosks importer, keyed by the now-
 * removed `locations.outlet_code`. The v2 path is `runHotelLocationImport`
 * + `runHeathrowImport` + `runAssetsImport` (stamping `monday_item_id` and
 * `customer_code`), all orchestrated by `scripts/v2-wipe-and-reseed.ts`.
 *
 * Kept as a hard-fail stub so the `db:import:monday` npm script surfaces
 * a clear deprecation message rather than silently failing on a dropped
 * column reference.
 */

console.error(
  "scripts/import-from-monday.ts is deprecated post-Phase-07-06. " +
    "Use the v2 wipe-and-reseed runbook: " +
    "`npx tsx scripts/v2-wipe-and-reseed.ts --apply`.",
);
process.exit(2);
