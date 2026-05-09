import type { BlobServiceClient } from "@azure/storage-blob";
import { and, eq, sql } from "drizzle-orm";
import {
  importStagings,
  productCodeFallbacks,
  regions,
  salesBlobIngestions,
} from "@/db/schema";
import { AzureBlobSource } from "@/lib/sales/azure-blob-source";
import { getAzureBlobClient } from "@/lib/sales/azure-client";
import {
  _commitImportForActor,
  _stageImportForActor,
  type ImportActor,
} from "@/app/(app)/settings/data-import/sales/pipeline";
import { ETL_AZURE_LOCK_KEY, withAdvisoryLock } from "./advisory-lock";
import { getRateForDate } from "@/lib/fx/rate-lookup";
import { inngest } from "@/inngest/client";

/**
 * Azure ETL orchestrator.
 *
 * Acquires the advisory lock, enumerates configured regions, lists blobs
 * under `{container}/{azureCode}/YYYY/MM/DD/<filename>.csv`, and runs each
 * un-processed blob through stage → commit. Idempotency is enforced via
 * `sales_blob_ingestions(regionId, blobPath)`: successful ingestions block
 * reprocessing; failed ingestions are re-attempted (and the row is updated
 * with the latest outcome via onConflictDoUpdate).
 *
 * The blob client is dependency-injectable so tests can stub Azure without
 * touching env vars. Production callers default to {@link getAzureBlobClient}.
 *
 * Failure of a single blob never stops the run — it's recorded and the loop
 * continues. The overall return shape partitions blobs into processed /
 * skipped / failed so callers can decide the HTTP status / exit code.
 */

// Fixed UUID for the ETL actor (seeded by migration 0018).
export const ETL_ACTOR: ImportActor = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Azure ETL",
};

