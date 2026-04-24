/**
 * Sales CSV import pipeline — internal helpers.
 *
 * This file deliberately does NOT carry the "use server" directive. See
 * `src/app/(app)/settings/users/[id]/scopes-internal.ts` for the full
 * rationale — in short:
 *
 *   1. A "use server" file can only export async functions. Types and
 *      synchronous helpers here would make Turbopack emit broken server-action
 *      bundles (runtime ReferenceError).
 *
 *   2. Exporting any async helper from a "use server" file registers it as a
 *      network-callable RPC. Keeping _*ForActor helpers here means only the
 *      public wrappers in `./actions.ts` (which gate on requireRole('admin'))
 *      are reachable from the network.
 *
 * The _*ForActor helpers accept the `actor` as an explicit parameter so
 * integration tests can drive them directly without monkey-patching
 * next/headers.
 *
 * NetSuite ETL (2026-04-24): stage + commit now require an explicit
 * `regionId` (one import belongs to exactly one region) and the parser's
 * fee-code fallbacks map. Callers are the Azure ETL orchestrator (see
 * `src/lib/sales/etl/azure-etl.ts`); the manual-upload server actions have
 * been stubbed out pending Phase 8 UI removal.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  importStagings,
  salesImports,
  salesRecords,
} from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import {
  parseSalesCsv,
  type ParsedSalesRow,
  type RowValidationError,
} from "@/lib/csv/sales-csv";
import { resolveDimensions, type DimensionInput } from "@/lib/csv/dimension-resolver";
import type { SalesDataSource } from "@/lib/sales/source";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase | any;

export type ImportActor = { id: string; name: string };

export type StagedRowSample = {
  rowNumber: number;
  parsed: ParsedSalesRow | null;
  errors: RowValidationError[];
};

export type StageSummary = {
  importId: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  sampleRows: StagedRowSample[];
};

export type CommitResult = { committedRows: number };

export type StageOptions = {
  regionId: string;
  feeCodeFallbacks: Map<string, string>;
};

type StoredStagedRow = {
  parsed: ParsedSalesRow;
  resolution: { locationId: string; productId: string; providerId: string | null };
};

/**
 * Stage an upload: parses, resolves dimensions, writes salesImports +
 * importStagings rows. All rows (valid and invalid) land in staging so the UI
 * can show them. Throws if an import with the same sourceHash already exists.
 */
