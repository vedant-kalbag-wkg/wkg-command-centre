/**
 * One-off READ-ONLY probe: inventory available install-date sources before
 * designing the kiosk_assignments.assignedAt backfill (audit task D4).
 *
 * Usage: source the prod env, then `npx tsx scripts/probe-install-dates.ts`.
 *
 * Runs only SELECT queries. No mutations.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;

async function q(label: string, query: ReturnType<typeof sql>): Promise<void> {
  const rows = (await db.execute(query)) as unknown as { rows?: Row[] } | Row[];
  const out = Array.isArray(rows) ? rows : (rows.rows ?? []);
  console.log(`\n=== ${label} ===`);
  for (const row of out) console.log(JSON.stringify(row));
}

async function main() {
  await q(
    "kiosk_assignments: createdAt vs assignedAt span (free backfill if createdAt spans years)",
    sql`SELECT
      COUNT(*) AS total_rows,
      MIN(created_at)::date AS created_min,
      MAX(created_at)::date AS created_max,
      MIN(assigned_at)::date AS assigned_min,
      MAX(assigned_at)::date AS assigned_max,
      COUNT(*) FILTER (WHERE assigned_at::date <> created_at::date) AS rows_where_dates_diverge
    FROM kiosk_assignments`,
  );

  await q(
    "kiosk_assignments: distribution of (assigned_at month, created_at month)",
    sql`SELECT
      to_char(assigned_at, 'YYYY-MM') AS assigned_month,
      to_char(created_at, 'YYYY-MM') AS created_month,
      COUNT(*) AS rows
    FROM kiosk_assignments
    GROUP BY 1, 2
    ORDER BY 1 DESC, 3 DESC
    LIMIT 30`,
  );

  await q(
    "locations.live_date population (Monday-sourced go-live)",
    sql`SELECT
      COUNT(*) AS total,
      COUNT(live_date) AS with_live_date,
      MIN(live_date)::date AS oldest,
      MAX(live_date)::date AS newest,
      COUNT(*) FILTER (WHERE live_date IS NULL AND archived_at IS NULL) AS active_without_live_date
    FROM locations`,
  );

  await q(
    "kiosks.installation_date population",
    sql`SELECT
      COUNT(*) AS total,
      COUNT(installation_date) AS with_installation_date,
      MIN(installation_date)::date AS oldest,
      MAX(installation_date)::date AS newest
    FROM kiosks`,
  );

  await q(
    "milestones.target_date by type (looking for go_live milestones)",
    sql`SELECT
      type,
      COUNT(*) AS rows,
      MIN(target_date)::date AS oldest,
      MAX(target_date)::date AS newest
    FROM milestones
    GROUP BY type
    ORDER BY rows DESC`,
  );

  await q(
    "Sales-data first-transaction-date per location (proxy lower bound for live_date)",
    sql`SELECT
      COUNT(*) FILTER (WHERE first_txn IS NOT NULL) AS locations_with_sales,
      MIN(first_txn)::date AS earliest_first_txn,
      MAX(first_txn)::date AS latest_first_txn
    FROM (
      SELECT location_id, MIN(transaction_date) AS first_txn
      FROM sales_records
      GROUP BY location_id
    ) t`,
  );

  await q(
    "audit_logs near 2026-04 with kiosk_assignments entity (looking for the mass-reseed event)",
    sql`SELECT
      to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at,
      actor_name,
      action,
      entity_type,
      COUNT(*) AS rows
    FROM audit_logs
    WHERE entity_type ILIKE '%kiosk_assignment%' OR entity_type ILIKE '%assignment%'
    GROUP BY 1, 2, 3, 4
    ORDER BY 1 DESC
    LIMIT 20`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
