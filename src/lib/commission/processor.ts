/**
 * Commission batch processor — calculates commissions for a set of sales
 * records using the waterfall cumulative model and writes results to the
 * commissionLedger.
 *
 * Two entry points:
 *   - calculateCommissionsForRecords(ids)  — forward calculation for new records
 *   - recalculateCommissions(lpId, month)  — reverse + recalculate for a month
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  commissionLedger,
  salesRecords,
  locationProducts,
} from "@/db/schema";
import { calculateCommission } from "./engine";
import type { VersionedTierConfig } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProcessResult = {
  processed: number;
  calculated: number;
  skipped: number;
};

type RecalcResult = {
  reversed: number;
  recalculated: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date or ISO string to "YYYY-MM" */
function toYearMonth(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** First day of a month given "YYYY-MM" */
function monthStart(ym: string): string {
  return `${ym}-01`;
}

/** First day of the NEXT month given "YYYY-MM" */
function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(y, m, 1); // month is 0-indexed; m is already 1-indexed = next month
  return next.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// calculateCommissionsForRecords
// ---------------------------------------------------------------------------

export async function calculateCommissionsForRecords(
  salesRecordIds: string[],
): Promise<ProcessResult> {
  if (salesRecordIds.length === 0) {
    return { processed: 0, calculated: 0, skipped: 0 };
  }

  // 1. Fetch the sales records
  const records = await db
    .select({
      id: salesRecords.id,
      locationId: salesRecords.locationId,
      productId: salesRecords.productId,
      transactionDate: salesRecords.transactionDate,
      grossAmount: salesRecords.grossAmount,
      bookingFee: salesRecords.bookingFee,
    })
    .from(salesRecords)
    .where(inArray(salesRecords.id, salesRecordIds));

  // 2. Fetch only the locationProducts matching the sales records' (locationId, productId) pairs
  const uniquePairs = new Map<string, { locationId: string; productId: string }>();
  for (const rec of records) {
    const key = `${rec.locationId}|${rec.productId}`;
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { locationId: rec.locationId, productId: rec.productId });
    }
  }

  const pairFilters = Array.from(uniquePairs.values()).map((p) =>
    and(eq(locationProducts.locationId, p.locationId), eq(locationProducts.productId, p.productId)),
  );

  const allLPs = pairFilters.length > 0
    ? await db
        .select({
          id: locationProducts.id,
          locationId: locationProducts.locationId,
          productId: locationProducts.productId,
          commissionTiers: locationProducts.commissionTiers,
        })
        .from(locationProducts)
        .where(or(...pairFilters))
    : [];

  // 3. Build lookup map: "locationId|productId" -> { id, tiers }
  const lpMap = new Map<
    string,
    { id: string; tiers: VersionedTierConfig[] }
  >();
  for (const lp of allLPs) {
    if (!lp.commissionTiers || lp.commissionTiers.length === 0) continue;
    const key = `${lp.locationId}|${lp.productId}`;
    lpMap.set(key, {
      id: lp.id,
      tiers: lp.commissionTiers as VersionedTierConfig[],
    });
  }

  // 4. Group records by "locationId|productId|YYYY-MM"
  type RecordRow = (typeof records)[number];
  const groups = new Map<string, RecordRow[]>();
  for (const rec of records) {
    const lpKey = `${rec.locationId}|${rec.productId}`;
    if (!lpMap.has(lpKey)) continue; // no commission config — will be skipped
    const ym = toYearMonth(rec.transactionDate);
    const groupKey = `${lpKey}|${ym}`;
    let arr = groups.get(groupKey);
    if (!arr) {
      arr = [];
      groups.set(groupKey, arr);
    }
    arr.push(rec);
  }

  // 5. Process each group
  let calculated = 0;
  let skipped = 0;
  const ledgerRows: Array<{
    salesRecordId: string;
    locationProductId: string;
    grossAmount: string;
    commissionableAmount: string;
    commissionAmount: string;
    tierBreakdown: Array<{
      tierRate: number;
      revenueInTier: number;
      commission: number;
    }>;
    tierVersionEffectiveFrom: string;
    isReversal: boolean;
  }> = [];

  for (const [groupKey, groupRecords] of groups) {
    const parts = groupKey.split("|");
    const locationId = parts[0];
    const productId = parts[1];
    const ym = parts[2];
    const lpKey = `${locationId}|${productId}`;
    const lp = lpMap.get(lpKey)!;

    const mStart = monthStart(ym);
    const mEnd = monthEnd(ym);

    // Query cumulative revenue for this location x product x month
    // EXCLUDING the records we're about to process
    const [cumRow] = await db
      .select({
        total: sql<string>`coalesce(sum(${salesRecords.grossAmount}), 0)`,
      })
      .from(salesRecords)
      .where(
        and(
          eq(salesRecords.locationId, locationId),
          eq(salesRecords.productId, productId),
          sql`${salesRecords.transactionDate} >= ${mStart}::date`,
          sql`${salesRecords.transactionDate} < ${mEnd}::date`,
          sql`${salesRecords.id} NOT IN (${sql.join(
            salesRecordIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        ),
      );

    let cumulative = Number(cumRow?.total ?? 0);

    // Sort records by transactionDate ascending
    groupRecords.sort((a, b) => {
      const da = typeof a.transactionDate === "string" ? a.transactionDate : String(a.transactionDate);
      const db_ = typeof b.transactionDate === "string" ? b.transactionDate : String(b.transactionDate);
      return da.localeCompare(db_);
    });

    for (const rec of groupRecords) {
      const gross = Number(rec.grossAmount);
      const fee = Number(rec.bookingFee ?? 0);
      const txDate =
        typeof rec.transactionDate === "string"
          ? rec.transactionDate
          : (rec.transactionDate as Date).toISOString().slice(0, 10);

      const result = calculateCommission(
        gross,
        fee,
        cumulative,
        lp.tiers,
        txDate,
      );

      if (!result) {
        skipped++;
        cumulative += gross;
        continue;
      }

      ledgerRows.push({
        salesRecordId: rec.id,
        locationProductId: lp.id,
        grossAmount: gross.toFixed(2),
        commissionableAmount: result.commissionableAmount.toFixed(2),
        commissionAmount: result.commissionAmount.toFixed(2),
        tierBreakdown: result.tierBreakdown,
        tierVersionEffectiveFrom: result.tierVersionEffectiveFrom,
        isReversal: false,
      });

      cumulative += gross;
      calculated++;
    }
  }

  // Count records that had no LP match at all
  const matchedCount = Array.from(groups.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  skipped += records.length - matchedCount;

  // 6. Batch insert into commissionLedger (500-row chunks)
  const CHUNK = 500;
  for (let i = 0; i < ledgerRows.length; i += CHUNK) {
    await db.insert(commissionLedger).values(ledgerRows.slice(i, i + CHUNK));
  }

  return {
    processed: records.length,
    calculated,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// recalculateCommissions
// ---------------------------------------------------------------------------

export async function recalculateCommissions(
  locationProductId: string,
  month: string, // "YYYY-MM"
): Promise<RecalcResult> {
  const mStart = monthStart(month);
  const mEnd = monthEnd(month);

  // Resolve locationId + productId from the locationProduct row
  const [lp] = await db
    .select({
      locationId: locationProducts.locationId,
      productId: locationProducts.productId,
    })
    .from(locationProducts)
    .where(eq(locationProducts.id, locationProductId))
    .limit(1);

  if (!lp) {
    return { reversed: 0, recalculated: 0 };
  }

  // Wrap everything in a transaction so reversal + recalculation is atomic (C2)
  return await db.transaction(async (tx) => {
    // C1 + C3: Find existing non-reversal ledger entries by joining to
    // salesRecords and filtering on transactionDate (not calculatedAt)
    const existing = await tx
      .select({
        id: commissionLedger.id,
        salesRecordId: commissionLedger.salesRecordId,
        locationProductId: commissionLedger.locationProductId,
        grossAmount: commissionLedger.grossAmount,
        commissionableAmount: commissionLedger.commissionableAmount,
        commissionAmount: commissionLedger.commissionAmount,
        tierBreakdown: commissionLedger.tierBreakdown,
        tierVersionEffectiveFrom: commissionLedger.tierVersionEffectiveFrom,
      })
      .from(commissionLedger)
      .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
      .where(
        and(
          eq(commissionLedger.locationProductId, locationProductId),
          eq(commissionLedger.isReversal, false),
          sql`${salesRecords.transactionDate} >= ${mStart}::date`,
          sql`${salesRecords.transactionDate} < ${mEnd}::date`,
        ),
      );

    // Create reversal entries for all existing ledger rows
    const reversals = existing.map((entry) => ({
      salesRecordId: entry.salesRecordId,
      locationProductId: entry.locationProductId,
      grossAmount: entry.grossAmount,
      commissionableAmount: entry.commissionableAmount,
      commissionAmount: (
        -Math.abs(Number(entry.commissionAmount))
      ).toFixed(2),
      tierBreakdown: entry.tierBreakdown,
      tierVersionEffectiveFrom: entry.tierVersionEffectiveFrom,
      isReversal: true,
    }));

    const CHUNK = 500;
    for (let i = 0; i < reversals.length; i += CHUNK) {
      await tx.insert(commissionLedger).values(reversals.slice(i, i + CHUNK));
    }

    // C3: Find ALL salesRecords for this location x product x month
    // (not just the ones that already had ledger entries)
    const allMonthRecords = await tx
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(
        and(
          eq(salesRecords.locationId, lp.locationId),
          eq(salesRecords.productId, lp.productId),
          sql`${salesRecords.transactionDate} >= ${mStart}::date`,
          sql`${salesRecords.transactionDate} < ${mEnd}::date`,
        ),
      );

    const allRecordIds = allMonthRecords.map((r) => r.id);

    // Recalculate for ALL records in the month
    const result = allRecordIds.length > 0
      ? await calculateCommissionsForRecords(allRecordIds)
      : { processed: 0, calculated: 0, skipped: 0 };

    return {
      reversed: reversals.length,
      recalculated: result.calculated,
    };
  });
}
