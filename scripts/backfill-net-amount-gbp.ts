/**
 * Phase 9.1 Plan 09.1-05 Task 3 — backfill sales_records.net_amount_gbp for
 * historical rows (FX-02).
 *
 * Run:
 *   DATABASE_URL='<env>' npx tsx --tsconfig tsconfig.json \
 *     scripts/backfill-net-amount-gbp.ts [--dry-run]
 *
 * Idempotent: WHERE net_amount_gbp IS NULL — re-running on already-stamped
 * rows is a no-op (D-04). Restartable: cursor-based on (transaction_date, id).
 *
 * GBP rows: identity shortcut (no rate lookup).
 * Non-GBP rows: carry-forward from exchange_rates (D-05). BoE quote shape
 * means rate_to_gbp is foreign-per-GBP; conversion is net_amount / rate_to_gbp.
 *
 * Hard-fails (caller-visible throw + ROLLBACK):
 *   - No FX rate exists at-or-before transaction_date for a non-GBP row.
 *   - Most-recent rate is staleDays > 7 (D-07 ceiling).
 *
 * Operator gate: this script must be run to completion and report
 * `SELECT COUNT(*) FROM sales_records WHERE net_amount_gbp IS NULL` = 0
 * BEFORE migration 0048 (NOT NULL flip) is applied. RESEARCH Pitfall 7
 * — applying 0048 before backfill completes locks the table and stalls
 * the deploy.
 *
 * Test: tests/sales/backfill-net-amount-gbp.integration.test.ts (Wave 0
 * RED → GREEN once this file exists). The exported `runBackfill` is the
 * test surface; `main()` is the CLI entry.
 */
import { Pool, type PoolClient } from "pg";

import { daysBetweenIso } from "@/lib/fx/days-between-iso";

const CHUNK = 1000;

type SalesRow = {
  id: string;
  currency: string;
  net_amount: string;
  transaction_date: string;
};

type RateLookupResult = {
  rate: number;
  rateDate: string;
  staleDays: number;
};

