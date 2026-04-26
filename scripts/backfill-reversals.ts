/**
 * One-shot backfill: populate sales_records.is_reversal /
 * is_partial_reversal / original_record_id / processed_at_location_id on
 * existing rows that were ingested before D2's reversal handling landed.
 *
 * Mirrors the runtime matcher in src/lib/sales/reversal-matcher.ts: a refund
 * is a row with net_amount < 0; its original is the row sharing the same
 * region_id + ref_no whose net_amount is positive and >= the refund's
 * magnitude. Most-recent by transaction_date wins. For each match we:
 *
 *   - rewrite location_id to the original's location_id (so cancellations
 *     attribute to the booking outlet, not Customer Service);
 *   - store the previous location_id in processed_at_location_id (audit);
 *   - set original_record_id and is_partial_reversal accordingly.
 *
 * Idempotent: skips any row already flagged is_reversal = true. Matched
 * refunds keep their original_record_id / location_id rewrite from the first
 * run; orphans (is_reversal = true with original_record_id NULL) stay
 * orphans — the script is a one-shot, not an iterative re-matcher.
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *        scripts/backfill-reversals.ts [--dry-run]
 */
import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

type RefundRow = {
  id: string;
  region_id: string;
  ref_no: string;
  net_amount: string;
  transaction_date: string;
  location_id: string;
};

type OriginalRow = {
  id: string;
  region_id: string;
  ref_no: string;
  net_amount: string;
  transaction_date: string;
  location_id: string;
};

const abs = (n: string): number => Math.abs(Number(n));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", DRY_RUN ? "DRY RUN (no writes)" : "WRITE");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Refund candidates: every negative-amount row not yet flagged as a
    //    reversal. Once is_reversal=true is set we never re-process — matching
    //    is order-dependent (most-recent original wins, originals consumed at
    //    most once) and re-running over a partial-state DB would produce
    //    different answers from the original run.
    const refundsQ = await client.query<RefundRow>(`
      SELECT id, region_id, ref_no, net_amount::text, transaction_date::text, location_id
      FROM sales_records
      WHERE net_amount < 0
        AND is_reversal = false
      ORDER BY region_id, ref_no, transaction_date
    `);
    console.log(`\nRefund rows to process: ${refundsQ.rowCount}`);

    if (refundsQ.rowCount === 0) {
      console.log("Nothing to do.");
      await client.query(DRY_RUN ? "ROLLBACK" : "COMMIT");
      return;
    }

    // 2. Pull all positive-amount candidates sharing those (region_id, ref_no)
    //    pairs in one batch, then group in JS so the matching algorithm here
    //    matches the runtime one byte-for-byte.
    const refByKey = new Map<string, RefundRow[]>();
    for (const r of refundsQ.rows) {
      const key = `${r.region_id}|${r.ref_no}`;
      const list = refByKey.get(key);
      if (list) list.push(r);
      else refByKey.set(key, [r]);
    }

    const refNos = Array.from(new Set(refundsQ.rows.map((r) => r.ref_no)));
    const regionIds = Array.from(new Set(refundsQ.rows.map((r) => r.region_id)));
    const origsQ = await client.query<OriginalRow>(
      `SELECT id, region_id, ref_no, net_amount::text, transaction_date::text, location_id
       FROM sales_records
       WHERE net_amount > 0
         AND region_id = ANY($1::uuid[])
         AND ref_no = ANY($2::text[])`,
      [regionIds, refNos],
    );

    const origByKey = new Map<string, OriginalRow[]>();
    for (const o of origsQ.rows) {
      const key = `${o.region_id}|${o.ref_no}`;
      const list = origByKey.get(key);
      if (list) list.push(o);
      else origByKey.set(key, [o]);
    }

    // 3. Match. Same most-recent rule + at-most-once consumption as the
    //    runtime matcher (see src/lib/sales/reversal-matcher.ts).
    let matchedFull = 0;
    let matchedPartial = 0;
    let orphans = 0;

    type Update = {
      refundId: string;
      originalId: string;
      originalLocationId: string;
      previousLocationId: string;
      isPartial: boolean;
    };
    type OrphanUpdate = { refundId: string };
    const updates: Update[] = [];
    const orphanUpdates: OrphanUpdate[] = [];

    for (const [key, refunds] of refByKey) {
      const candidates = (origByKey.get(key) ?? []).slice();
      // Process refunds in date order so the earliest refund picks first.
      refunds.sort((a, b) => (a.transaction_date < b.transaction_date ? -1 : 1));
      for (const refund of refunds) {
        const refundMag = abs(refund.net_amount);
        let bestIdx = -1;
        for (let i = 0; i < candidates.length; i++) {
          if (abs(candidates[i].net_amount) >= refundMag) {
            if (bestIdx === -1 || candidates[i].transaction_date > candidates[bestIdx].transaction_date) {
              bestIdx = i;
            }
          }
        }
        if (bestIdx === -1) {
          orphans++;
          orphanUpdates.push({ refundId: refund.id });
          continue;
        }
        const original = candidates[bestIdx];
        candidates.splice(bestIdx, 1);
        const isPartial = refundMag < abs(original.net_amount);
        if (isPartial) matchedPartial++;
        else matchedFull++;
        updates.push({
          refundId: refund.id,
          originalId: original.id,
          originalLocationId: original.location_id,
          previousLocationId: refund.location_id,
          isPartial,
        });
      }
    }

    console.log(`\n--- Match summary ---`);
    console.log(`  scanned:   ${refundsQ.rowCount}`);
    console.log(`  full:      ${matchedFull}`);
    console.log(`  partial:   ${matchedPartial}`);
    console.log(`  orphans:   ${orphans}`);

    // 4. Apply updates. Two passes: matched (rewrite location_id + set
    //    original/partial/processed_at) and orphans (just flip is_reversal).
    if (updates.length > 0) {
      const matchedSql = `
        UPDATE sales_records SET
          is_reversal = true,
          is_partial_reversal = data.is_partial::boolean,
          original_record_id = data.original_id::uuid,
          processed_at_location_id = data.previous_location_id::uuid,
          location_id = data.original_location_id::uuid
        FROM (
          SELECT
            unnest($1::uuid[]) AS refund_id,
            unnest($2::uuid[]) AS original_id,
            unnest($3::uuid[]) AS original_location_id,
            unnest($4::uuid[]) AS previous_location_id,
            unnest($5::boolean[]) AS is_partial
        ) AS data
        WHERE sales_records.id = data.refund_id
      `;
      await client.query(matchedSql, [
        updates.map((u) => u.refundId),
        updates.map((u) => u.originalId),
        updates.map((u) => u.originalLocationId),
        updates.map((u) => u.previousLocationId),
        updates.map((u) => u.isPartial),
      ]);
    }

    if (orphanUpdates.length > 0) {
      await client.query(
        `UPDATE sales_records SET is_reversal = true
         WHERE id = ANY($1::uuid[])`,
        [orphanUpdates.map((o) => o.refundId)],
      );
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\nDry run — rolled back.");
    } else {
      await client.query("COMMIT");
      console.log("\nCommitted.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nRolled back:", err);
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