export async function _stageImportForActor(
  source: SalesDataSource,
  actor: ImportActor,
  db: AnyDb,
  opts: StageOptions,
): Promise<StageSummary> {
  const pulled = await source.pull();
  const { filename, bytes, sourceHash } = pulled;

  const existing = await db
    .select({ id: salesImports.id })
    .from(salesImports)
    .where(eq(salesImports.sourceHash, sourceHash))
    .limit(1);
  if (existing.length > 0) {
    throw new Error(
      `This file has already been uploaded — hash already seen on import ${existing[0].id}`,
    );
  }

  const text = new TextDecoder().decode(bytes);
  const parseResult = parseSalesCsv(text, { feeCodeFallbacks: opts.feeCodeFallbacks });

  const parsedRows: Array<{ rowNumber: number; parsed: ParsedSalesRow }> = [];
  for (const row of parseResult.rows) {
    if (row.parsed) parsedRows.push({ rowNumber: row.rowNumber, parsed: row.parsed });
  }

  const dimensionInputs: DimensionInput[] = parsedRows.map((r) => ({
    rowNumber: r.rowNumber,
    outletCode: r.parsed.outletCode,
    productName: r.parsed.productName,
    netsuiteCode: r.parsed.netsuiteCode,
    categoryCode: r.parsed.categoryCode,
    categoryName: r.parsed.categoryName,
    apiProductName: r.parsed.apiProductName,
    providerName: r.parsed.providerName,
  }));
  const resolutions = await resolveDimensions(db, dimensionInputs, {
    regionId: opts.regionId,
  });
  const resolutionByRow = new Map<number, (typeof resolutions)[number]>();
  for (const r of resolutions) resolutionByRow.set(r.rowNumber, r);

  const importId = await db.transaction(async (tx: AnyDb) => {
    const [imp] = await tx
      .insert(salesImports)
      .values({
        filename,
        sourceHash,
        uploadedBy: actor.id,
        rowCount: parseResult.totalRows,
        dateRangeStart: parseResult.dateRangeStart,
        dateRangeEnd: parseResult.dateRangeEnd,
        status: "staging" as const,
        regionId: opts.regionId,
      })
      .returning({ id: salesImports.id });

    const stagingValues = parseResult.rows.map((row) => {
      const resolution = resolutionByRow.get(row.rowNumber);
      const combinedErrors: RowValidationError[] = [...row.errors];
      let resolvedPayload: StoredStagedRow["resolution"] | null = null;

      if (row.parsed && resolution) {
        if ("errors" in resolution) {
          combinedErrors.push(...resolution.errors);
        } else {
          resolvedPayload = {
            locationId: resolution.locationId,
            productId: resolution.productId,
            providerId: resolution.providerId,
          };
        }
      }

      const isValid = combinedErrors.length === 0 && row.parsed !== null && resolvedPayload !== null;
      const stored: StoredStagedRow | null =
        isValid && row.parsed && resolvedPayload
          ? { parsed: row.parsed, resolution: resolvedPayload }
          : null;

      return {
        importId: imp.id,
        rowNumber: row.rowNumber,
        rawRow: row.raw,
        parsedRow: stored,
        status: (isValid ? "valid" : "invalid") as "valid" | "invalid",
        validationErrors: combinedErrors.length > 0 ? combinedErrors : null,
      };
    });

    if (stagingValues.length > 0) {
      // Batch-insert in chunks of 1000.
      const CHUNK = 1000;
      for (let i = 0; i < stagingValues.length; i += CHUNK) {
        await tx.insert(importStagings).values(stagingValues.slice(i, i + CHUNK));
      }
    }
    return imp.id;
  });

  // Counts, derived from what we actually wrote.
  let validCount = 0;
  let invalidCount = 0;
  for (const row of parseResult.rows) {
    const resolution = resolutionByRow.get(row.rowNumber);
    const hadResolutionError = resolution && "errors" in resolution;
    const isValid = row.errors.length === 0 && row.parsed !== null && !hadResolutionError;
    if (isValid) validCount++;
    else invalidCount++;
  }

  const sampleRows: StagedRowSample[] = parseResult.rows.slice(0, 20).map((row) => {
    const resolution = resolutionByRow.get(row.rowNumber);
    const combined = [...row.errors];
    if (resolution && "errors" in resolution) combined.push(...resolution.errors);
    return { rowNumber: row.rowNumber, parsed: row.parsed, errors: combined };
  });

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "sales_import",
      entityId: importId,
      entityName: filename,
      action: "stage",
      newValue: `${validCount}/${parseResult.totalRows} valid`,
    },
    db,
  );

  return {
    importId,
    totalRows: parseResult.totalRows,
    validCount,
    invalidCount,
    dateRangeStart: parseResult.dateRangeStart,
    dateRangeEnd: parseResult.dateRangeEnd,
    sampleRows,
  };
}

/**
 * Commit a staged import atomically. Refuses if any staged row is `invalid`
 * (all-or-nothing per M4 design decision). Rolls back on any DB-level error
 * (e.g. unique-constraint conflict with pre-existing rows).
 */
