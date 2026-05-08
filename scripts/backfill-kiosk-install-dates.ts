/**
 * Phase 5.2 — Backfill historical install dates onto `kiosk_assignments`.
 *
 * The April 2026 Monday import (`scripts/import-from-monday.ts`, commit
 * 44245ca) was the first time `kiosk_assignments` was populated in
 * production; every row received `DEFAULT NOW()` for `assigned_at`, which
 * collapsed all 231 outlets into a single install cohort and broke the
 * Maturity dashboard. See `tasks/analytics-audit/phase-5-1-investigation.md`
 * for the full forensic breakdown.
 *
 * Per resolved decision **D4** (`tasks/todo.md:14`):
 *   1. Source of truth = `locations.live_date` (Monday "Live Estate")
 *   2. Fallback for outlets with no live_date but with sales =
 *      `MIN(sales_records.transaction_date)` per location (lower-bound proxy)
 *   3. Outlets with neither liveDate nor sales — leave the existing post-
 *      import timestamp in place. Per D4 these locations should appear with
 *      "no install date" semantically; doing that properly requires dropping
 *      the NOT NULL on `assigned_at` and refactoring all consumers, which is
 *      out of scope for this restoration. They have zero sales so the wrong
 *      maturity bucket has zero analytics impact.
 *
 * Scope: rows where `locations.archived_at IS NULL` AND
 * `kiosk_assignments.unassigned_at IS NULL` (currently-active assignments
 * only). Historical / ended assignments are left intact — their assigned_at
 * is also from the import but rewriting them risks violating the
 * `assigned_at <= unassigned_at` invariant. Their analytics impact is also
 * lower (they only feed historical kiosk-count rollups).
 *
 * Idempotent: skips rows whose current `assigned_at` already equals the
 * target value (within 1 second of the resolved date). Re-runs print
 * "0 updates" and exit cleanly.
 *
 * Interaction with Phase 5.3 immutability trigger: this script sets the
 * session variable `app.allow_assigned_at_mutation = 'on'` inside its
 * transaction so the trigger permits the writes. After commit the variable
 * scope ends, so subsequent connections see the trigger reject any other
 * UPDATE.
 *
 * Run:
 *   Dry-run (default — no writes, prints planned changes):
 *     DATABASE_URL=... npx tsx scripts/backfill-kiosk-install-dates.ts
 *   Apply:
 *     DATABASE_URL=... npx tsx scripts/backfill-kiosk-install-dates.ts --apply
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

type CandidateRow = {
  assignment_id: string;
  kiosk_id: string;
  location_id: string;
  outlet_code: string | null;
  location_name: string;
  current_assigned_at: string;
  source: "live_date" | "min_sales";
  target_assigned_at: string;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", APPLY ? "APPLY (writes + audit log)" : "DRY RUN (no writes)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Phase 5.3 — bypass the immutability trigger inside this transaction.
    // SET LOCAL is scoped to the transaction; on COMMIT/ROLLBACK the variable
    // disappears.
    await client.query(`SET LOCAL app.allow_assigned_at_mutation = 'on'`);

    // Build the candidate set in SQL: one row per active assignment, with
    // its resolved target timestamp. Only emits rows where the target
    // differs from the current value (the idempotency guard).
    const candidates = await client.query<CandidateRow>(`
      WITH sales_min AS (
        SELECT location_id, MIN(transaction_date) AS first_sale
        FROM sales_records
        GROUP BY location_id
      ),
      target AS (
        SELECT
          ka.id          AS assignment_id,
          ka.kiosk_id,
          ka.location_id,
          l.customer_code AS outlet_code,
          l.name         AS location_name,
          ka.assigned_at AS current_assigned_at,
          CASE
            WHEN l.live_date IS NOT NULL THEN 'live_date'
            WHEN sm.first_sale IS NOT NULL THEN 'min_sales'
            ELSE NULL
          END AS source,
          CASE
            WHEN l.live_date IS NOT NULL
              THEN (l.live_date AT TIME ZONE 'UTC')
            WHEN sm.first_sale IS NOT NULL
              THEN (sm.first_sale::timestamp AT TIME ZONE 'UTC')
            ELSE NULL
          END AS target_assigned_at
        FROM kiosk_assignments ka
        JOIN locations l ON l.id = ka.location_id
        LEFT JOIN sales_min sm ON sm.location_id = ka.location_id
        WHERE l.archived_at IS NULL
          AND ka.unassigned_at IS NULL
      )
      SELECT
        assignment_id,
        kiosk_id,
        location_id,
        outlet_code,
        location_name,
        current_assigned_at::text AS current_assigned_at,
        source,
        target_assigned_at::text  AS target_assigned_at
      FROM target
      WHERE target_assigned_at IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (current_assigned_at - target_assigned_at))) > 1
      ORDER BY source, location_name
    `);

    const liveDateRows = candidates.rows.filter((r) => r.source === "live_date");
    const salesMinRows = candidates.rows.filter((r) => r.source === "min_sales");

    // Locations the script declines to touch — surface in the report so the
    // operator knows the outcome is intentional, not a silent miss.
    const skipped = await client.query<{
      n_archived_loc_active: number;
      n_no_source_active: number;
      n_already_correct_active: number;
      n_ended_assignments: number;
    }>(`
      WITH sales_min AS (
        SELECT location_id, MIN(transaction_date) AS first_sale
        FROM sales_records
        GROUP BY location_id
      )
      SELECT
        COUNT(*) FILTER (
          WHERE l.archived_at IS NOT NULL AND ka.unassigned_at IS NULL
        )::int AS n_archived_loc_active,
        COUNT(*) FILTER (
          WHERE l.archived_at IS NULL
            AND ka.unassigned_at IS NULL
            AND l.live_date IS NULL
            AND sm.first_sale IS NULL
        )::int AS n_no_source_active,
        COUNT(*) FILTER (
          WHERE l.archived_at IS NULL
            AND ka.unassigned_at IS NULL
            AND (
              l.live_date IS NOT NULL
              OR sm.first_sale IS NOT NULL
            )
            AND ABS(EXTRACT(EPOCH FROM (
              ka.assigned_at - COALESCE(
                l.live_date AT TIME ZONE 'UTC',
                sm.first_sale::timestamp AT TIME ZONE 'UTC'
              )
            ))) <= 1
        )::int AS n_already_correct_active,
        COUNT(*) FILTER (
          WHERE ka.unassigned_at IS NOT NULL
        )::int AS n_ended_assignments
      FROM kiosk_assignments ka
      JOIN locations l ON l.id = ka.location_id
      LEFT JOIN sales_min sm ON sm.location_id = ka.location_id
    `);

    console.log("\n--- Backfill plan ---");
    console.log(`  → live_date source : ${liveDateRows.length} assignments`);
    console.log(`  → min_sales source : ${salesMinRows.length} assignments`);
    console.log(`  Skipped (intentional):`);
    console.log(`    • already correct (idempotent re-run): ${skipped.rows[0].n_already_correct_active}`);
    console.log(`    • no live_date and no sales         : ${skipped.rows[0].n_no_source_active} (left at import-time stamp; per D4)`);
    console.log(`    • ended assignments (unassigned_at)  : ${skipped.rows[0].n_ended_assignments} (preserve history)`);
    console.log(`    • archived locations                  : ${skipped.rows[0].n_archived_loc_active}`);

    if (candidates.rowCount === 0) {
      console.log("\n✓ Nothing to update — re-run is a no-op (idempotent).");
      await client.query("ROLLBACK");
      return;
    }

    // Sample for visibility — first 5 of each source.
    const previewRows = (rows: CandidateRow[], n: number) => rows.slice(0, n);
    if (liveDateRows.length > 0) {
      console.log("\n  Sample of live_date updates (first 5):");
      for (const r of previewRows(liveDateRows, 5)) {
        console.log(
          `    ${r.outlet_code ?? "—"}  ${r.location_name}: ${r.current_assigned_at} → ${r.target_assigned_at}`,
        );
      }
    }
    if (salesMinRows.length > 0) {
      console.log("\n  Sample of min_sales fallback updates (first 5):");
      for (const r of previewRows(salesMinRows, 5)) {
        console.log(
          `    ${r.outlet_code ?? "—"}  ${r.location_name}: ${r.current_assigned_at} → ${r.target_assigned_at}`,
        );
      }
    }

    if (!APPLY) {
      console.log("\n--- DRY RUN — no rows written. Re-run with --apply to execute. ---");
      await client.query("ROLLBACK");
      return;
    }

    // Single bulk UPDATE keyed on assignment_id, target embedded as the
    // resolved CASE expression so each row gets the right value in one
    // statement rather than N round-trips.
    const updateSql = `
      WITH sales_min AS (
        SELECT location_id, MIN(transaction_date) AS first_sale
        FROM sales_records
        GROUP BY location_id
      )
      UPDATE kiosk_assignments ka
      SET assigned_at = CASE
        WHEN l.live_date IS NOT NULL
          THEN (l.live_date AT TIME ZONE 'UTC')
        WHEN sm.first_sale IS NOT NULL
          THEN (sm.first_sale::timestamp AT TIME ZONE 'UTC')
      END
      FROM locations l
      LEFT JOIN sales_min sm ON sm.location_id = l.id
      WHERE l.id = ka.location_id
        AND l.archived_at IS NULL
        AND ka.unassigned_at IS NULL
        AND ka.id = ANY($1::uuid[])
    `;
    const updated = await client.query(updateSql, [
      candidates.rows.map((r) => r.assignment_id),
    ]);
    console.log(`\n  Updated ${updated.rowCount} kiosk_assignments rows.`);

    // Audit log — one row per affected assignment so a future operator can
    // trace exactly which rows moved and why. Mirrors writeAuditLog's
    // column shape; keeps the script self-contained (raw pg, no Drizzle).
    let auditWritten = 0;
    for (const r of candidates.rows) {
      await client.query(
        `
        INSERT INTO audit_logs
          (actor_id, actor_name, entity_type, entity_id, entity_name,
           action, field, old_value, new_value, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
        `,
        [
          ETL_SYSTEM_USER_ID,
          "ETL System (backfill-kiosk-install-dates)",
          "kiosk_assignment",
          r.assignment_id,
          `${r.outlet_code ?? "—"} ${r.location_name}`,
          "update",
          "assigned_at",
          r.current_assigned_at,
          r.target_assigned_at,
          JSON.stringify({
            reason:
              "Phase 5.2 / D4 — restore historical install date after Apr-18 Monday import reseed",
            source: r.source,
            location_id: r.location_id,
            kiosk_id: r.kiosk_id,
            script: "scripts/backfill-kiosk-install-dates.ts",
          }),
        ],
      );
      auditWritten++;
    }
    console.log(`  Wrote ${auditWritten} audit_logs rows.`);

    // Idempotency self-check inside the same transaction. Expect zero
    // remaining candidates — the same query that produced the plan should
    // now return no rows.
    const recheck = await client.query<{ n: number }>(`
      WITH sales_min AS (
        SELECT location_id, MIN(transaction_date) AS first_sale
        FROM sales_records
        GROUP BY location_id
      )
      SELECT COUNT(*)::int AS n
      FROM kiosk_assignments ka
      JOIN locations l ON l.id = ka.location_id
      LEFT JOIN sales_min sm ON sm.location_id = ka.location_id
      WHERE l.archived_at IS NULL
        AND ka.unassigned_at IS NULL
        AND (
          l.live_date IS NOT NULL
          OR sm.first_sale IS NOT NULL
        )
        AND ABS(EXTRACT(EPOCH FROM (
          ka.assigned_at - COALESCE(
            l.live_date AT TIME ZONE 'UTC',
            sm.first_sale::timestamp AT TIME ZONE 'UTC'
          )
        ))) > 1
    `);
    console.log(
      `  Post-update residual: ${recheck.rows[0].n} (idempotent: re-run would do nothing).`,
    );

    await client.query("COMMIT");
    console.log("\n✓ Committed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n✗ Rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
