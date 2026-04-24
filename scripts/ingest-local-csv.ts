/**
 * Ingest a local NetSuite CSV into the configured database as one region.
 *
 * Mirrors the production Azure ETL path (stage → commit) but reads bytes
 * from local disk instead of Azure Blob. Uses the exact same staging
 * and commit helpers the Azure orchestrator uses, so sales_imports +
 * sales_records + commission_ledger rows come out with the same shape.
 *
 * Idempotency: `_stageImportForActor` rejects re-uploads by sha256 of the
 * file bytes. To re-ingest the same file, clear sales_imports first.
 *
 * Run:
 *   npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *     scripts/ingest-local-csv.ts <csv-path> <region-code>
 *
 * Example:
 *   npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *     scripts/ingest-local-csv.ts WKG_NETSUITE_VK.csv UK
 */
import { readFileSync } from "fs";
import { basename } from "path";
import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { productCodeFallbacks, regions } from "@/db/schema";
import type { SalesDataSource, SalesSourcePullResult } from "@/lib/sales/source";
import {
  _commitImportForActor,
  _stageImportForActor,
  type ImportActor,
} from "@/app/(app)/settings/data-import/sales/pipeline";
import * as schema from "@/db/schema";

const ETL_ACTOR: ImportActor = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Azure ETL",
};

class LocalFileSource implements SalesDataSource {
  constructor(private readonly path: string) {}
  async pull(): Promise<SalesSourcePullResult> {
    const bytes = readFileSync(this.path);
    return {
      filename: basename(this.path),
      sourceLabel: `local:${this.path}`,
      sourceHash: createHash("sha256").update(bytes).digest("hex"),
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
  }
}

async function main() {
  const [, , csvPath, regionCode] = process.argv;
  if (!csvPath || !regionCode) {
    console.error("Usage: ingest-local-csv.ts <csv-path> <region-code>");
    console.error("  region-code is the canonical regions.code (e.g. UK, IE, DE, ES, CZ)");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("CSV:   ", csvPath);
  console.log("Region:", regionCode);

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    // Resolve region by canonical code
    const [region] = await db
      .select({ id: regions.id, name: regions.name, azureCode: regions.azureCode })
      .from(regions)
      .where(eq(regions.code, regionCode))
      .limit(1);
    if (!region) throw new Error(`Region code '${regionCode}' not found in regions table`);
    console.log(`Resolved region: ${region.name} (azureCode=${region.azureCode})  id=${region.id}\n`);

    // Load fee-code fallbacks (same pattern as azure-etl.ts)
    const fbRows = await db
      .select({
        productName: productCodeFallbacks.productName,
        netsuiteCode: productCodeFallbacks.netsuiteCode,
      })
      .from(productCodeFallbacks);
    const feeCodeFallbacks = new Map(fbRows.map((r) => [r.productName, r.netsuiteCode]));
    console.log(
      `Loaded ${feeCodeFallbacks.size} fee-code fallbacks:`,
      Array.from(feeCodeFallbacks.entries()),
    );

    const source = new LocalFileSource(csvPath);

    console.log("\n--- Stage ---");
    const stage = await _stageImportForActor(source, ETL_ACTOR, db, {
      regionId: region.id,
      feeCodeFallbacks,
    });
    console.log(
      `  importId=${stage.importId}\n  totalRows=${stage.totalRows}  valid=${stage.validCount}  invalid=${stage.invalidCount}`,
    );
    console.log(`  dateRange: ${stage.dateRangeStart} → ${stage.dateRangeEnd}`);

    if (stage.invalidCount > 0) {
      console.log(
        `\n  First few invalid rows (of ${stage.invalidCount}):`,
      );
      for (const s of stage.sampleRows.filter((r) => r.errors.length > 0).slice(0, 20)) {
        const errs = s.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
        const snippet =
          s.parsed
            ? `outlet=${s.parsed.outletCode} prod="${s.parsed.productName}" ref=${s.parsed.refNo}`
            : "(parse failure)";
        console.log(`    row ${s.rowNumber}  ${snippet}  — ${errs}`);
      }
      throw new Error(`Stage had ${stage.invalidCount} invalid rows — refusing to commit`);
    }

    console.log("\n--- Commit ---");
    const result = await _commitImportForActor(stage.importId, ETL_ACTOR, db);
    console.log(`  committed ${result.committedRows} rows`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
