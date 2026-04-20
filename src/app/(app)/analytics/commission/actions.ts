"use server";

import { db } from "@/db";
import {
  commissionLedger,
  salesRecords,
  locations,
  products,
  locationProducts,
} from "@/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { requireRole } from "@/lib/rbac";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { getPreviousPeriodDates, calculatePeriodChange } from "@/lib/analytics/metrics";
import { recalculateCommissions } from "@/lib/commission/processor";
import { writeAuditLog } from "@/lib/audit";
import type { AnalyticsFilters } from "@/lib/analytics/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommissionSummary = {
  totalCommission: number;
  totalCommissionable: number;
  avgRate: number;
  recordCount: number;
  prevTotalCommission: number | null;
  prevTotalCommissionable: number | null;
  prevAvgRate: number | null;
  prevRecordCount: number | null;
  commissionDelta: number | null;
  commissionableDelta: number | null;
  rateDelta: number | null;
  recordDelta: number | null;
};

export type CommissionByLocation = {
  locationId: string;
  locationName: string;
  commissionable: number;
  commission: number;
  effectiveRate: number;
  recordCount: number;
};

export type CommissionByProduct = {
  productName: string;
  commissionable: number;
  commission: number;
  effectiveRate: number;
};

export type CommissionMonthlyTrend = {
  month: string;
  commission: number;
  commissionable: number;
};

// ---------------------------------------------------------------------------
// Internal: build WHERE clause
// ---------------------------------------------------------------------------

async function buildCommissionWhere(
  filters: AnalyticsFilters,
): Promise<SQL | undefined> {
  const exclusionCondition = await buildExclusionCondition();
  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);

  return combineConditions([
    dateCondition,
    exclusionCondition,
    ...dimensionConditions,
  ]);
}

// ---------------------------------------------------------------------------
// fetchCommissionSummary
// ---------------------------------------------------------------------------

export async function fetchCommissionSummary(
  filters: AnalyticsFilters,
): Promise<CommissionSummary> {
  await getUserCtx();

  const where = await buildCommissionWhere(filters);

  const [current] = await db
    .select({
      totalCommission: sql<string>`coalesce(sum(${commissionLedger.commissionAmount}), 0)`,
      totalCommissionable: sql<string>`coalesce(sum(${commissionLedger.commissionableAmount}), 0)`,
      recordCount: sql<string>`count(*)`,
    })
    .from(commissionLedger)
    .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
    .innerJoin(locations, eq(salesRecords.locationId, locations.id))
    .where(and(where, eq(commissionLedger.isReversal, false)));

  const totalCommission = Number(current.totalCommission);
  const totalCommissionable = Number(current.totalCommissionable);
  const recordCount = Number(current.recordCount);
  const avgRate = totalCommissionable > 0
    ? (totalCommission / totalCommissionable) * 100
    : 0;

  // Previous period
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const prevFilters: AnalyticsFilters = { ...filters, dateFrom: prevFrom, dateTo: prevTo };
  const prevWhere = await buildCommissionWhere(prevFilters);

  const [prev] = await db
    .select({
      totalCommission: sql<string>`coalesce(sum(${commissionLedger.commissionAmount}), 0)`,
      totalCommissionable: sql<string>`coalesce(sum(${commissionLedger.commissionableAmount}), 0)`,
      recordCount: sql<string>`count(*)`,
    })
    .from(commissionLedger)
    .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
    .innerJoin(locations, eq(salesRecords.locationId, locations.id))
    .where(and(prevWhere, eq(commissionLedger.isReversal, false)));

  const prevTotalCommission = Number(prev.totalCommission);
  const prevTotalCommissionable = Number(prev.totalCommissionable);
  const prevRecordCount = Number(prev.recordCount);
  const prevAvgRate = prevTotalCommissionable > 0
    ? (prevTotalCommission / prevTotalCommissionable) * 100
    : 0;

  return {
    totalCommission,
    totalCommissionable,
    avgRate,
    recordCount,
    prevTotalCommission: prevRecordCount > 0 ? prevTotalCommission : null,
    prevTotalCommissionable: prevRecordCount > 0 ? prevTotalCommissionable : null,
    prevAvgRate: prevRecordCount > 0 ? prevAvgRate : null,
    prevRecordCount: prevRecordCount > 0 ? prevRecordCount : null,
    commissionDelta: calculatePeriodChange(totalCommission, prevTotalCommission),
    commissionableDelta: calculatePeriodChange(totalCommissionable, prevTotalCommissionable),
    rateDelta: prevRecordCount > 0 ? avgRate - prevAvgRate : null,
    recordDelta: calculatePeriodChange(recordCount, prevRecordCount),
  };
}

// ---------------------------------------------------------------------------
// fetchCommissionByLocation
// ---------------------------------------------------------------------------

