import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { getOutletTierThresholdsCached } from "@/lib/analytics/thresholds-server";
import type { OutletTierConfig } from "@/lib/analytics/thresholds";
import { classifyOutletTier } from "@/lib/analytics/metrics";
import type { Tier } from "@/lib/performance-alerts/classify-dispatch";

export type ClassifiedKioskRow = {
  kioskId: string;
  internalPocId: string | null;
  outletCode: string;
  locationName: string;
  region: string;
  revenue: number;
  /**
   * ISO 4217 code (e.g. "GBP", "EUR") of the modal currency on the kiosk's
   * sales_records over the trailing window. Falls back to "GBP" when the
   * kiosk has zero transactions in the window. Cross-currency forex
   * normalisation is NOT applied here — see follow-up issue.
   */
  currency: string;
  percentile: number;
  tier: Tier;
};

/**
 * Classify all eligible live kiosks by revenue percentile rank.
 *
 * Eligible = archived_at IS NULL, outlet_code IS NOT NULL, alert_silenced_at IS NULL,
 *            pipeline_stage_id matches the "pipeline_stage_id_live" app_setting.
 *
 * Revenue is summed from sales_records.net_amount joined via kiosk_assignments.location_id
 * (NOT via outlet_code — sales_records has no outlet_code column).
 *
 * [Rule 1 - Bug] Plan reference SQL used s.outlet_code and s.total_amount which do not
 * exist on sales_records. Corrected to join via kiosk_assignments.location_id and use
 * net_amount as the revenue column.
 */
export async function classifyEligibleKiosks(): Promise<{
  rows: ClassifiedKioskRow[];
  tierConfig: OutletTierConfig;
  windowDays: number;
  liveStageId: string;
}> {
  const [windowDaysRow, liveStageRow, tierConfig] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, "underperformance_window_days")),
    db.select().from(appSettings).where(eq(appSettings.key, "pipeline_stage_id_live")),
    getOutletTierThresholdsCached(),
  ]);

  const windowDays = Number(windowDaysRow[0]?.value ?? 30);
  const liveStageId = liveStageRow[0]?.value;
  if (!liveStageId) {
    throw new Error("app_settings.pipeline_stage_id_live is missing — run migration 0043 first.");
  }

  // Join path: kiosks → (most-recent active kiosk_assignment) → locations → regions
  // Revenue: sum sales_records.net_amount over the window, joined via location_id
  //
  // The lateral subquery picks a SINGLE active assignment per kiosk (ordered by
  // assigned_at DESC) — without this, a kiosk that simultaneously has two active
  // assignments (data invariant violation) would emit two rows here, double-count
  // in the email, and write two skip rows. The application layer enforces the
  // single-active-assignment rule, but no DB-level constraint guards it; the
  // LATERAL subquery makes the classifier safe by construction.
  //
  // Currency: the modal ISO-4217 code on the kiosk's sales_records over the same
  // window. Falls back to 'GBP' when the kiosk has 0 transactions (no rows to
  // aggregate). The percentile classifier compares raw revenue across currencies
  // — fine for the current GBP-only fixture, but a real correctness bug for
  // multi-currency portfolios. Forex normalisation to a base reporting currency
  // is tracked in https://github.com/vedant-kalbag-wkg/wkg-command-centre/issues/39.
  //
  // db.execute() with node-postgres returns a QueryResult object {rows, rowCount, fields}.
  // Extract the .rows array — casting the full result as Array would give a non-iterable object.
  const result = await db.execute(sql`
    SELECT
      k.id::text                                      AS kiosk_id,
      k.internal_poc_id                               AS internal_poc_id,
      k.outlet_code                                   AS outlet_code,
      l.name                                          AS location_name,
      r.name                                          AS region,
      COALESCE(SUM(s.net_amount::numeric), 0)::float  AS revenue,
      COALESCE((
        SELECT s2.currency
        FROM sales_records s2
        WHERE s2.location_id = ka.location_id
          AND s2.transaction_date >= NOW() - (${windowDays} || ' days')::interval
        GROUP BY s2.currency
        ORDER BY COUNT(*) DESC, s2.currency
        LIMIT 1
      ), 'GBP')                                       AS currency
    FROM kiosks k
    LEFT JOIN LATERAL (
      SELECT ka_inner.location_id, ka_inner.assigned_at
      FROM kiosk_assignments ka_inner
      WHERE ka_inner.kiosk_id = k.id
        AND ka_inner.unassigned_at IS NULL
      ORDER BY ka_inner.assigned_at DESC
      LIMIT 1
    ) ka ON TRUE
    LEFT JOIN locations l
      ON l.id = ka.location_id
    LEFT JOIN regions r
      ON r.id = l.primary_region_id
    LEFT JOIN sales_records s
      ON s.location_id = ka.location_id
     AND s.transaction_date >= NOW() - (${windowDays} || ' days')::interval
    WHERE k.archived_at IS NULL
      AND k.outlet_code IS NOT NULL
      AND k.alert_silenced_at IS NULL
      AND k.pipeline_stage_id = ${liveStageId}::uuid
    GROUP BY k.id, k.internal_poc_id, k.outlet_code, l.name, r.name, ka.location_id
  `);
  // node-postgres QueryResult: { rows: [...] }. Drizzle wraps it but the rows
  // array is accessible as result.rows for node-postgres driver.
  const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? (Array.isArray(result) ? result : []);

  const parsed = rawRows as Array<{
    kiosk_id: string;
    internal_poc_id: string | null;
    outlet_code: string;
    location_name: string | null;
    region: string | null;
    revenue: number;
    currency: string;
  }>;

  // Binary-search percentile rank: fraction of values strictly less than current value.
  // Sort ascending; for each kiosk find the first index >= its revenue.
  const sortedRevenues = parsed.map((r) => r.revenue).sort((a, b) => a - b);
  const total = sortedRevenues.length;

  const rows: ClassifiedKioskRow[] = parsed.map((r) => {
    let lo = 0;
    let hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedRevenues[mid] < r.revenue) lo = mid + 1;
      else hi = mid;
    }
    const percentile = total > 0 ? (lo / total) * 100 : 0;
    const tier = classifyOutletTier(percentile, tierConfig) as Tier;
    return {
      kioskId: r.kiosk_id,
      internalPocId: r.internal_poc_id,
      outletCode: r.outlet_code,
      locationName: r.location_name ?? "(no location)",
      region: r.region ?? "(no region)",
      revenue: r.revenue,
      currency: r.currency,
      percentile,
      tier,
    };
  });

  return { rows, tierConfig, windowDays, liveStageId };
}
