/**
 * Phase 7 / Plan B — wipe-and-reseed runbook (DATA-01 / DATA-04 / DATA-05).
 *
 * One advisory lock, one operator command. Re-derives the Monday-sourced +
 * sales-sourced + temporal wipe-set from Monday hotel boards and
 * `seed_data/*.csv`, ensures the LOCATION_NEEDED sentinel, then spawns
 * `scripts/backfill-kiosk-install-dates.ts --apply` for the two-pass
 * `assigned_at` rule.
 *
 * Two-phase transaction shape (Neon storage / WAL pressure forces this):
 *   PHASE 1 — Structural reseed (single atomic transaction): wipe + ensure
 *     GLOBAL/sentinel + hotel-location import + commission-tier import +
 *     audit log. Either all of it lands or none of it does.
 *   PHASE 2 — Sales ETL (one transaction per seed CSV): each CSV is staged
 *     + committed independently and idempotently (sourceHash dedup blocks
 *     re-imports of the same bytes). Mid-run failure leaves successful
 *     CSVs committed and the runbook recoverable by re-invocation against
 *     the remaining files.
 *
 * Run:
 *   Dry-run (each phase wraps work in BEGIN; ROLLBACK):
 *     DATABASE_URL=... MONDAY_API_TOKEN=... npx tsx scripts/v2-wipe-and-reseed.ts
 *   Apply:
 *     DATABASE_URL=... MONDAY_API_TOKEN=... npx tsx scripts/v2-wipe-and-reseed.ts --apply
 *   Apply with a CSV cap (validates the pipeline against constrained UAT):
 *     ... npx tsx scripts/v2-wipe-and-reseed.ts --apply --max-csv 1
 *
 * Source of truth for wipe vs preserve sets: `.planning/notes/v2-data-reset-decision.md`.
 *
 * Lock key 738294107 — distinct from 738294105 (Azure ETL) and 738294106
 * (Monday import) so a runbook execution cannot collide with either.
 */

import { execSync } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import {
  _commitImportForActor,
  _stageImportForActor,
  type ImportActor,
} from "@/app/(app)/settings/data-import/sales/pipeline";
import { ETL_AZURE_LOCK_KEY } from "@/lib/sales/etl/advisory-lock";
import { LocalFileSource } from "@/lib/sales/local-file-source";
import { iterateBoardItems } from "@/lib/monday/client";
import { runAssetsImport } from "@/lib/monday/import-assets";
import { runHeathrowImport } from "@/lib/monday/import-heathrow";
import {
  runHotelLocationImport,
  SSM_GROUPS_BOARD_ID,
} from "@/lib/monday/import-hotel-locations";
import { runMondayImport } from "@/lib/monday/import-location-products";
import { normaliseName } from "@/lib/normalise";
import {
  LOCATION_NEEDED_ADDRESS,
  LOCATION_NEEDED_NAME,
  SENTINEL_REGION_CODE,
} from "@/lib/sentinel";

const APPLY = process.argv.includes("--apply");
const LOCK_KEY = 738_294_107; // wipe runbook
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// `--max-csv N` caps how many seed_data CSVs Phase 2 ingests. Useful when
// running on a Neon UAT branch where the project storage cap blocks the
// full corpus. Omitted = no cap (production cutover).
const maxCsvIdx = process.argv.indexOf("--max-csv");
const MAX_CSV =
  maxCsvIdx >= 0 ? Number.parseInt(process.argv[maxCsvIdx + 1] ?? "", 10) : NaN;

// Sanity guard — make sure we're not accidentally re-using the existing keys.
// Cheap; prevents a copy-paste mistake from silently sharing a lock. Wrapped
// in Number() to widen the literal narrow type so the equality comparison
// type-checks across the three branded keys.
if (
  Number(LOCK_KEY) === ETL_AZURE_LOCK_KEY ||
  Number(LOCK_KEY) === 738_294_106
) {
  throw new Error(
    `LOCK_KEY collision (${LOCK_KEY}) — runbook must use a distinct advisory lock`,
  );
}