// Path pattern: {azureCode}/YYYY/MM/DD/<filename>.csv — must end in .csv.
const BLOB_PATH_RE = /^([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.csv$/;

export type EtlRunResult =
  | { status: "skipped-lock" }
  | {
      status: "ok";
      processed: Array<{ regionCode: string; blobPath: string; rows: number }>;
      skipped: Array<{ regionCode: string; blobPath: string }>;
      failed: Array<{ regionCode: string; blobPath: string; error: string }>;
    };

export type RunAzureEtlOptions = {
  /**
   * Override the container name (default: `process.env.AZURE_BLOB_CONTAINER`
   * or `"clientdata"`).
   */
  containerName?: string;
  /**
   * Inject a pre-built `BlobServiceClient` — exercised by tests. Production
   * callers omit this and we build one from env via {@link getAzureBlobClient}.
   */
  client?: BlobServiceClient;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAzureEtl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  options: RunAzureEtlOptions = {},
): Promise<EtlRunResult> {
  const containerName =
    options.containerName ?? process.env.AZURE_BLOB_CONTAINER ?? "clientdata";

  const lockResult = await withAdvisoryLock(db, ETL_AZURE_LOCK_KEY, async () => {
    const processed: Array<{ regionCode: string; blobPath: string; rows: number }> = [];
    const skipped: Array<{ regionCode: string; blobPath: string }> = [];
    const failed: Array<{ regionCode: string; blobPath: string; error: string }> = [];

    // Lazy-build the client so tests can run without Azure env vars.
    const client: BlobServiceClient = options.client ?? getAzureBlobClient();
    const container = client.getContainerClient(containerName);

    const configuredRegions: Array<{
      id: string;
      code: string;
      azureCode: string | null;
    }> = await db
      .select({ id: regions.id, code: regions.code, azureCode: regions.azureCode })
      .from(regions)
      .where(sql`${regions.azureCode} IS NOT NULL`);

    const fallbackRows: Array<{ productName: string; netsuiteCode: string }> = await db
      .select({
        productName: productCodeFallbacks.productName,
        netsuiteCode: productCodeFallbacks.netsuiteCode,
      })
      .from(productCodeFallbacks);
    const feeCodeFallbacks = new Map<string, string>(
      fallbackRows.map((r) => [r.productName, r.netsuiteCode]),
    );

    for (const region of configuredRegions) {
      if (!region.azureCode) continue; // defensive — WHERE clause already filters
      const prefix = `${region.azureCode}/`;

      for await (const item of container.listBlobsFlat({ prefix })) {
        const blobPath = item.name;
        if (!blobPath.endsWith(".csv")) continue;
        const m = BLOB_PATH_RE.exec(blobPath);
        if (!m) continue;
        const [, , yyyy, mm, dd] = m;
        const blobDate = `${yyyy}-${mm}-${dd}`;

        // Idempotency: skip blobs we've already succeeded on. Failed rows fall
        // through and will be retried (onConflictDoUpdate keeps the row in sync).
        const existing = await db
          .select({ id: salesBlobIngestions.id })
          .from(salesBlobIngestions)
          .where(
            and(
              eq(salesBlobIngestions.regionId, region.id),
              eq(salesBlobIngestions.blobPath, blobPath),
              eq(salesBlobIngestions.status, "success"),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          skipped.push({ regionCode: region.code, blobPath });
          continue;
        }

        try {
          const source = new AzureBlobSource({ containerName, blobPath, client });
          const stage = await _stageImportForActor(source, ETL_ACTOR, db, {
            regionId: region.id,
            feeCodeFallbacks,
          });
          if (stage.invalidCount > 0) {
            throw new Error(
              `Validation failed: ${stage.invalidCount}/${stage.totalRows} rows invalid`,
            );
          }

          // ── FX-02 (D-07/D-08): per-blob defensive stale-rate pre-check ──
          // pipeline.ts (Task 1 of 09.1-05) already enforces D-07 at per-row
          // stamp time. This pre-check exists so the operator alert
          // (fx_rate_stale) names the FIRST stale (currency, date) the blob
          // carries, rather than whichever row pipeline.ts happens to hit
          // first inside its chunked transaction. On hit: emit the alert
          // event then throw — the existing failure handler below records
          // the blob as failed with the stale-rate message.
          //
          // Distinct (currency, transaction_date) is read from the JSONB
          // `parsed_row` of staging — staged rows have not yet landed in
          // sales_records (commit hasn't run).
          const distinctPairs: Array<{
            currency: string;
            transactionDate: string;
          }> = await db.execute(sql`
            SELECT DISTINCT
              parsed_row->'parsed'->>'currency'         AS currency,
              parsed_row->'parsed'->>'transactionDate'  AS "transactionDate"
            FROM ${importStagings}
            WHERE import_id = ${stage.importId}
              AND status = 'valid'
              AND parsed_row IS NOT NULL
          `).then((res: unknown) => {
            const rows = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
            return Array.isArray(rows)
              ? (rows as Array<{ currency: string; transactionDate: string }>)
              : [];
          });

          for (const pair of distinctPairs) {
            if (!pair.currency || !pair.transactionDate) continue;
            const r = await getRateForDate(pair.currency, pair.transactionDate, db);
            if (!r || r.staleDays > 7) {
              const reason = !r
                ? `no rate exists for ${pair.currency} on or before ${pair.transactionDate}`
                : `staleDays=${r.staleDays} > 7 for ${pair.currency} on ${pair.transactionDate}`;
              await inngest.send({
                name: "email/send.requested",
                data: {
                  kind: "fx_rate_stale",
                  to: process.env.FX_ALERT_TO ?? "vedant.kalbag@weknowgroup.com",
                  subject: `Sales ETL halted: stale FX rate for ${pair.currency}`,
                  template: "plain-text",
                  templateProps: {
                    currency: pair.currency,
                    transactionDate: pair.transactionDate,
                    staleDays: r?.staleDays ?? null,
                    blobPath,
                    importId: stage.importId,
                  },
                  payloadHash: `fx_rate_stale:${pair.currency}:${pair.transactionDate}:${blobPath}`,
                },
              });
              throw new Error(`FX-02 stale-rate gate: ${reason}`);
            }
          }

          const commit = await _commitImportForActor(stage.importId, ETL_ACTOR, db);
          await db
            .insert(salesBlobIngestions)
            .values({
              regionId: region.id,
              blobPath,
              blobDate,
              importId: stage.importId,
              status: "success" as const,
            })
            .onConflictDoUpdate({
              target: [salesBlobIngestions.regionId, salesBlobIngestions.blobPath],
              set: {
                status: "success" as const,
                blobDate,
                importId: stage.importId,
                errorMessage: null,
                processedAt: new Date(),
              },
            });
          processed.push({
            regionCode: region.code,
            blobPath,
            rows: commit.committedRows,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .insert(salesBlobIngestions)
            .values({
              regionId: region.id,
              blobPath,
              blobDate,
              status: "failed" as const,
              errorMessage: message,
            })
            .onConflictDoUpdate({
              target: [salesBlobIngestions.regionId, salesBlobIngestions.blobPath],
              set: {
                status: "failed" as const,
                errorMessage: message,
                blobDate,
                processedAt: new Date(),
              },
            });
          failed.push({ regionCode: region.code, blobPath, error: message });
        }
      }
    }

    return { status: "ok" as const, processed, skipped, failed };
  });

  if ("skipped" in lockResult && lockResult.skipped === "lock-not-acquired") {
    return { status: "skipped-lock" };
  }
  return lockResult as EtlRunResult;
}
