/**
 * Phase 07-06 — DEPRECATED.
 *
 * This script's logic was tied to `locations.outlet_code` (now removed by
 * migration 0040). The same diagnostic shape now lives inside
 * `scripts/v2-wipe-and-reseed.ts` (Phase 1 step 5b's hotelsSkipped /
 * placeholdersSkippedNoRegion counters) and the per-step logger output. If
 * you need a read-only audit of which Monday hotels would be skipped against
 * the current DB, run the wipe-and-reseed in dry-run mode (`npx tsx
 * scripts/v2-wipe-and-reseed.ts` without `--apply`).
 *
 * Kept as a hard-fail stub so the package.json `db:import:monday`-adjacent
 * shape keeps tsc / npm-script discovery working without reintroducing the
 * dropped column references.
 */

console.error(
  "scripts/dump-skipped-monday-hotels.ts is deprecated post-Phase-07-06. " +
    "Run `npx tsx scripts/v2-wipe-and-reseed.ts` (dry-run) for the same diagnostics.",
);
process.exit(2);