export async function _commitImportForActor(
  importId: string,
  actor: ImportActor,
  db: AnyDb,
): Promise<CommitResult> {
  const [imp] = await db
    .select()
    .from(salesImports)
    .where(eq(salesImports.id, importId))
    .limit(1);
  if (!imp) throw new Error(`Import ${importId} not found`);
  if (imp.status !== "staging") {
    throw new Error(`Import ${importId} is not in staging (status=${imp.status})`);
  }
  if (!imp.regionId) {
    throw new Error(`Import ${importId} has no regionId — stage must set it`);
  }
  const regionId: string = imp.regionId;

  const invalidCount = await db
    .select({ count: importStagings.id })
    .from(importStagings)
    .where(and(eq(importStagings.importId, importId), eq(importStagings.status, "invalid")));
  if (invalidCount.length > 0) {
    throw new Error(
      `Cannot commit: ${invalidCount.length} rows have validation errors. Fix the CSV and re-upload.`,
    );
  }

  const validRows: Array<{ id: string; parsedRow: StoredStagedRow }> = await db
    .select({ id: importStagings.id, parsedRow: importStagings.parsedRow })
    .from(importStagings)
    .where(and(eq(importStagings.importId, importId), eq(importStagings.status, "valid")));

  let committedRows = 0;

  try {
    await db.transaction(async (tx: AnyDb) => {
      const CHUNK = 1000;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const batch = validRows.slice(i, i + CHUNK);
        const inserts = batch.map(({ parsedRow: stored }) => ({
          importId,
          regionId,
          saleRef: stored.parsed.saleRef,
          refNo: stored.parsed.refNo,
          transactionDate: stored.parsed.transactionDate,
          transactionTime: stored.parsed.transactionTime,
          locationId: stored.resolution.locationId,
          productId: stored.resolution.productId,
          providerId: stored.resolution.providerId,
          netAmount: stored.parsed.netAmount,
          vatAmount: stored.parsed.vatAmount,
          vatRate: stored.parsed.vatRate,
          currency: stored.parsed.currency,
          isBookingFee: stored.parsed.isBookingFee,
          netsuiteCode: stored.parsed.netsuiteCode,
          agent: stored.parsed.agent,
          businessDivision: stored.parsed.businessDivision,
          categoryCode: stored.parsed.categoryCode,
          categoryName: stored.parsed.categoryName,
          apiProductName: stored.parsed.apiProductName,
          city: stored.parsed.city,
          country: stored.parsed.country,
          customerCode: stored.parsed.customerCode,
          customerName: stored.parsed.customerName,
        }));
        // Raw insert into salesRecords is legitimate here — this path is
        // allow-listed in eslint.config.mjs because admin-only CSV commits
        // don't go through scopedSalesCondition (admins bypass).
        await tx.insert(salesRecords).values(inserts);
      }
      // Mark the valid-rows as committed. Filter by status='valid' instead
      // of inArray(...validRowIds): inArray with tens of thousands of ids
      // blows past Postgres's 65535-parameter limit. Equivalent semantics
      // since invalid rows keep status='invalid' and are never touched here.
      await tx
        .update(importStagings)
        .set({ status: "committed" })
        .where(
          and(
            eq(importStagings.importId, importId),
            eq(importStagings.status, "valid"),
          ),
        );
      await tx
        .update(salesImports)
        .set({ status: "committed" })
        .where(eq(salesImports.id, importId));
    });
    committedRows = validRows.length;
  } catch (err) {
    await db
      .update(salesImports)
      .set({
        status: "failed",
        errors: { message: err instanceof Error ? err.message : String(err) },
      })
      .where(eq(salesImports.id, importId));
    throw err;
  }

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "sales_import",
      entityId: importId,
      entityName: imp.filename,
      action: "commit",
      newValue: String(committedRows),
    },
    db,
  );

  // Calculate commissions for committed records (best-effort, does not block import)
  try {
    const { calculateCommissionsForRecords } = await import("@/lib/commission/processor");
    const committedIds = await db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.importId, importId));
    await calculateCommissionsForRecords(committedIds.map((r: { id: string }) => r.id));
  } catch (err) {
    console.error("Commission calculation failed (non-blocking):", err);
  }

  return { committedRows };
}

/**
 * Abandon a staged import without committing: delete staging rows, mark the
 * import `failed`. The sourceHash row is retained so re-uploads of identical
 * bytes are still rejected — user must edit the file to retry.
 */
export async function _cancelImportForActor(
  importId: string,
  actor: ImportActor,
  db: AnyDb,
): Promise<void> {
  const [imp] = await db
    .select()
    .from(salesImports)
    .where(eq(salesImports.id, importId))
    .limit(1);
  if (!imp) throw new Error(`Import ${importId} not found`);

  await db.transaction(async (tx: AnyDb) => {
    await tx.delete(importStagings).where(eq(importStagings.importId, importId));
    await tx
      .update(salesImports)
      .set({ status: "failed" })
      .where(eq(salesImports.id, importId));
  });

  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "sales_import",
      entityId: importId,
      entityName: imp.filename,
      action: "cancel",
    },
    db,
  );
}
