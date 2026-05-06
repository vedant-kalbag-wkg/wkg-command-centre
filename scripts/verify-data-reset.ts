/**
 * Phase 7 Plan 07-05 (D-13) — read-only invariant suite for the data-reset
 * runbook. Run after `scripts/v2-wipe-and-reseed.ts --apply` against any
 * database (UAT Neon branch first, then prod) and capture the structured
 * JSON + Markdown summary as evidence.
 *
 * Read-only by construction:
 *   - No INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER statements.
 *   - Only SELECTs against the wiped/preserved tables.
 *
 * Output:
 *   stdout — single well-formed JSON object: { timestamp, results, summary }.
 *   stderr — human-readable Markdown table summary.
 *   --out=<path> — optional: also write the JSON to that file.
 *   exit code — 0 if zero `fail` invariants; 1 otherwise. `warn` does NOT
 *               trigger non-zero exit (sentinel orphans + assigned_at NULL
 *               count are expected to be non-zero on a real corpus).
 *
 * Filtering:
 *   --check=<family> runs only the named invariant family. Families:
 *     locations | kiosks | sales | orphans | same_name | sentinel
 *     | assigned_at | audit_log
 *   Useful for VALIDATION.md per-task-row commands and triaging individual
 *   failures without re-running the entire suite.
 *
 * Goldens:
 *   Parsed at runtime from `.planning/phases/07-data-foundation-rebuild/
 *   07-PREFLIGHT-REPORT.md` to keep a single source of truth. The report's
 *   "Plan B / Plan E Inputs" code block emits these constants. Revenue is
 *   read as a string (numeric(12,2) decimal pounds per src/db/schema.ts:731-732)
 *   to avoid float-precision drift on the corpus aggregate.
 *
 * Invocation:
 *   DATABASE_URL=... npx tsx scripts/verify-data-reset.ts
 *   DATABASE_URL=... npx tsx scripts/verify-data-reset.ts --check=sentinel
 *   DATABASE_URL=... npx tsx scripts/verify-data-reset.ts --out=report.json
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";

interface InvariantResult {
  name: string;
  status: "pass" | "fail" | "warn";
  expected?: number | string;
  actual?: number | string;
  detail?: string;
}

const CHECK_FILTER = process.argv.find((a) => a.startsWith("--check="))?.split("=")[1] ?? null;
const REPORT_OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;

// Parse golden constants from Plan A report. Numeric goldens are returned as
// numbers; string goldens (revenue) are returned as strings to preserve the
// exact decimal shape captured at preflight time. Mixed return type matches
// the `expected: number | string` in InvariantResult.
function loadGoldens(): Record<string, number | string> {
  const reportPath = ".planning/phases/07-data-foundation-rebuild/07-PREFLIGHT-REPORT.md";
  const raw = readFileSync(reportPath, "utf8");
  const goldens: Record<string, number | string> = {};
  // Numeric: export const FOO = 123;
  for (const m of raw.matchAll(/export const (GOLDEN_[A-Z_]+) = (\d+);/g)) {
    goldens[m[1]] = parseInt(m[2], 10);
  }
  // String: export const FOO = "123.45";
  for (const m of raw.matchAll(/export const (GOLDEN_[A-Z_]+) = "([^"]+)";/g)) {
    goldens[m[1]] = m[2];
  }
  return goldens;
}

async function runInvariants(
  client: import("pg").PoolClient,
  goldens: Record<string, number | string>,
): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];

  const include = (family: string) => CHECK_FILTER === null || CHECK_FILTER === family;

  if (include("locations")) {
    const r = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM locations WHERE archived_at IS NULL`,
    );
    const actual = r.rows[0].c;
    const expected = goldens.GOLDEN_LOCATIONS_ACTIVE as number;
    results.push({
      name: "locations.active count vs golden",
      status: actual === expected ? "pass" : "fail",
      expected,
      actual,
    });
  }

  if (include("kiosks")) {
    const r = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM kiosks WHERE archived_at IS NULL`,
    );
    const actual = r.rows[0].c;
    const expected = goldens.GOLDEN_KIOSKS_ACTIVE as number;
    results.push({
      name: "kiosks.active count vs golden",
      status: actual === expected ? "pass" : "fail",
      expected,
      actual,
    });
  }

  if (include("sales")) {
    const r = await client.query<{ c: string }>(
      `SELECT COUNT(*)::bigint AS c FROM sales_records`,
    );
    const actual = parseInt(r.rows[0].c, 10);
    const expected = goldens.GOLDEN_SALES_RECORDS as number;
    results.push({
      name: "sales_records count vs golden",
      status: actual === expected ? "pass" : "fail",
      expected,
      actual,
    });
    // sales_records gross revenue: net_amount + vat_amount are numeric(12,2)
    // pounds per src/db/schema.ts:731-732. Compare as the exact decimal string
    // (cast to text) — avoids float-precision drift on a numeric corpus.
    const sum = await client.query<{ s: string }>(
      `SELECT COALESCE(SUM(net_amount + vat_amount), 0)::text AS s FROM sales_records`,
    );
    const actualSum: string = sum.rows[0].s;
    const expectedSum = goldens.GOLDEN_TOTAL_REVENUE_GROSS_GBP as string;
    results.push({
      name: "sales_records total revenue (gross GBP) vs golden",
      status: actualSum === expectedSum ? "pass" : "fail",
      expected: expectedSum,
      actual: actualSum,
    });
  }

  if (include("orphans")) {
    // No orphan kiosk_assignments — every assignment must point at a live
    // kiosk + live location. LEFT JOINs filtered on archived_at IS NULL turn
    // archived endpoints into NULLs, then the WHERE catches them.
    const r = await client.query<{ c: number }>(`
      SELECT COUNT(*)::int AS c
      FROM kiosk_assignments ka
      LEFT JOIN kiosks k ON k.id = ka.kiosk_id AND k.archived_at IS NULL
      LEFT JOIN locations l ON l.id = ka.location_id AND l.archived_at IS NULL
      WHERE k.id IS NULL OR l.id IS NULL
    `);
    const actual = r.rows[0].c;
    results.push({
      name: "no orphan kiosk_assignments (FK to live kiosk + live location)",
      status: actual === 0 ? "pass" : "fail",
      expected: 0,
      actual,
    });
  }

  if (include("same_name")) {
    // Same-name invariant — mirror src/lib/locations/same-name-detection.ts
    // exactly, but called via raw SQL to avoid pulling Drizzle into a pg-Pool
    // script. The sentinel's normalised name "locationneeded" is excluded
    // (it's unique by construction; explicit exclusion matches the helper).
    const r = await client.query<{ c: number }>(`
      SELECT COUNT(*)::int AS c FROM (
        SELECT normalised_name FROM locations
        WHERE archived_at IS NULL AND normalised_name IS NOT NULL
          AND normalised_name <> 'locationneeded'
        GROUP BY normalised_name HAVING COUNT(*) > 1
      ) g
    `);
    const actual = r.rows[0].c;
    results.push({
      name: "no active same-name groups (excluding sentinel)",
      status: actual === 0 ? "pass" : "fail",
      expected: 0,
      actual,
    });
  }

  if (include("sentinel")) {
    // LOCATION_NEEDED sentinel: existence is a hard pass/fail; orphan count
    // attached to it is informational — surfaced as WARN, not FAIL, because
    // orphans are an expected by-product of sales-ETL (D-06 / DATA-04).
    const sentinel = await client.query<{ id: string }>(`
      SELECT id FROM locations
      WHERE outlet_code = '__LOCATION_NEEDED__' AND name = 'LOCATION_NEEDED'
      LIMIT 1
    `);
    if (sentinel.rows.length === 0) {
      results.push({
        name: "LOCATION_NEEDED sentinel exists",
        status: "fail",
        expected: "1 row",
        actual: "0 rows",
      });
    } else {
      results.push({
        name: "LOCATION_NEEDED sentinel exists",
        status: "pass",
        expected: "1 row",
        actual: "1 row",
      });
      const orphans = await client.query<{ c: number }>(
        `SELECT COUNT(DISTINCT kiosk_id)::int AS c FROM kiosk_assignments WHERE location_id = $1`,
        [sentinel.rows[0].id],
      );
      const c = orphans.rows[0].c;
      results.push({
        name: "LOCATION_NEEDED orphan kiosk count (informational)",
        status: "warn",
        actual: c,
        detail: c === 0 ? "no orphans — clean" : `${c} orphan kiosks pending triage`,
      });
    }
  }

  if (include("assigned_at")) {
    // Two-pass backfill coverage: NULL count among kiosk_assignments rows.
    // Surfaced as WARN when non-zero — corpus depth is the limiting factor
    // (kiosks with no live_date and no sales legitimately have NULL here).
    const r = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM kiosk_assignments WHERE assigned_at IS NULL`,
    );
    const actual = r.rows[0].c;
    results.push({
      name: "kiosk_assignments.assigned_at coverage (NULL count after two-pass backfill)",
      status: actual === 0 ? "pass" : "warn",
      expected: 0,
      actual,
      detail:
        actual === 0
          ? undefined
          : `${actual} assignments still NULL — likely kiosks with no live_date and no sales corpus coverage`,
    });
  }

  if (include("audit_log")) {
    // Runbook leaves an audit trail. v2-wipe-and-reseed.ts writes TWO rows
    // when --apply runs end-to-end:
    //   - Phase 1 (structural):  entity_name='v2-wipe-and-reseed:structural', action='purge'
    //   - Phase 2 (sales):       entity_name='v2-wipe-and-reseed:sales',      action='commit'
    // Match on entity_name LIKE 'v2-wipe-and-reseed%' (decoupled from the
    // particular action verb the runbook chose) AND on actor_id = the
    // ETL_SYSTEM_USER_ID. >= 1 is the bar (a structural-only --apply still
    // qualifies; --apply-with-sales adds a second row).
    const r = await client.query<{ c: number }>(`
      SELECT COUNT(*)::int AS c FROM audit_logs
      WHERE entity_name LIKE 'v2-wipe-and-reseed%'
        AND actor_id = '00000000-0000-0000-0000-000000000001'
    `);
    const actual = r.rows[0].c;
    results.push({
      name: "audit_logs has reseed entry from runbook system actor",
      status: actual >= 1 ? "pass" : "fail",
      expected: ">= 1",
      actual,
    });
  }

  return results;
}

function renderMarkdown(results: InvariantResult[]): string {
  const lines: string[] = ["# Verify Data Reset Report", ""];
  const summary = { pass: 0, fail: 0, warn: 0 };
  for (const r of results) summary[r.status]++;
  lines.push(
    `**Total:** ${results.length} | **Pass:** ${summary.pass} | **Fail:** ${summary.fail} | **Warn:** ${summary.warn}`,
  );
  lines.push("");
  lines.push("| Invariant | Status | Expected | Actual | Detail |");
  lines.push("|-----------|--------|----------|--------|--------|");
  for (const r of results) {
    lines.push(
      `| ${r.name} | ${r.status.toUpperCase()} | ${r.expected ?? "—"} | ${r.actual ?? "—"} | ${r.detail ?? ""} |`,
    );
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const goldens = loadGoldens();
    const results = await runInvariants(client, goldens);
    const payload = {
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        pass: results.filter((r) => r.status === "pass").length,
        fail: results.filter((r) => r.status === "fail").length,
        warn: results.filter((r) => r.status === "warn").length,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    process.stdout.write(json + "\n");
    process.stderr.write(renderMarkdown(results));
    if (REPORT_OUT) {
      const fs = await import("node:fs");
      fs.writeFileSync(REPORT_OUT, json);
    }
    process.exit(payload.summary.fail > 0 ? 1 : 0);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
