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
import { readdir } from "node:fs/promises";
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
import { runAssetsImport } from "@/lib/monday/import-assets";
import { runHotelLocationImport } from "@/lib/monday/import-hotel-locations";
import { runMondayImport } from "@/lib/monday/import-location-products";
import { normaliseName } from "@/lib/normalise";
import {
  LOCATION_NEEDED_ADDRESS,
  LOCATION_NEEDED_NAME,
  LOCATION_NEEDED_OUTLET_CODE,
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
  const client: PoolClient = await pool.connect();

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drizzleDb = drizzle(client) as unknown as any;

  let lockAcquired = false;
  let phase1Committed = false;
  let sentinelId: string | undefined;
  let globalRegionId: string | undefined;
  let regionByCode = new Map<string, string>();
  let hotelResult: Awaited<ReturnType<typeof runHotelLocationImport>> | undefined;
  let assetsResult: Awaited<ReturnType<typeof runAssetsImport>> | undefined;
  let tierResult: Awaited<ReturnType<typeof runMondayImport>> | undefined;

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
    // Plan 07-04 fix: sentinel's `normalised_name` MUST be the result of
    // normaliseName(LOCATION_NEEDED_NAME) — i.e. "locationneeded" — so the
    // same-name detection helper can exclude it via the canonical
    // SENTINEL_NORMALISED constant. The previous form passed `$1` (the
    // literal "LOCATION_NEEDED" with underscore) which broke the contract:
    // the helper would never see the sentinel, but any row inserted with
    // `normaliseName(name)` and the same shape would have a different
    // value and slip past the exclusion.
    await client.query(
      `INSERT INTO locations (name, outlet_code, address, primary_region_id, normalised_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (primary_region_id, outlet_code) DO NOTHING`,
      [
        LOCATION_NEEDED_NAME,
        LOCATION_NEEDED_OUTLET_CODE,
        LOCATION_NEEDED_ADDRESS,
        globalRegionId,
        normaliseName(LOCATION_NEEDED_NAME),
      ],
    );
    const sentinelRow = await client.query<{ id: string }>(
      `SELECT id FROM locations WHERE outlet_code = $1 AND name = $2 LIMIT 1`,
      [LOCATION_NEEDED_OUTLET_CODE, LOCATION_NEEDED_NAME],
    );
    sentinelId = sentinelRow.rows[0]?.id;
    if (!sentinelId) throw new Error("Sentinel ensure failed — no row found");
    console.log(`  Sentinel location id = ${sentinelId}`);

    // ── STEP 4: Hotel-location import (Monday → locations) ─────────────────
    console.log(`\n--- STEP 4: Hotel-location import ---`);
    hotelResult = await runHotelLocationImport({
      mondayApiToken,
      db: drizzleDb,
      resolveRegionIdByGroup: async (_boardId, groupTitle) => {
        const code = mapGroupTitleToRegionCode(groupTitle);
        if (!code) return null;
        return regionByCode.get(code) ?? null;
      },
      logger: (phase, msg) => console.log(`  [${phase}] ${msg}`),
    });
    console.log(
      `  Hotels: inserted=${hotelResult.locationsInserted} ` +
        `skipped-existing=${hotelResult.locationsSkippedExisting} ` +
        `skipped-no-outlet=${hotelResult.hotelsSkippedNoOutletCode} ` +
        `skipped-no-region=${hotelResult.hotelsSkippedNoRegion} ` +
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
        feeCodeFallbacks: new Map(), // wipe drops product_code_fallbacks; rebuild empty
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
