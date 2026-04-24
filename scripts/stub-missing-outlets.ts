/**
 * For every (outletCode, outletName) pair in the CSV that does NOT have
 * a location in the given region, create a stub location (name=outletName
 * or outletCode if no name). Idempotent.
 *
 * Also cancels any previous staging import with the same sourceHash so a
 * fresh ingest can run.
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *        scripts/stub-missing-outlets.ts <csv-path> <region-code>
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import Papa from "papaparse";
import {
  importStagings,
  locations,
  regions,
  salesImports,
} from "@/db/schema";
import * as schema from "@/db/schema";

interface CsvRow {
  "Outlet Code"?: string;
  "Outlet Name"?: string;
  [k: string]: string | undefined;
}

async function main() {
  const [, , csvPath, regionCode] = process.argv;
  if (!csvPath || !regionCode) {
    console.error("Usage: stub-missing-outlets.ts <csv-path> <region-code>");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });
  try {
    // Resolve region
    const [region] = await db
      .select({ id: regions.id, name: regions.name, code: regions.code })
      .from(regions)
      .where(eq(regions.code, regionCode));
    if (!region) throw new Error(`Region '${regionCode}' not found`);
    console.log(`Region: ${region.name} (${region.code}) — ${region.id}`);

    // Parse CSV, extract distinct (code, name) pairs
    const bytes = readFileSync(csvPath);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    console.log(`CSV hash: ${sourceHash.slice(0, 20)}…`);

    const parsed = Papa.parse<CsvRow>(bytes.toString("utf8"), {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      console.warn(`CSV parse warnings: ${parsed.errors.length}`);
    }
    console.log(`Parsed ${parsed.data.length} rows`);

    const pairs = new Map<string, string>();
    for (const row of parsed.data) {
      const code = (row["Outlet Code"] ?? "").trim();
      const name = (row["Outlet Name"] ?? "").trim();
      if (!code) continue;
      if (!pairs.has(code) || (name && pairs.get(code) === code)) {
        pairs.set(code, name || code);
      }
    }
    console.log(`Distinct outlet codes in CSV: ${pairs.size}`);

    // Find which are missing in this region (active+archived both counted —
    // we only want to create stubs for codes that exist nowhere for this
    // region).
    const existing = await db
      .select({ outletCode: locations.outletCode })
      .from(locations)
      .where(eq(locations.primaryRegionId, region.id));
    const existingSet = new Set(existing.map((l) => l.outletCode));

    const toCreate: Array<{ code: string; name: string }> = [];
    for (const [code, name] of pairs) {
      if (!existingSet.has(code)) toCreate.push({ code, name });
    }
    console.log(`Missing in ${region.code}: ${toCreate.length}`);

    if (toCreate.length > 0) {
      for (const { code, name } of toCreate) {
        await db
          .insert(locations)
          .values({
            name,
            outletCode: code,
            primaryRegionId: region.id,
          })
          .onConflictDoNothing({
            target: [locations.primaryRegionId, locations.outletCode],
          });
      }
      console.log(`Inserted stubs:`);
      for (const { code, name } of toCreate.slice(0, 40)) {
        console.log(`  ${code.padEnd(6)} ${name}`);
      }
      if (toCreate.length > 40) console.log(`  ... and ${toCreate.length - 40} more`);
    }

    // Cancel/delete any prior staging import for this sourceHash so the
    // next ingest call won't reject on duplicate-hash.
    const prior = await db
      .select({ id: salesImports.id, status: salesImports.status })
      .from(salesImports)
      .where(eq(salesImports.sourceHash, sourceHash));
    if (prior.length > 0) {
      console.log(`\nFound ${prior.length} prior import(s) with same sourceHash:`);
      for (const p of prior) console.log(`  ${p.id}  status=${p.status}`);
      for (const p of prior) {
        await db.delete(importStagings).where(eq(importStagings.importId, p.id));
        await db.delete(salesImports).where(eq(salesImports.id, p.id));
      }
      console.log(`  deleted ${prior.length} import(s) + their staging rows`);
    }

    console.log("\nReady to re-ingest.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
