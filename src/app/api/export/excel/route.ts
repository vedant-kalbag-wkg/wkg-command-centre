import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { buildExcelWorkbook } from "@/lib/analytics/export/excel-builder";
import { runExportQuery, type ExportTab } from "@/lib/analytics/export/query-runner";
import type { AnalyticsFilters } from "@/lib/analytics/types";

const VALID_TABS: ExportTab[] = [
  "portfolio",
  "heat-map",
  "hotel-groups",
  "regions",
  "location-groups",
];

function parseFilters(params: URLSearchParams): AnalyticsFilters {
  const dateFrom = params.get("from") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const dateTo = params.get("to") ?? new Date().toISOString().slice(0, 10);

  const filters: AnalyticsFilters = { dateFrom, dateTo };

  const hotelIds = params.get("hotelIds");
  if (hotelIds) filters.hotelIds = hotelIds.split(",");

  const regionIds = params.get("regionIds");
  if (regionIds) filters.regionIds = regionIds.split(",");

  const productIds = params.get("productIds");
  if (productIds) filters.productIds = productIds.split(",");

  const hotelGroupIds = params.get("hotelGroupIds");
  if (hotelGroupIds) filters.hotelGroupIds = hotelGroupIds.split(",");

  const locationGroupIds = params.get("locationGroupIds");
  if (locationGroupIds) filters.locationGroupIds = locationGroupIds.split(",");

  const categoryIds = params.get("categoryIds");
  if (categoryIds) filters.categoryIds = categoryIds.split(",");

  return filters;
}

export async function GET(request: NextRequest) {
  // 1. Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse query params
  const params = request.nextUrl.searchParams;
  const tab = params.get("tab") as ExportTab | null;

  if (!tab || !VALID_TABS.includes(tab)) {
    return NextResponse.json(
      { error: `Invalid tab. Must be one of: ${VALID_TABS.join(", ")}` },
      { status: 400 },
    );
  }

  const filters = parseFilters(params);

  const userCtx = {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as "admin" | "member" | "viewer" | null,
  };

  try {
    // 3. Run the query
    const { headers: exportHeaders, rows } = await runExportQuery(tab, filters, userCtx);

    // 4. Build Excel workbook
    const buffer = await buildExcelWorkbook([
      { name: tab, headers: exportHeaders, rows },
    ]);

    // 5. Return binary with proper headers
    const filename = `analytics-${tab}-export.xlsx`;
    return new Response(buffer.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