// Wipe set — FK children before parents. TRUNCATE CASCADE handles any
// edges we missed; explicit ordering still helps the dry-run log read
// cleanly.
//
// `regions` is PRESERVED — keeps UUIDs stable across reseeds, and the
// preserved `outlet_exclusions` row holds a FK to regions. This means
// `markets` MUST also be preserved: `regions.market_id → markets.id`, so
// `TRUNCATE markets CASCADE` would drag regions down with it. Markets had 0
// rows in the Plan A snapshot anyway, so wiping it earned nothing.
const WIPE_TABLES = [
  "audit_logs",
  "import_stagings",
  "sales_records",
  "sales_imports",
  "sales_blob_ingestions",
  "product_code_fallbacks",
  "commission_ledger",
  "merge_proposals",
  "weather_cache",
  "location_flags",
  "kiosk_assignments",
  "location_products",
  "location_region_memberships",
  "location_group_memberships",
  "location_hotel_group_memberships",
  "installation_kiosks",
  "installation_members",
  "milestones",
  "installations",
  "kiosks",
  "locations",
  "products",
  "providers",
  "location_groups",
  "hotel_groups",
  "business_events",
  "event_log",
];

// Group-title → region code mapper. Monday hotel boards partition items into
// groups whose titles encode region (e.g. "Live: UK Hotels", "Removed Spain",
// "Waiting to Launch - GERMANY"). Patterns are evaluated in order; first
// match wins. Returns null when the title doesn't match any known region —
// the importer counts these and the runbook surfaces them at end-of-run.
const GROUP_TITLE_REGION_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /\b(uk|united kingdom|england|british)\b/i, code: "UK" },
  { re: /\b(ireland|irish|\bie\b)\b/i, code: "IE" },
  { re: /\b(spain|spanish|canary)\b/i, code: "ES" },
  { re: /\b(germany|german)\b/i, code: "DE" },
  { re: /\b(czech|prague|praha)\b/i, code: "CZ" },
  { re: /\b(australia|australian)\b/i, code: "AU" },
];

function mapGroupTitleToRegionCode(title: string): string | null {
  for (const { re, code } of GROUP_TITLE_REGION_PATTERNS) {
    if (re.test(title)) return code;
  }
  return null;
}

// Filename → (regionCode, blobDate) for seed_data/*.csv. Matches the
// production filename convention: `<2-letter-region>_<source>_<period>.csv`,
// e.g. `GB_WKG_NetS_Jan2026.csv` → region UK, blobDate 2026-01-31.
// Region code maps GB→UK to align with the regions table; other 2-letter
// prefixes map 1:1 to the corresponding region code. The middle source
// segment is mixed-case ("NetS") so we accept any letters there — only the
// region prefix and the month-name shape are strict.
// Canonical NetSuite fee fallbacks. The historical prod sales corpus ships
// rows with empty `Code` for `Booking Fee` and `Cash Handling Fee` (the
// upstream NetSuite export elides the SKU on WKG-collected fee rows). The
// dimension resolver requires Code unless the parser finds a fallback in
// `product_code_fallbacks`. These two mappings are the source-of-truth for
// the WKG fee codes (see `src/lib/csv/sales-csv.ts` line 180-183 + the 9991
// / 9992 references across `commission/processor.ts`, `analytics/pivot-engine.ts`).
// Without seeding these into product_code_fallbacks the v2 reseed rejects
// ~50% of the prod-canonical Jan2026 corpus (47k of 95k rows) at staging.
const CANONICAL_FEE_FALLBACKS: Array<{ productName: string; netsuiteCode: string }> = [
  { productName: "Booking Fee", netsuiteCode: "9991" },
  { productName: "Cash Handling Fee", netsuiteCode: "9992" },
];

const SEED_FILENAME_RE =
  /^([A-Z]{2})_[A-Za-z_]+_([A-Z][a-z]{2})(\d{4})\.csv$/;
const MONTH_NAME_TO_NUM: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
const SEED_REGION_PREFIX_MAP: Record<string, string> = { GB: "UK" };