async function lookupRate(
  client: PoolClient,
  currency: string,
  isoDate: string,
): Promise<RateLookupResult | null> {
  if (currency === "GBP") {
    return { rate: 1.0, rateDate: isoDate, staleDays: 0 };
  }
  const { rows } = await client.query<{ rate_to_gbp: string; rate_date: string }>(
    `SELECT rate_to_gbp::text AS rate_to_gbp, rate_date::text AS rate_date
     FROM exchange_rates
     WHERE currency = $1 AND rate_date <= $2
     ORDER BY rate_date DESC
     LIMIT 1`,
    [currency, isoDate],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  // Phase 9.1 gap closure (CR-04): pure-string-day arithmetic via the shared
  // helper. Mirrors the rate-lookup.ts call site so the two staleDays
  // computations cannot drift in a future refactor.
  const staleDays = daysBetweenIso(r.rate_date, isoDate);
  return {
    rate: Number(r.rate_to_gbp),
    rateDate: r.rate_date,
    staleDays,
  };
}

export type BackfillOptions = {
  dryRun?: boolean;
  /** Override the chunk size — exposed primarily for tests. */
  batchSize?: number;
  /**
   * Optional override for the connection pool — primarily for the
   * Testcontainers integration suite which already owns a Pool. Defaults to a
   * fresh `Pool({ connectionString: process.env.DATABASE_URL })`.
   */
  pool?: Pool;
};

export type BackfillResult = {
  /** Total rows that received a non-NULL net_amount_gbp this run. */
  updated: number;
};

/**
 * Core backfill driver. Owns the BEGIN / COMMIT / ROLLBACK shape so callers
 * (the CLI `main` and the integration test) only set policy.
 */
export async function runBackfill(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun ?? false;
  const chunkSize = options.batchSize ?? CHUNK;

  let pool: Pool;
  let ownsPool: boolean;
  if (options.pool) {
    pool = options.pool;
    ownsPool = false;
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    pool = new Pool({ connectionString: url });
    ownsPool = true;
  }

  const client = await pool.connect();
  let totalUpdated = 0;

  try {
    await client.query("BEGIN");

    // Cache rate lookups within a run — typically a backfill spans a small
    // number of (currency, date) combos relative to the row count.
    const rateCache = new Map<string, { rate: number; staleDays: number }>();

    let cursorDate: string | null = null;
    let cursorId: string | null = null;

    while (true) {
      // Phase 9.1 gap closure (CR-05): the cursor query previously cast
      // `id::text` in the WHERE tuple AND in ORDER BY. That collated UUIDs
      // lexicographically, defeating planner use of the (transaction_date,
      // id) PK index path and risking row-skips when text-collation order
      // disagreed with natural uuid sort. Fix: compare and order on the
      // uuid column directly; bind the cursor id with `$2::uuid` so pg
      // coerces the JS string. The SELECT projection keeps `id::text AS
      // id` so the JS `SalesRow.id` type stays string for downstream
      // consumers; that cast is purely a wire-format choice and does not
      // affect plan/skip behaviour.
      const result: { rows: SalesRow[] } =
        cursorDate && cursorId
          ? await client.query<SalesRow>(
              `SELECT id::text AS id,
                      currency,
                      net_amount::text AS net_amount,
                      transaction_date::text AS transaction_date
               FROM sales_records
               WHERE net_amount_gbp IS NULL
                 AND (transaction_date, id) > ($1::date, $2::uuid)
               ORDER BY transaction_date, id
               LIMIT $3`,
              [cursorDate, cursorId, chunkSize],
            )
          : await client.query<SalesRow>(
              `SELECT id::text AS id,
                      currency,
                      net_amount::text AS net_amount,
                      transaction_date::text AS transaction_date
               FROM sales_records
               WHERE net_amount_gbp IS NULL
               ORDER BY transaction_date, id
               LIMIT $1`,
              [chunkSize],
            );

      const rows: SalesRow[] = result.rows;
      if (rows.length === 0) break;

      const ids: string[] = [];
      const stamps: string[] = [];
      for (const row of rows) {
        const key = `${row.currency}|${row.transaction_date}`;
        let cached = rateCache.get(key);
        if (!cached) {
          const looked = await lookupRate(client, row.currency, row.transaction_date);
          if (!looked) {
            throw new Error(
              `Backfill halt: no FX rate exists for ${row.currency} on or before ${row.transaction_date} (first affected row id ${row.id})`,
            );
          }
          if (looked.staleDays > 7) {
            throw new Error(
              `Backfill halt: stale FX rate for ${row.currency} on ${row.transaction_date} (staleDays=${looked.staleDays} > 7; first affected row id ${row.id})`,
            );
          }
          cached = { rate: looked.rate, staleDays: looked.staleDays };
          rateCache.set(key, cached);
        }
        // D-04 GBP identity (preserves precision exactly).
        // D-05 non-GBP: net_amount / rate_to_gbp (BoE quotes are foreign-per-GBP).
        const stamp =
          row.currency === "GBP"
            ? row.net_amount
            : (Number(row.net_amount) / cached.rate).toFixed(2);
        ids.push(row.id);
        stamps.push(stamp);
      }

      await client.query(
        `UPDATE sales_records SET net_amount_gbp = data.gbp::numeric
         FROM (
           SELECT unnest($1::uuid[]) AS id,
                  unnest($2::numeric[]) AS gbp
         ) AS data
         WHERE sales_records.id = data.id`,
        [ids, stamps],
      );

      totalUpdated += rows.length;
      cursorDate = rows[rows.length - 1].transaction_date;
      cursorId = rows[rows.length - 1].id;
      // CLI progress logging — quiet in tests (the integration suite asserts
      // on the return shape, not stdout).
      if (process.env.NODE_ENV !== "test") {
        console.log(
          `Progress: ${totalUpdated} rows stamped (last ${cursorDate} / ${cursorId})`,
        );
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    if (ownsPool) {
      await pool.end();
    }
  }

  return { updated: totalUpdated };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", dryRun ? "DRY RUN (no writes)" : "WRITE");

  try {
    const { updated } = await runBackfill({ dryRun });
    if (dryRun) {
      console.log(`\nDry run — rolled back. Would have stamped ${updated} rows.`);
    } else {
      console.log(`\nCommitted. Stamped ${updated} rows.`);
    }
  } catch (err) {
    console.error("\nRolled back:", err);
    throw err;
  }
}

// Only run main() when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && /backfill-net-amount-gbp\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
