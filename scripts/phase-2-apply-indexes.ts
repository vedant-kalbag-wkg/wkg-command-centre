#!/usr/bin/env -S npx tsx
/**
 * Phase 2 DDL runner — applies the two new indexes outside drizzle-kit
 * because CREATE INDEX CONCURRENTLY cannot be wrapped in a transaction.
 *
 * Usage:
 *   npx tsx --env-file=<env> scripts/phase-2-apply-indexes.ts --check
 *   npx tsx --env-file=<env> scripts/phase-2-apply-indexes.ts --apply
 *   npx tsx --env-file=<env> scripts/phase-2-apply-indexes.ts --rollback
 *
 * --check is read-only and always safe. --apply refuses to run unless
 * --check was executed against the same DB host within the last hour.
 */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import { resolve } from "node:path";

const INDEXES = [
  {
    name: "sales_records_txn_loc_covering_idx",
    table: "sales_records",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_records_txn_loc_covering_idx"
          ON "sales_records" ("transaction_date", "location_id")
          INCLUDE ("gross_amount", "quantity", "product_id")`,
    rollback: `DROP INDEX CONCURRENTLY IF EXISTS "sales_records_txn_loc_covering_idx"`,
  },
  {
    name: "kiosk_assignments_loc_assigned_idx",
    table: "kiosk_assignments",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "kiosk_assignments_loc_assigned_idx"
          ON "kiosk_assignments" ("location_id", "assigned_at")`,
    rollback: `DROP INDEX CONCURRENTLY IF EXISTS "kiosk_assignments_loc_assigned_idx"`,
  },
];

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const RESULTS_DIR = resolve(REPO_ROOT, "test-results");

function hostHash(url: string): string {
  const host = new URL(url).host;
  return createHash("sha256").update(host).digest("hex").slice(0, 12);
}

function stampPath(url: string): string {
  return resolve(RESULTS_DIR, `.phase-2-preflight-stamp-${hostHash(url)}`);
}

async function runCheck(url: string): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const outPath = resolve(RESULTS_DIR, `phase-2-preflight-${Date.now()}.txt`);
  const lines: string[] = [];

  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };

  try {
    log(`# Phase 2 preflight — ${new Date().toISOString()}`);
    log(`# DB host: ${new URL(url).host}`);
    log("");

    for (const tbl of ["sales_records", "kiosk_assignments"]) {
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM ${sql(tbl)}
      `;
      log(`## ${tbl}`);
      log(`rows: ${count}`);
      const indexes = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${tbl}
        ORDER BY indexname
      `;
      log(`current indexes (${indexes.length}):`);
      for (const idx of indexes) log(`  ${idx.indexname}: ${idx.indexdef}`);
      log("");
    }

    // Surface any INVALID indexes left from a failed concurrent build
    const invalids = await sql<{ indexname: string }[]>`
      SELECT c.relname AS indexname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ANY(${INDEXES.map((idx) => idx.name)})
        AND NOT i.indisvalid
    `;
    if (invalids.length > 0) {
      log(`## WARNING: INVALID indexes detected`);
      for (const row of invalids) log(`  ${row.indexname} — must DROP and re-CREATE`);
      log("");
    }

    log("## EXPLAIN: getPortfolioSummary-shape");
    const explain1 = await sql<{ "QUERY PLAN": string }[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT
        sr.location_id,
        SUM(sr.gross_amount) AS revenue,
        SUM(sr.quantity)     AS units
      FROM sales_records sr
      INNER JOIN locations l ON sr.location_id = l.id
      WHERE sr.transaction_date >= (CURRENT_DATE - INTERVAL '90 days')::date
        AND NOT (l.outlet_code = 'TEST')
      GROUP BY sr.location_id
    `;
    for (const row of explain1) log(`  ${row["QUERY PLAN"]}`);
    log("");

    log("## EXPLAIN: kioskLiveDateSubquery-shape (correlated MIN)");
    const explain2 = await sql<{ "QUERY PLAN": string }[]>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT
        l.id,
        (SELECT MIN(assigned_at) FROM kiosk_assignments ka WHERE ka.location_id = l.id) AS first_live
      FROM locations l
      WHERE NOT (l.outlet_code = 'TEST')
      LIMIT 50
    `;
    for (const row of explain2) log(`  ${row["QUERY PLAN"]}`);

    writeFileSync(outPath, lines.join("\n"));
    writeFileSync(stampPath(url), String(Date.now()));
    log("");
    log(`# Saved to: ${outPath}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runApply(url: string): Promise<void> {
  const stamp = stampPath(url);
  if (!existsSync(stamp)) {
    throw new Error(`Safety rail: run --check against this DB host first.`);
  }
  const ts = Number(readFileSync(stamp, "utf8"));
  if (Date.now() - ts > 60 * 60 * 1000) {
    throw new Error(`Safety rail: preflight stamp is >1h old. Re-run --check.`);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const invalids = await sql<{ indexname: string }[]>`
      SELECT c.relname AS indexname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ANY(${INDEXES.map((idx) => idx.name)})
        AND NOT i.indisvalid
    `;
    if (invalids.length > 0) {
      throw new Error(
        `Cannot apply: INVALID indexes exist (left from a failed concurrent build): ${invalids.map((r) => r.indexname).join(", ")}. Run --rollback first to drop them.`,
      );
    }

    for (const idx of INDEXES) {
      console.log(`[apply] ${idx.name} — starting`);
      const t0 = Date.now();
      await sql.unsafe(idx.ddl);
      console.log(`[apply] ${idx.name} — done in ${Date.now() - t0}ms`);
    }
    console.log("[apply] all indexes applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runRollback(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const idx of INDEXES) {
      console.log(`[rollback] dropping ${idx.name}`);
      await sql.unsafe(idx.rollback);
    }
    console.log("[rollback] done");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const mode = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Use --env-file=.env.neon-dev or similar.");
  process.exit(1);
}

const fn = mode === "--check" ? runCheck
  : mode === "--apply" ? runApply
  : mode === "--rollback" ? runRollback
  : null;

if (!fn) {
  console.error(`Usage: ${process.argv[1]} --check | --apply | --rollback`);
  process.exit(1);
}

fn(url).catch((err) => {
  console.error(err);
  process.exit(1);
});
