/**
 * Phase 6 plan 06-07 — measure the cross-batch reversal orphan rate against a
 * live DB.
 *
 * Background: the analytics audit observed a ~2% orphan gap (refund rows in
 * `sales_records` with `original_record_id IS NULL` after the matcher had
 * a fair shot at them). Per `tasks/handoff-2026-04-27-pr-28-open.md` §4 this
 * gap is a known data property — refunds for bookings that predate the
 * imported sales window — but until now there was no code to measure it.
 *
 * This script:
 *   1. Fetches every reversal row whose `original_record_id IS NULL`.
 *   2. Fetches every positive-amount candidate sharing one of their `ref_no`s.
 *   3. Runs `applyCrossBatchMatches` offline against those rows.
 *   4. Prints the matched/orphan split + orphan-rate %.
 *
 * It is READ-ONLY — no INSERTs / UPDATEs / DELETEs. Safe to run against
 * staging or production. The matcher is pure, so a re-run produces an
 * identical answer for the same DB snapshot.
 *
 * Usage:
 *   DATABASE_URL='<connection-string>' npx tsx scripts/measure-reversal-orphan-rate.ts
 *
 * After running, paste the printed "baseline" line into
 * `src/lib/sales/reversal-matcher.test.ts` (the comment block at the top of
 * the `applyCrossBatchMatches` describe) so future drift surfaces in code
 * review.
 */
import { Pool } from "pg";

import { applyCrossBatchMatches, type ReversalCandidate } from "@/lib/sales/reversal-matcher";

type SalesRow = {
  id: string;
  ref_no: string;
  net_amount: string;
  transaction_date: string;
  location_id: string;
};

const toCandidate = (r: SalesRow): ReversalCandidate => ({
  id: r.id,
  refNo: r.ref_no,
  netAmount: r.net_amount,
  transactionDate: r.transaction_date,
  locationId: r.location_id,
});

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  // Mask credentials in the printed banner so the operator can paste output
  // into a ticket without leaking secrets.
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // 1. Refunds whose match attempt left them orphaned (original_record_id
    //    is still NULL after the in-batch + cross-batch passes at ingest).
    const refundsRes = await client.query<SalesRow>(`
      SELECT id, ref_no, net_amount::text AS net_amount,
             transaction_date::text AS transaction_date, location_id
        FROM sales_records
       WHERE is_reversal = true
         AND original_record_id IS NULL
    `);

    const totalRefunds = refundsRes.rows.length;
    if (totalRefunds === 0) {
      console.log("No unmatched refunds — orphan rate is 0/0 (nothing to measure).");
      return;
    }

    // 2. Candidates: any positive-amount row sharing one of the orphan refunds'
    //    ref_no values. We dedupe via Set to keep the IN-list small.
    const refNos = [...new Set(refundsRes.rows.map((r) => r.ref_no))];
    const candidatesRes = await client.query<SalesRow>(
      `
      SELECT id, ref_no, net_amount::text AS net_amount,
             transaction_date::text AS transaction_date, location_id
        FROM sales_records
       WHERE is_reversal = false
         AND net_amount::numeric > 0
         AND ref_no = ANY($1::text[])
    `,
      [refNos],
    );

    // 3. Run the matcher offline. We don't expect cross-batch matches to fire
    //    (the orphans are already cross-batch survivors) — but if any DO match
    //    here, it means a previously-orphaned refund now has a viable original
    //    in the data window, which is information worth surfacing.
    const refunds: ReversalCandidate[] = refundsRes.rows.map(toCandidate);
    const candidates: ReversalCandidate[] = candidatesRes.rows.map(toCandidate);
    const { matches, orphans } = applyCrossBatchMatches(refunds, candidates);

    // 4. Print the split.
    const orphanRate = (orphans.length / totalRefunds) * 100;
    const today = new Date().toISOString().slice(0, 10);
    console.log("");
    console.log("=== Reversal Orphan Rate ===");
    console.log(`  Total NULL-original refunds:        ${totalRefunds}`);
    console.log(`  Newly matched on re-run (offline):  ${matches.length}`);
    console.log(`  Still orphaned:                     ${orphans.length}`);
    console.log(`  Orphan rate:                        ${orphanRate.toFixed(2)}%`);
    console.log("");
    console.log("Update the baseline comment in src/lib/sales/reversal-matcher.test.ts:");
    console.log(
      `  // <env> ${today}: ${orphans.length}/${totalRefunds} = ${orphanRate.toFixed(2)}% orphan rate`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
