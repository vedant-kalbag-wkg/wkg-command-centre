/**
 * Phase 1 measurement orchestrator.
 *
 * Drives the Phase 1 measurement end-to-end against a Vercel preview URL whose
 * backing Postgres database has `pg_stat_statements` enabled. Workflow:
 *
 *   1. Connect to the DB via `postgres-js` using `DATABASE_URL`.
 *   2. `SELECT pg_stat_statements_reset()` — clean slate.
 *   3. Spawn `scripts/phase-1-load.ts` against --url to generate traffic.
 *   4. Snapshot `pg_stat_statements` (top 25 by total impact).
 *   5. For each of the top 10: run `EXPLAIN (ANALYZE, BUFFERS)` on the recorded
 *      query text. Per-query failures (e.g. placeholder `$1` syntax errors) are
 *      logged into the respective explain file and the run continues.
 *   6. Emit `<outDir>/pgss-snapshot.json`, `<outDir>/explain-<queryid>.txt` x N,
 *      and `<outDir>/raw-findings.md` plus a condensed stdout summary.
 *
 * This script does NOT do browser automation itself — that lives in the load
 * subprocess (`scripts/phase-1-load.ts`), which we spawn and wait on. Its
 * stdout/stderr is piped through with a `[load] ` prefix.
 *
 * Usage:
 *   npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *     scripts/phase-1-measure.ts --url=https://<preview>.vercel.app --iterations=10
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import postgres from "postgres";

type CliArgs = {
  url: string;
  iterations: number;
  outDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const raw of argv.slice(2)) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }

  const url = args.url;
  if (!url) {
    console.error(
      "Missing --url. Usage: phase-1-measure.ts --url=https://<target> [--iterations=N] [--out=dir]",
    );
    process.exit(1);
  }

  const iterationsArg = args.iterations ?? "10";
  const iterations = Number(iterationsArg);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    console.error(
      `Invalid --iterations=${iterationsArg} (must be a positive integer)`,
    );
    process.exit(1);
  }

  const outDir =
    args.out ?? path.join("test-results", `phase-1-${Math.floor(Date.now() / 1000)}`);

  return { url: url.replace(/\/$/, ""), iterations, outDir };
}

type PgssRow = {
  queryid: string;
  query: string;
  calls: number;
  total_exec_time: number;
  mean_exec_time: number;
  stddev_exec_time: number;
  impact: number;
  rows: number;
};

/**
 * Stream the load subprocess's output through the parent with a `[load] `
 * prefix so the human operator can correlate it with orchestrator progress.
 */
