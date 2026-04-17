/**
 * Shared helper that runs the appropriate analytics query for a given tab
 * and returns { headers, rows } suitable for CSV or Excel export.
 */

import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import { getPortfolioSummary, getCategoryPerformance, getTopProducts } from "@/lib/analytics/queries/portfolio";
import { getHeatMapData } from "@/lib/analytics/queries/heat-map";
import { getHotelGroupsList } from "@/lib/analytics/queries/hotel-groups";
import { getRegionsList } from "@/lib/analytics/queries/regions";
import { getLocationGroupsList } from "@/lib/analytics/queries/location-groups";

export type ExportTab =
  | "portfolio"
  | "heat-map"
  | "hotel-groups"
  | "regions"
  | "location-groups";

export type ExportResult = {
  headers: string[];
  rows: (string | number | null)[][];
};

export async function runExportQuery(
  tab: ExportTab,
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  switch (tab) {
    case "portfolio":
      return exportPortfolio(filters, userCtx);
    case "heat-map":
      return exportHeatMap(filters, userCtx);
    case "hotel-groups":
      return exportHotelGroups(filters, userCtx);
    case "regions":
      return exportRegions(filters, userCtx);
    case "location-groups":
      return exportLocationGroups(filters, userCtx);
    default: {
      const _exhaustive: never = tab;
      throw new Error(`Unknown export tab: ${_exhaustive as string}`);
    }
  }
}

async function exportPortfolio(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  const [summary, categories, products] = await Promise.all([
    getPortfolioSummary(filters, userCtx),
    getCategoryPerformance(filters, userCtx),
    getTopProducts(filters, userCtx),
  ]);

  // Combine categories and products into a single sheet
  const headers = ["Type", "Name", "Revenue", "Transactions", "Quantity", "Avg Value"];
  const rows: (string | number | null)[][] = [];

  // Summary row
  rows.push([
    "Summary",
    "Portfolio Total",
    summary.totalRevenue,
    summary.totalTransactions,
    summary.totalQuantity,
    summary.avgBasketValue,
  ]);

  // Category rows
  for (const cat of categories) {
    rows.push([
      "Category",
      cat.categoryName,
      cat.revenue,
      cat.transactions,
      cat.quantity,
      cat.avgValue,
    ]);
  }

  // Top product rows
  for (const prod of products) {
    rows.push([
      "Top Product",
      prod.productName,
      prod.revenue,
      prod.transactions,
      prod.quantity,
      null,
    ]);
  }

  return { headers, rows };
}

async function exportHeatMap(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  const data = await getHeatMapData(filters, userCtx);

  const headers = [
    "Rank",
    "Outlet Code",
    "Hotel Name",
    "Revenue",
    "Transactions",
    "Revenue/Room",
    "Txn/Kiosk",
    "Avg Basket",
    "Composite Score",
  ];

  const rows: (string | number | null)[][] = data.allPerformers.map((h) => [
    h.rank,
    h.outletCode,
    h.hotelName,
    h.revenue,
    h.transactions,
    h.revenuePerRoom,
    h.txnPerKiosk,
    h.avgBasketValue,
    h.compositeScore,
  ]);

  return { headers, rows };
}

async function exportHotelGroups(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  const data = await getHotelGroupsList(filters, userCtx);

  const headers = [
    "Group Name",
    "Revenue",
    "Transactions",
    "Hotel Count",
    "Revenue Change %",
    "Transaction Change %",
  ];

  const rows: (string | number | null)[][] = data.map((g) => [
    g.name,
    g.revenue,
    g.transactions,
    g.hotelCount,
    g.revenueChange,
    g.transactionChange,
  ]);

  return { headers, rows };
}

async function exportRegions(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  const data = await getRegionsList(filters, userCtx);

  const headers = [
    "Region",
    "Revenue",
    "Transactions",
    "Hotel Groups",
    "Location Groups",
  ];

  const rows: (string | number | null)[][] = data.map((r) => [
    r.name,
    r.revenue,
    r.transactions,
    r.hotelGroupCount,
    r.locationGroupCount,
  ]);

  return { headers, rows };
}

async function exportLocationGroups(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ExportResult> {
  const data = await getLocationGroupsList(filters, userCtx);

  const headers = [
    "Group Name",
    "Revenue",
    "Transactions",
    "Hotel Count",
    "Total Rooms",
    "Revenue/Room",
    "Txn/Kiosk",
    "Avg Basket Value",
  ];

  const rows: (string | number | null)[][] = data.map((g) => [
    g.name,
    g.revenue,
    g.transactions,
    g.hotelCount,
    g.totalRooms,
    g.revenuePerRoom,
    g.txnPerKiosk,
    g.avgBasketValue,
  ]);

  return { headers, rows };
}