function parseSeedFilename(
  filename: string,
): { regionCode: string; blobDate: string } | null {
  const m = SEED_FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, prefix, monthName, year] = m;
  const month = MONTH_NAME_TO_NUM[monthName];
  if (!month) return null;
  // Last day of the named month — same as Azure path's day-precision YYYY/MM/DD.
  const lastDay = new Date(Number(year), month, 0).getDate();
  const blobDate =
    `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return {
    regionCode: SEED_REGION_PREFIX_MAP[prefix] ?? prefix,
    blobDate,
  };
}

const RUNBOOK_ACTOR: ImportActor = {
  id: ETL_SYSTEM_USER_ID,
  name: "System (v2-wipe-and-reseed)",
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const mondayApiToken = process.env.MONDAY_API_TOKEN;
  if (!mondayApiToken) throw new Error("MONDAY_API_TOKEN not set");

  // Surface the target host so the operator can sanity-check before --apply.
  // Strip credentials before logging.
  const safeHost = (() => {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname}`;
    } catch {
      return "<unparseable DATABASE_URL>";
    }
  })();

  console.log(`Mode: ${APPLY ? "APPLY (will COMMIT)" : "DRY-RUN (will ROLLBACK)"}`);
  console.log(`Target: ${safeHost}`);
  console.log(`Lock key: ${LOCK_KEY}`);

  const pool = new Pool({ connectionString: url });
  // `let` not `const`: Phase 2 swaps to a fresh PoolClient post-Phase-1-COMMIT
  // because Neon kills the long-held connection mid-95k-row INSERT (Phase 1's
  // Monday GraphQL fan-out can hold this client for 5-10 min, and Phase 2's
  // chunked sales commit doubles that — net effect is "Connection terminated
  // unexpectedly" partway through the transaction. Swap point: line ~424.
  let client: PoolClient = await pool.connect();

  // Disable Postgres' idle-in-transaction killer for this session — Monday
  // GraphQL roundtrips inside the transaction can exceed the default 5-min
  // ceiling on Neon. Set on the session (not SET LOCAL) because the killer
  // fires on the SESSION timer, not the transaction's.
  await client.query(`SET idle_in_transaction_session_timeout = 0`);

  // Drizzle wrapper PINNED to `client`, not `pool`. Critical: the importers
  // (runHotelLocationImport, runMondayImport, _stageImportForActor) must run
  // their queries on the same connection that holds the BEGIN/TRUNCATE so
  // they see the uncommitted wipe state. Passing the Pool would let drizzle
  // check out a different connection and miss the wipe entirely (and race
  // against COMMIT/ROLLBACK).
  // Cast through `unknown` because the prod app type uses `postgres-js` and
  // the runbook uses `node-postgres`; the call surface they exercise is
  // structurally compatible (same Drizzle query API).
  // `let` not `const`: rebound to the fresh Phase 2 client after the swap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzleDb = drizzle(client) as unknown as any;

  let lockAcquired = false;
  let phase1Committed = false;
  let sentinelId: string | undefined;
  let globalRegionId: string | undefined;
  let regionByCode = new Map<string, string>();
  let hotelResult: Awaited<ReturnType<typeof runHotelLocationImport>> | undefined;
  let assetsResult: Awaited<ReturnType<typeof runAssetsImport>> | undefined;
  let heathrowResult: Awaited<ReturnType<typeof runHeathrowImport>> | undefined;
  let tierResult: Awaited<ReturnType<typeof runMondayImport>> | undefined;
  // 2026-05 follow-up — SSM-Group linked-item id (the value held in each
  // hotel item's `link_to_ssm_groups__1` BoardRelation) → kiosk_config_groups.id.
  // Built before BEGIN so the Monday roundtrip doesn't hold the transaction
  // open. `kiosk_config_groups` is operator-managed (preserved across the
  // reseed) — the importer does NOT auto-create from this map.
  let kioskConfigGroupByMondayLinkedId = new Map<string, string>();
  // Snapshot path captured pre-Phase-1 so the post-reseed restore step can
  // diff operator-only edits (notes hand-edits, sentinel address) back into
  // the freshly seeded locations table.
  let preReseedSnapshotPath: string | undefined;

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1)::boolean AS acquired`,
      [LOCK_KEY],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      console.error("Another wipe/import process holds the lock — aborting.");
      process.exit(1);
    }
    console.log(`Advisory lock ${LOCK_KEY} acquired.`);

    // ════════════════════════════════════════════════════════════════════════
    // PRE-PHASE 1 — Snapshot existing locations + build SSM-Group map
    // ════════════════════════════════════════════════════════════════════════
    // Both steps run OUTSIDE the BEGIN/TRUNCATE transaction:
    //   * Snapshot captures the pre-reseed locations state so the post-reseed
    //     restore script can re-apply operator-only edits (hand-edited notes,
    //     sentinel rows, anything Monday doesn't supply). Skipped in dry-run
    //     because no data changes.
    //   * SSM-Group map fetches board 1466686598 once and joins against the
    //     preserved `kiosk_config_groups` table so the hotel importer can
    //     resolve `link_to_ssm_groups__1 → kiosk_config_groups.id` inline.
    //     Doing this outside the transaction avoids holding the Phase 1
    //     transaction open during a slow Monday roundtrip (the same reason
    //     the importer fan-out itself was already isolated to STEP 4).
    if (APPLY) {
      console.log(`\n=== PRE-PHASE 1: Snapshot locations ===`);
      const snapResult = await client.query<{ row: Record<string, unknown> }>(
        `SELECT row_to_json(l) AS row FROM locations l`,
      );
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      preReseedSnapshotPath = `/tmp/locations-pre-reseed-${ts}.json`;
      await writeFile(
        preReseedSnapshotPath,
        JSON.stringify(snapResult.rows.map((r) => r.row), null, 2),
      );
      console.log(
        `  ${snapResult.rows.length} rows snapshotted → ${preReseedSnapshotPath}`,
      );
    } else {
      console.log(
        `\n[dry-run] PRE-PHASE 1: Skipping locations snapshot (no data change).`,
      );
    }

    console.log(`\n=== PRE-PHASE 1: Build SSM-Group → kiosk_config_groups map ===`);
    {
      // 1. Pull the operator-managed kiosk_config_groups (preserved across
      //    the reseed). Build a name → id lookup.
      const kcgRows = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM kiosk_config_groups`,
      );
      const kcgByName = new Map(kcgRows.rows.map((r) => [r.name, r.id]));
      console.log(`  ${kcgByName.size} kiosk_config_groups loaded.`);

      // 2. Iterate the SSM-groups board on Monday; for each item, look up
      //    the matching kiosk_config_groups row by name. Items whose name
      //    doesn't match any kiosk_config_groups row are silently skipped —
      //    the hotel importer will record an unresolved-link counter when
      //    that's the case. Bridge token into env for the shared client.
      const previousToken = process.env.MONDAY_API_TOKEN;
      process.env.MONDAY_API_TOKEN = mondayApiToken;
      try {
        let scanned = 0;
        let mapped = 0;
        for await (const item of iterateBoardItems(SSM_GROUPS_BOARD_ID, {
          itemFragment: `id name`,
        })) {
          scanned++;
          const kcgId = kcgByName.get(item.name);
          if (kcgId) {
            kioskConfigGroupByMondayLinkedId.set(item.id, kcgId);
            mapped++;
          }
        }
        console.log(
          `  SSM-groups board scanned: ${scanned} items; resolved to kiosk_config_groups: ${mapped}.`,
        );
      } finally {
        if (previousToken === undefined) {
          delete process.env.MONDAY_API_TOKEN;
        } else {
          process.env.MONDAY_API_TOKEN = previousToken;
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1 — Structural reseed (atomic transaction)
    // ════════════════════════════════════════════════════════════════════════
    console.log(`\n=== PHASE 1: structural reseed (atomic) ===`);
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.allow_assigned_at_mutation = 'on'`);

    // ── STEP 1: TRUNCATE wipe-set ──────────────────────────────────────────
    console.log(`\n--- STEP 1: Wipe (${WIPE_TABLES.length} tables) ---`);
    for (const t of WIPE_TABLES) {
      const sql = `TRUNCATE TABLE ${t} CASCADE`;
      console.log(APPLY ? `  ${sql}` : `  [dry-run] ${sql}`);
      await client.query(sql);
    }

    // ── STEP 2: Ensure GLOBAL region row ───────────────────────────────────
    console.log(`\n--- STEP 2: Ensure GLOBAL region ---`);
    await client.query(
      `INSERT INTO regions (code, name) VALUES ('GLOBAL', 'Global / Sentinel')
       ON CONFLICT (code) DO NOTHING`,
    );
    const globalRegion = await client.query<{ id: string }>(
      `SELECT id FROM regions WHERE code = 'GLOBAL' LIMIT 1`,
    );
    globalRegionId = globalRegion.rows[0]?.id;
    if (!globalRegionId) {
      throw new Error("GLOBAL region missing after upsert — schema/regions issue");
    }
    console.log(`  GLOBAL region id = ${globalRegionId}`);

    // Build region code → id lookup for hotel-import group resolution.
    const regionRows = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM regions`,
    );
    regionByCode = new Map(regionRows.rows.map((r) => [r.code, r.id]));
    console.log(
      `  Regions loaded: ${[...regionByCode.keys()].sort().join(", ")}`,
    );

    // ── STEP 3: Ensure LOCATION_NEEDED sentinel ────────────────────────────
    console.log(`\n--- STEP 3: Ensure LOCATION_NEEDED sentinel ---`);
    // Phase 07-06 — sentinel keying changed. The locations.outlet_code
    // column is gone (migration 0040); the sentinel is now identified by
    // (name='LOCATION_NEEDED', primary_region_id=GLOBAL). The active-row
    // partial unique on (region, customer_code) WHERE NOT NULL doesn't
    // touch this row (customer_code is NULL on the sentinel), and the
    // (normalised_name) partial unique excludes the sentinel by virtue of
    // the same-name detection helper's explicit "locationneeded" exclusion.
    //
    // We still set normalised_name = normaliseName(LOCATION_NEEDED_NAME) =
    // "locationneeded" so the helper's exclusion clause keeps working;
    // the sentinel is the only row that uses this exact string.
    //
    // INSERT idempotency: there's no DB-level unique that protects this
    // shape (the GLOBAL region's normalised_name='locationneeded' would
    // collide on the active partial unique if a non-sentinel row sneaked
    // in with the same normalised name, but that never happens — same-name
    // detection blocks it). So we use a SELECT-then-INSERT-if-missing
    // pattern instead of ON CONFLICT.
    const existingSentinel = await client.query<{ id: string }>(
      `SELECT id FROM locations
       WHERE name = $1 AND primary_region_id = $2 LIMIT 1`,
      [LOCATION_NEEDED_NAME, globalRegionId],
    );
    if (existingSentinel.rows.length === 0) {
      await client.query(
        `INSERT INTO locations (name, address, primary_region_id, normalised_name)
         VALUES ($1, $2, $3, $4)`,
        [
          LOCATION_NEEDED_NAME,
          LOCATION_NEEDED_ADDRESS,
          globalRegionId,
          normaliseName(LOCATION_NEEDED_NAME),
        ],
      );
    }
    const sentinelRow = await client.query<{ id: string }>(
      `SELECT id FROM locations
       WHERE name = $1 AND primary_region_id = $2 LIMIT 1`,
      [LOCATION_NEEDED_NAME, globalRegionId],
    );
    sentinelId = sentinelRow.rows[0]?.id;
    if (!sentinelId) throw new Error("Sentinel ensure failed — no row found");
    console.log(
      `  Sentinel location id = ${sentinelId} (name=${LOCATION_NEEDED_NAME}, region=${SENTINEL_REGION_CODE})`,
    );

    // ── STEP 4: Hotel-location import (Monday → locations) ─────────────────
    // Resolver hoisted so STEP 4c (Heathrow import) can reuse it. Same map,
    // same patterns; the country token from a LocationValue (e.g. "UK") drops
    // into mapGroupTitleToRegionCode unchanged.
    const resolveRegionIdByGroup = async (
      _boardId: number,
      groupTitle: string,
    ): Promise<string | null> => {
      const code = mapGroupTitleToRegionCode(groupTitle);
      if (!code) return null;
      return regionByCode.get(code) ?? null;
    };

    console.log(`\n--- STEP 4: Hotel-location import ---`);
    hotelResult = await runHotelLocationImport({
      mondayApiToken,
      db: drizzleDb,
      resolveRegionIdByGroup,
      kioskConfigGroupByMondayLinkedId,
      logger: (phase, msg) => console.log(`  [${phase}] ${msg}`),
    });
    console.log(
      `  Hotels: inserted=${hotelResult.locationsInserted} ` +
        `skipped-existing=${hotelResult.locationsSkippedExisting} ` +
        `skipped-no-region=${hotelResult.hotelsSkippedNoRegion} ` +
        `placeholder=${hotelResult.placeholderLocationsCreated} ` +
        `customer-codes-populated=${hotelResult.customerCodesPopulated} ` +
        `customer-code-conflicts-retried=${hotelResult.customerCodeConflictsRetried} ` +
        `same-name-skipped=${hotelResult.sameNameSkipped} ` +
        `addresses-written=${hotelResult.addressesWritten} ` +
        `hotel-groups-resolved=${hotelResult.hotelGroupsResolved} ` +
        `kcg-resolved=${hotelResult.kioskConfigGroupsResolved} ` +
        `kcg-unresolved=${hotelResult.kioskConfigGroupsUnresolved} ` +
        `hotelIdMap=${hotelResult.hotelMondayIdToLocationId.size} ` +
        `(took ${hotelResult.durationMs}ms)`,
    );
    if (hotelResult.unmappedGroupTitles.length > 0) {
      console.log(
        `  WARN: ${hotelResult.unmappedGroupTitles.length} group title(s) ` +
          `couldn't be mapped to a region — those hotels were skipped:`,
      );
      for (const t of hotelResult.unmappedGroupTitles) {
        console.log(`    - "${t}"`);
      }
    }

    // ── STEP 4b: Assets import (kiosks) ────────────────────────────────────
    // Monday Assets board is the canonical SoT for per-kiosk outlet codes —
    // each item's `outlet_code1` is the code that appears in NetSuite sales
    // rows, and `link_to_hotel_ssms` resolves to the hotel created in STEP 4.
    // This replaces the previous mirror9-fan-out kiosk synthesis (which
    // covered only ~244/291 GB sales codes; airport/transit codes like CB,
    // T2, T3 live on Assets but never on a hotel mirror9 row).
    console.log(`\n--- STEP 4b: Assets import (kiosks) ---`);
    assetsResult = await runAssetsImport({
      mondayApiToken,
      db: drizzleDb,
      hotelMondayIdToLocationId: hotelResult.hotelMondayIdToLocationId,
      logger: (phase, msg) => console.log(`  [${phase}] ${msg}`),
    });
    console.log(
      `  Assets: kiosks-inserted=${assetsResult.kiosksInserted} ` +
        `kiosks-skipped-existing=${assetsResult.kiosksSkippedExisting} ` +
        `assignments=${assetsResult.assignmentsInserted} ` +
        `skipped-no-outlet=${assetsResult.assetsSkippedNoOutletCode} ` +
        `skipped-no-linked-hotel=${assetsResult.assetsSkippedNoLinkedHotel} ` +
        `skipped-hotel-not-resolvable=${assetsResult.assetsSkippedHotelNotResolvable} ` +
        `(took ${assetsResult.durationMs}ms)`,
    );
    if (assetsResult.unmappedHotelMondayIds.length > 0) {
      console.log(
        `  WARN: ${assetsResult.unmappedHotelMondayIds.length} asset(s) point at ` +
          `hotel ids missing from the import map (sample of up to 50):`,
      );
      for (const id of assetsResult.unmappedHotelMondayIds.slice(0, 10)) {
        console.log(`    - mondayHotelId=${id}`);
      }
    }

    // ── STEP 4c: Heathrow Express SSMs board (board 1356657751) ────────────
    // Standalone shape: outlet_code1 (text) instead of mirror9, codes can be
    // slash-separated, kiosks live in this board (no Assets cross-references)
    // so they're synthesised inline. "In Progress" group → placeholder
    // location, no kiosks (mirrors the "Ready to Launch" pattern).
    console.log(`\n--- STEP 4c: Heathrow Express SSMs import ---`);
    heathrowResult = await runHeathrowImport({
      mondayApiToken,
      db: drizzleDb,
      resolveRegionIdByGroup,
      logger: (phase, msg) => console.log(`  [${phase}] ${msg}`),
    });
    console.log(
      `  Heathrow: live-locations=${heathrowResult.liveLocationsInserted} ` +
        `placeholder-locations=${heathrowResult.placeholderLocationsCreated} ` +
        `kiosks-inserted=${heathrowResult.kiosksInserted} ` +
        `assignments=${heathrowResult.assignmentsInserted} ` +
        `customer-codes-populated=${heathrowResult.customerCodesPopulated} ` +
        `skipped-no-outlet=${heathrowResult.itemsSkippedNoOutlet} ` +
        `skipped-no-region=${heathrowResult.itemsSkippedNoRegion} ` +
        `(took ${heathrowResult.durationMs}ms)`,
    );

    // ── STEP 5: Commission tier import (Monday → location_products) ────────
    console.log(`\n--- STEP 5: Commission tier import ---`);
    tierResult = await runMondayImport({
      mondayApiToken,
      db: drizzleDb,
      logger: (phase, msg) => console.log(`  [${phase}] ${msg}`),
    });
    console.log(
      `  location_products: rows=${tierResult.rowsInserted} ` +
        `placeholders=${tierResult.placeholdersCreated} ` +
        `hotels-skipped=${tierResult.hotelsSkipped} ` +
        `(took ${tierResult.durationMs.toFixed(0)}ms)`,
    );

    // ── STEP 5b: Canonical fee fallbacks ───────────────────────────────────
    // Insert known WKG fee mappings into product_code_fallbacks BEFORE Phase
    // 2's sales staging consults them. ON CONFLICT keeps re-runs idempotent.
    // Inside Phase 1's tx so it lands atomically with the structural reseed.
    console.log(`\n--- STEP 5b: Canonical fee fallbacks ---`);
    for (const f of CANONICAL_FEE_FALLBACKS) {
      await client.query(
        `INSERT INTO product_code_fallbacks (product_name, netsuite_code)
         VALUES ($1, $2)
         ON CONFLICT (product_name) DO UPDATE SET netsuite_code = EXCLUDED.netsuite_code, updated_at = NOW()`,
        [f.productName, f.netsuiteCode],
      );
    }
    console.log(
      `  Seeded ${CANONICAL_FEE_FALLBACKS.length} canonical fee fallback(s): ` +
        CANONICAL_FEE_FALLBACKS.map((f) => `${f.productName}→${f.netsuiteCode}`).join(", "),
    );

    // ── STEP 6: Audit-log reseed entry (Phase 1) ────────────────────────────
    console.log(`\n--- STEP 6: Audit log (phase 1) ---`);
    await client.query(
      `INSERT INTO audit_logs (actor_id, actor_name, entity_type, entity_id, entity_name, action, metadata)
       VALUES ($1, $2, 'system', $1, 'v2-wipe-and-reseed:structural', 'purge', $3::jsonb)`,
      [
        ETL_SYSTEM_USER_ID,
        RUNBOOK_ACTOR.name,
        JSON.stringify({
          runMode: APPLY ? "apply" : "dry-run",
          lockKey: LOCK_KEY,
          phase: "structural",
          // hotelResult.hotelMondayIdToLocationId is a Map — JSON.stringify
          // emits `{}` for Maps, which is fine for the audit row (we only
          // need the structural import counts here, not the lookup table).
          hotelResult: {
            ...hotelResult,
            hotelMondayIdToLocationId: hotelResult.hotelMondayIdToLocationId.size,
          },
          assetsResult,
          heathrowResult,
          tierResult,
          sentinelId,
          globalRegionId,
        }),
      ],
    );
    console.log(`  Audit row written (action=purge, phase=structural)`);

    // ── STEP 7: Commit or Rollback Phase 1 ─────────────────────────────────
    if (APPLY) {
      await client.query("COMMIT");
      phase1Committed = true;
      console.log("\nPHASE 1 COMMIT — structural reseed applied.");

      // ── Phase 1 → Phase 2 connection swap ─────────────────────────────────
      // The Phase 1 client has been alive ~5-10 min during Monday GraphQL
      // fan-out + commission-tier import. Neon's serverless layer kills
      // long-held connections mid-Phase-2 commit (95k-row chunked INSERT).
      // Swap to a fresh client and re-acquire the advisory lock on it.
      // Lock continuity: pg_advisory_lock is session-scoped; releasing on
      // the old session and acquiring on the new is atomic-enough for our
      // single-operator runbook (no contention expected during the swap).
      console.log("\n--- Phase 2 setup: swapping to fresh DB connection ---");
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
      } catch { /* connection may already be torn down */ }
      client.release();

      client = await pool.connect();
      await client.query(`SET idle_in_transaction_session_timeout = 0`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drizzleDb = drizzle(client) as unknown as any;
      const reLock = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock($1)::boolean AS acquired`,
        [LOCK_KEY],
      );
      if (reLock.rows[0]?.acquired !== true) {
        throw new Error(
          "Could not re-acquire advisory lock for Phase 2 — another runbook ran in the swap window?",
        );
      }
      console.log("  Fresh client checked out; advisory lock re-acquired.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nPHASE 1 ROLLBACK — dry-run, structural reseed not committed.");
    }
    // (no catch here — falls through to outer finally; main()'s catch
    // converts a Phase 1 throw into exit 1. The transaction was rolled back
    // in the COMMIT/ROLLBACK gate above, or the throw left it pending — we
    // attempt a defensive rollback in the outer finally.)

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Sales ETL (one transaction per CSV)
  // ════════════════════════════════════════════════════════════════════════
  // Each CSV is its own atomic unit. In dry-run we still stage+commit each
  // (against the rolled-back-Phase-1 state) so the runbook surfaces the
  // same row counts the operator will see post-apply; the per-CSV commits
  // are idempotent (sourceHash dedup) so a re-run after rollback is safe.
  // In --apply mode each commit lands. In dry-run, we ROLLBACK each CSV's
  // commit to keep the branch storage from blowing up.
  //
  // Note: in dry-run mode, sentinelId/regionByCode reflect uncommitted
  // Phase 1 state. The structural rollback above means those rows don't
  // exist in the DB anymore. We skip Phase 2 entirely in dry-run since
  // _stageImportForActor needs the committed locations to resolve.
  let salesRowsCommitted = 0;
  let salesFilesCommitted = 0;
  if (APPLY) {
    console.log(`\n=== PHASE 2: sales ETL (per-CSV transactions) ===`);

    // Build the fee-code fallback Map from the freshly-committed
    // product_code_fallbacks table (STEP 5b seeded the canonical entries
    // inside Phase 1's atomic tx). This mirrors the prod operator workflow
    // — fallbacks must be set BEFORE staging or rows with empty `Code` for
    // known fee names get rejected wholesale.
    const fallbackRows = await client.query<{ product_name: string; netsuite_code: string }>(
      `SELECT product_name, netsuite_code FROM product_code_fallbacks`,
    );
    const feeCodeFallbacks = new Map<string, string>(
      fallbackRows.rows.map((r) => [r.product_name, r.netsuite_code]),
    );
    console.log(
      `  Loaded ${feeCodeFallbacks.size} fee-code fallback(s) for staging.`,
    );

    const seedDir = path.resolve(process.cwd(), "seed_data");
    const allSeedFiles = (await readdir(seedDir))
      .filter((f) => f.toLowerCase().endsWith(".csv"))
      .sort();
    const seedFiles = Number.isFinite(MAX_CSV) && MAX_CSV >= 0
      ? allSeedFiles.slice(0, MAX_CSV)
      : allSeedFiles;
    console.log(
      `  ${seedFiles.length}/${allSeedFiles.length} CSV(s) selected ` +
        `from ${seedDir}${Number.isFinite(MAX_CSV) ? ` (--max-csv ${MAX_CSV})` : ""}`,
    );

    for (const filename of seedFiles) {
      const meta = parseSeedFilename(filename);
      if (!meta) {
        console.log(`  SKIP "${filename}" — filename doesn't match seed pattern`);
        continue;
      }
      const regionId = regionByCode.get(meta.regionCode);
      if (!regionId) {
        console.log(
          `  SKIP "${filename}" — region "${meta.regionCode}" not in regions table`,
        );
        continue;
      }
      console.log(
        `  ${filename} → region=${meta.regionCode} blobDate=${meta.blobDate}`,
      );
      const source = new LocalFileSource({ path: path.join(seedDir, filename) });
      const stage = await _stageImportForActor(source, RUNBOOK_ACTOR, drizzleDb, {
        regionId,
        feeCodeFallbacks,
        sentinelLocationId: sentinelId,
      });
      console.log(
        `    staged: total=${stage.totalRows} valid=${stage.validCount} ` +
          `invalid=${stage.invalidCount}`,
      );
      if (stage.invalidCount > 0) {
        throw new Error(
          `Stage of "${filename}" produced ${stage.invalidCount} invalid rows ` +
            `even with sentinel fallback — investigate before --apply`,
        );
      }
      const commit = await _commitImportForActor(
        stage.importId,
        RUNBOOK_ACTOR,
        drizzleDb,
      );
      salesRowsCommitted += commit.committedRows;
      salesFilesCommitted++;
      console.log(`    committed: ${commit.committedRows} rows`);

      // Free space — staged rows are kept for audit historically but for the
      // wipe-and-reseed runbook they're throwaway: the parsed payload was
      // copied into sales_records on commit. Deleting them right after each
      // commit keeps the branch storage from accumulating across CSVs.
      const del = await client.query(
        `DELETE FROM import_stagings WHERE import_id = $1`,
        [stage.importId],
      );
      console.log(`    cleaned ${del.rowCount} staging rows`);
    }
    console.log(
      `  Sales total: ${salesRowsCommitted} rows from ${salesFilesCommitted} file(s)`,
    );
  } else {
    console.log(
      `\n=== PHASE 2: SKIPPED in dry-run ===\n` +
        `  (Phase 1 rolled back; sales ETL needs committed locations to resolve.\n` +
        `  Re-run with --apply to exercise Phase 2 against the structural reseed.)`,
    );
  }

  // ── PHASE 2 audit entry ───────────────────────────────────────────────────
  if (APPLY) {
    await client.query(
      `INSERT INTO audit_logs (actor_id, actor_name, entity_type, entity_id, entity_name, action, metadata)
       VALUES ($1, $2, 'system', $1, 'v2-wipe-and-reseed:sales', 'commit', $3::jsonb)`,
      [
        ETL_SYSTEM_USER_ID,
        RUNBOOK_ACTOR.name,
        JSON.stringify({
          phase: "sales",
          salesRowsCommitted,
          salesFilesCommitted,
          maxCsv: Number.isFinite(MAX_CSV) ? MAX_CSV : null,
        }),
      ],
    );
  }

    void phase1Committed;
  } finally {
    // Defensive rollback — if Phase 1 threw before the COMMIT/ROLLBACK
    // gate, the transaction may still be pending on `client`.
    try {
      await client.query("ROLLBACK");
    } catch {
      // No active transaction (already committed/rolled back) — nothing to do.
    }
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
      } catch {
        /* connection may already be torn down */
      }
    }
    client.release();
    await pool.end();
  }

  // ── PHASE 3: Two-pass assigned_at ────────────────────────────────────────
  // Outside the runbook transaction by design — the backfill needs the full
  // sales corpus visible to MIN(salesRecords.date) per kiosk. Skipped in
  // dry-run because sales_records was rolled back.
  if (APPLY) {
    console.log(
      "\n=== PHASE 3: Two-pass assigned_at (backfill-kiosk-install-dates --apply) ===",
    );
    execSync("npx tsx scripts/backfill-kiosk-install-dates.ts --apply", {
      stdio: "inherit",
      env: process.env,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