function runLoad(url: string, iterations: number): Promise<number> {
  return new Promise((resolve) => {
    // Match the project's idiomatic TS runner. Every TS script in package.json
    // is invoked via `npx tsx ...`; using `node --experimental-strip-types`
    // would be divergent, and tsx is already resolved in this process's npx
    // cache, so the spawn is fast.
    const scriptPath = path.join(process.cwd(), "scripts/phase-1-load.ts");
    const child = spawn(
      "npx",
      ["tsx", scriptPath, `--url=${url}`, `--iterations=${iterations}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    );

    const prefixLines = (chunk: Buffer, sink: NodeJS.WriteStream) => {
      const text = chunk.toString("utf8");
      const lines = text.split(/\r?\n/);
      // Last entry is trailing content (empty if chunk ended with newline);
      // join with prefixes and write atomically.
      const out = lines
        .map((line, idx) =>
          idx === lines.length - 1 && line === "" ? "" : `[load] ${line}`,
        )
        .join("\n");
      sink.write(out);
    };

    child.stdout.on("data", (chunk: Buffer) => prefixLines(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => prefixLines(chunk, process.stderr));

    child.on("error", (err) => {
      console.error(`[load] spawn error: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

const SNAPSHOT_SQL = `
  SELECT
    queryid::text AS queryid,
    substring(query, 1, 400) AS query,
    calls,
    total_exec_time,
    mean_exec_time,
    stddev_exec_time,
    (mean_exec_time * calls) AS impact,
    rows
  FROM pg_stat_statements
  WHERE query NOT ILIKE '%pg_stat_statements%'
    AND query NOT ILIKE 'BEGIN%'
    AND query NOT ILIKE 'COMMIT%'
    AND query NOT ILIKE 'SELECT pg_catalog.%'
  ORDER BY (mean_exec_time * calls) DESC
  LIMIT 25
`;

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}\u2026`;
}

function formatMd(
  url: string,
  iterations: number,
  timestamp: string,
  snapshot: PgssRow[],
  explainPaths: Map<string, string>,
): string {
  const top10 = snapshot.slice(0, 10);
  const lines: string[] = [];
  lines.push("# Phase 1 — Raw Findings", "");
  lines.push("| key | value |");
  lines.push("| --- | --- |");
  lines.push(`| target | ${url} |`);
  lines.push(`| iterations | ${iterations} |`);
  lines.push(`| timestamp | ${timestamp} |`);
  lines.push(`| snapshot rows captured | ${snapshot.length} |`);
  lines.push("");
  lines.push("## Top 10 by impact (mean_exec_time \u00d7 calls)");
  lines.push("");
  lines.push(
    "| # | queryid | calls | mean_ms | total_ms | impact | rows | query |",
  );
  lines.push("| - | ------- | ----- | ------- | -------- | ------ | ---- | ----- |");
  for (let i = 0; i < top10.length; i++) {
    const r = top10[i];
    const explainRel = explainPaths.get(r.queryid) ?? "";
    const qidCell = explainRel
      ? `[${r.queryid}](${explainRel})`
      : r.queryid;
    lines.push(
      `| ${i + 1} | ${qidCell} | ${r.calls} | ${r.mean_exec_time.toFixed(2)} | ${r.total_exec_time.toFixed(2)} | ${r.impact.toFixed(2)} | ${r.rows} | ${truncate(r.query, 100).replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function printStdoutSummary(
  snapshot: PgssRow[],
  rawFindingsPath: string,
): void {
  const top10 = snapshot.slice(0, 10);
  console.log("");
  console.log("Top 10 queries by impact (mean_ms \u00d7 calls):");
  console.log("");
  const header =
    "#".padStart(3) +
    "  " +
    "queryid".padEnd(22) +
    "calls".padStart(7) +
    "mean_ms".padStart(11) +
    "total_ms".padStart(12) +
    "impact".padStart(12) +
    "rows".padStart(8) +
    "  query";
  console.log(header);
  console.log("-".repeat(header.length));
  for (let i = 0; i < top10.length; i++) {
    const r = top10[i];
    console.log(
      String(i + 1).padStart(3) +
        "  " +
        r.queryid.padEnd(22) +
        String(r.calls).padStart(7) +
        r.mean_exec_time.toFixed(2).padStart(11) +
        r.total_exec_time.toFixed(2).padStart(12) +
        r.impact.toFixed(2).padStart(12) +
        String(r.rows).padStart(8) +
        "  " +
        truncate(r.query, 80),
    );
  }
  console.log("");
  console.log(`Full findings: ${rawFindingsPath}`);
}

async function main() {
  // Env-var guards BEFORE parsing URL so a misconfigured env exits fast with a
  // precise message and before we do any DB work.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL env var is required (load via --env-file=.env.neon-dev).",
    );
    process.exit(1);
  }
  if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD) {
    console.error(
      "TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars are required (the load subprocess needs them).",
    );
    process.exit(1);
  }

  const { url, iterations, outDir } = parseArgs(process.argv);

  try {
    await fs.mkdir(outDir, { recursive: true });
  } catch (err) {
    console.error(
      `Failed to create output dir ${outDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

  try {
    console.log(`Resetting pg_stat_statements on target DB...`);
    try {
      await client`SELECT pg_stat_statements_reset()`;
    } catch (err) {
      console.error(
        `pg_stat_statements_reset() failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    console.log("Reset OK.");

    console.log(
      `Running load: ${iterations} iterations against ${url} (subprocess)...`,
    );
    const loadExit = await runLoad(url, iterations);
    if (loadExit !== 0) {
      console.warn(
        `[load] process exited with code ${loadExit} — continuing to snapshot; partial data may still be useful.`,
      );
    }

    console.log("\nSnapshotting pg_stat_statements...");
    let snapshot: PgssRow[];
    try {
      // `queryid` is bigint in pg_stat_statements. postgres-js would surface
      // it as a BigInt which isn't trivially JSON-serialisable; casting to
      // text in-SQL sidesteps that and keeps the value precise.
      const rows = await client.unsafe(SNAPSHOT_SQL);
      snapshot = rows.map((r) => ({
        queryid: String(r.queryid),
        query: String(r.query),
        calls: Number(r.calls),
        total_exec_time: Number(r.total_exec_time),
        mean_exec_time: Number(r.mean_exec_time),
        stddev_exec_time: Number(r.stddev_exec_time),
        impact: Number(r.impact),
        rows: Number(r.rows),
      }));
    } catch (err) {
      console.error(
        `Snapshot query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const snapshotPath = path.join(outDir, "pgss-snapshot.json");
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    console.log(
      `Snapshot written to ${snapshotPath} (${snapshot.length} rows).`,
    );

    // EXPLAIN top 10. Each failure is captured per-file and the run continues.
    const explainPaths = new Map<string, string>();
    const top10 = snapshot.slice(0, 10);
    console.log(`\nRunning EXPLAIN (ANALYZE, BUFFERS) for top ${top10.length}...`);
    for (let i = 0; i < top10.length; i++) {
      const row = top10[i];
      const explainFile = `explain-${row.queryid}.txt`;
      const explainAbs = path.join(outDir, explainFile);
      const relFromFindings = `./${explainFile}`;
      explainPaths.set(row.queryid, relFromFindings);

      const header = `-- Query:\n${row.query}\n\n-- Plan:\n`;
      try {
        const plan = await client.unsafe(
          `EXPLAIN (ANALYZE, BUFFERS) ${row.query}`,
        );
        // postgres-js returns an array of { "QUERY PLAN": "..." } rows.
        const body = plan
          .map((r) => String((r as Record<string, unknown>)["QUERY PLAN"] ?? ""))
          .join("\n");
        await fs.writeFile(explainAbs, header + body + "\n", "utf8");
        console.log(`  [${i + 1}/${top10.length}] ${row.queryid}: OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await fs.writeFile(
          explainAbs,
          header + `EXPLAIN failed: ${msg}\n`,
          "utf8",
        );
        console.log(`  [${i + 1}/${top10.length}] ${row.queryid}: skipped (${truncate(msg, 80)})`);
      }
    }

    const timestamp = new Date().toISOString();
    const md = formatMd(url, iterations, timestamp, snapshot, explainPaths);
    const rawFindingsPath = path.join(outDir, "raw-findings.md");
    await fs.writeFile(rawFindingsPath, md, "utf8");
    console.log(`\nRaw findings written to ${rawFindingsPath}`);

    printStdoutSummary(snapshot, rawFindingsPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