export async function fetchCommissionByLocation(
  filters: AnalyticsFilters,
): Promise<CommissionByLocation[]> {
  await getUserCtx();

  const where = await buildCommissionWhere(filters);

  const rows = await db
    .select({
      locationId: locations.id,
      locationName: sql<string>`coalesce(${locations.name}, ${locations.outletCode}, 'Unknown')`,
      commissionable: sql<string>`coalesce(sum(${commissionLedger.commissionableAmount}), 0)`,
      commission: sql<string>`coalesce(sum(${commissionLedger.commissionAmount}), 0)`,
      recordCount: sql<string>`count(*)`,
    })
    .from(commissionLedger)
    .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
    .innerJoin(locations, eq(salesRecords.locationId, locations.id))
    .where(and(where, eq(commissionLedger.isReversal, false)))
    .groupBy(locations.id, locations.name, locations.outletCode)
    .orderBy(sql`sum(${commissionLedger.commissionAmount}) DESC`);

  return rows.map((r) => {
    const commissionable = Number(r.commissionable);
    const commission = Number(r.commission);
    return {
      locationId: r.locationId,
      locationName: r.locationName,
      commissionable,
      commission,
      effectiveRate: commissionable > 0 ? (commission / commissionable) * 100 : 0,
      recordCount: Number(r.recordCount),
    };
  });
}

// ---------------------------------------------------------------------------
// fetchCommissionByProduct
// ---------------------------------------------------------------------------

export async function fetchCommissionByProduct(
  filters: AnalyticsFilters,
): Promise<CommissionByProduct[]> {
  await getUserCtx();

  const where = await buildCommissionWhere(filters);

  const rows = await db
    .select({
      productName: sql<string>`coalesce(${products.name}, 'Unknown')`,
      commissionable: sql<string>`coalesce(sum(${commissionLedger.commissionableAmount}), 0)`,
      commission: sql<string>`coalesce(sum(${commissionLedger.commissionAmount}), 0)`,
    })
    .from(commissionLedger)
    .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
    .innerJoin(locations, eq(salesRecords.locationId, locations.id))
    .innerJoin(products, eq(salesRecords.productId, products.id))
    .where(and(where, eq(commissionLedger.isReversal, false)))
    .groupBy(products.id, products.name)
    .orderBy(sql`sum(${commissionLedger.commissionAmount}) DESC`);

  return rows.map((r) => {
    const commissionable = Number(r.commissionable);
    const commission = Number(r.commission);
    return {
      productName: r.productName,
      commissionable,
      commission,
      effectiveRate: commissionable > 0 ? (commission / commissionable) * 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// fetchCommissionMonthlyTrend
// ---------------------------------------------------------------------------

export async function fetchCommissionMonthlyTrend(
  filters: AnalyticsFilters,
): Promise<CommissionMonthlyTrend[]> {
  await getUserCtx();

  const where = await buildCommissionWhere(filters);

  const rows = await db
    .select({
      month: sql<string>`to_char(${salesRecords.transactionDate}, 'YYYY-MM')`,
      commission: sql<string>`coalesce(sum(${commissionLedger.commissionAmount}), 0)`,
      commissionable: sql<string>`coalesce(sum(${commissionLedger.commissionableAmount}), 0)`,
    })
    .from(commissionLedger)
    .innerJoin(salesRecords, eq(commissionLedger.salesRecordId, salesRecords.id))
    .innerJoin(locations, eq(salesRecords.locationId, locations.id))
    .where(and(where, eq(commissionLedger.isReversal, false)))
    .groupBy(sql`to_char(${salesRecords.transactionDate}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${salesRecords.transactionDate}, 'YYYY-MM')`);

  return rows.map((r) => ({
    month: r.month,
    commission: Number(r.commission),
    commissionable: Number(r.commissionable),
  }));
}

// ---------------------------------------------------------------------------
// triggerRecalculation (admin-only)
// ---------------------------------------------------------------------------

export async function triggerRecalculation(
  locationProductId: string,
  month: string,
): Promise<{ reversed: number; recalculated: number }> {
  const session = await requireRole("admin");
  const userCtx = await getUserCtx();

  const result = await recalculateCommissions(locationProductId, month);

  // Fetch location product name for audit
  const [lp] = await db
    .select({
      locationName: locations.name,
      productName: products.name,
    })
    .from(locationProducts)
    .innerJoin(locations, eq(locationProducts.locationId, locations.id))
    .innerJoin(products, eq(locationProducts.productId, products.id))
    .where(eq(locationProducts.id, locationProductId))
    .limit(1);

  await writeAuditLog({
    actorId: userCtx.id,
    actorName: session.user.name ?? userCtx.id,
    entityType: "commission_ledger",
    entityId: locationProductId,
    entityName: lp
      ? `${lp.locationName} - ${lp.productName}`
      : locationProductId,
    action: "recalculate",
    field: "month",
    oldValue: month,
    newValue: `reversed=${result.reversed}, recalculated=${result.recalculated}`,
  });

  return result;
}
