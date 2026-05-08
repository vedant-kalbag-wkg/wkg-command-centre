/**
 * Phase 7 Pre-Flight — read-only baseline before the wipe-and-rebuild runbook.
 *
 * Three phases:
 *   1. Env audit  — DATABASE_URL host, BETTER_AUTH_URL classification, token presence.
 *                   Hard-warns when BETTER_AUTH_URL matches the per-deploy-hash
 *                   pattern (must be the git-branch alias per CLAUDE.md).
 *   2. DB snapshot — row counts for every wipe-set + preserve-set table; active
 *                   counts (archived_at IS NULL) where the column exists; regions
 *                   inventory; sales_records gross-revenue total in pence.
 *   3. Monday probe — delegates to scripts/probe-monday-vs-db-addresses.ts
 *                    --mode=normalised-name-counts (Task 1) for Open Question #1.
 *
 * Writes .planning/phases/07-data-foundation-rebuild/07-PREFLIGHT-REPORT.md
 * containing the GOLDEN_* constants Plan E (07-05) consumes.
 *
 * READ-ONLY by construction — no INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.
 *
 * Wipe-Set / Preserve-Set lists must match .planning/notes/v2-data-reset-decision.md
 * exactly (the SoT). Idempotent — re-runs overwrite the report with a fresh timestamp.
 *
 * Usage:
 *   DATABASE_URL=... MONDAY_API_TOKEN=... BETTER_AUTH_URL=... npx tsx scripts/v2-preflight.ts
 */
import { Pool } from "pg";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPORT_PATH = ".planning/phases/07-data-foundation-rebuild/07-PREFLIGHT-REPORT.md";
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

// SoT: .planning/notes/v2-data-reset-decision.md § "What wipes vs survives".
// Quote table names that share an SQL keyword (e.g. "user").
const WIPE_SET_TABLES = [
  // Monday-sourced
  "locations",
  "kiosks",
  "products",
  "providers",
  "location_products",
  "location_groups",
  "location_group_memberships",
  "regions",
  "location_region_memberships",
  "hotel_groups",
  "location_hotel_group_memberships",
  "markets",
  "location_flags",
  // Sales-sourced
  "sales_records",
  "sales_imports",
  "sales_blob_ingestions",
  "product_code_fallbacks",
  "commission_ledger",
  // Audit / temporal
  "audit_logs",
  "kiosk_assignments",
  // Test rollout
  "installations",
  "installation_kiosks",
  "installation_members",
  "milestones",
  "business_events",
  "event_log",
  // Cleanup / staging
  "merge_proposals",
  "import_stagings",
  "weather_cache",
] as const;

const PRESERVE_SET_TABLES = [
  // Auth
  '"user"',
  "account",
  "session",
  "verification",
  "user_scopes",
  // App config
  "app_settings",
  "pipeline_stages",
  "event_categories",
  // User customisations
  "user_views",
  "analytics_saved_views",
  "analytics_presets",
  "duplicate_dismissals",
  "kiosk_config_groups",
  "outlet_exclusions",
  "experiment_cohorts",
  "action_items",
] as const;

// Per-deploy-hash regex: vercel mints `wkg-command-centre-<9+ hex>-...` per
// build; git-branch alias is `wkg-command-centre-git-<branch>-...`. Anything
// matching this pattern that is NOT the `-git-` form is a stale per-deploy URL.
const PER_DEPLOY_HASH_REGEX = /wkg-command-centre-[a-f0-9]{9,}-(?!git-)/;

type EnvLine = { level: "PASS" | "WARN" | "FAIL"; message: string };

function maskDbUrl(url: string): string {
  return url.replace(/:[^:@]+@/, ":***@");
}

function parseDbHost(url: string): string {
  try {
    return new URL(url).host || "(parse-failed)";
  } catch {
    return "(parse-failed)";
  }
}

function classifyAuthUrl(url: string | undefined): { tag: string; line: EnvLine } {
  if (!url) {
    return { tag: "MISSING", line: { level: "WARN", message: "BETTER_AUTH_URL not set (only required for Plan E preview UAT)" } };
  }
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    return { tag: "LOCAL", line: { level: "PASS", message: `BETTER_AUTH_URL = ${url} [LOCAL]` } };
  }
  if (PER_DEPLOY_HASH_REGEX.test(url)) {
    return {
      tag: "PER-DEPLOY-HASH",
      line: {
        level: "FAIL",
        message:
          "BETTER_AUTH_URL is pinned to a per-deploy hash — must be the git-branch alias for any preview UAT (Plan E). See CLAUDE.md § Vercel preview env vars.",
      },
    };
  }
  if (url.includes("wkg-command-centre-git-")) {
    return { tag: "PREVIEW", line: { level: "PASS", message: `BETTER_AUTH_URL = ${url} [PREVIEW git-branch alias]` } };
  }
  if (url.includes("wkg-command-centre.vercel.app")) {
    return { tag: "PROD", line: { level: "PASS", message: `BETTER_AUTH_URL = ${url} [PROD]` } };
  }
  return { tag: "OTHER", line: { level: "WARN", message: `BETTER_AUTH_URL = ${url} [unrecognised — verify before Plan E]` } };
}

function envAudit(): { lines: EnvLine[]; dbUrl: string; mondayPresent: boolean; betterAuthTag: string } {
  const lines: EnvLine[] = [];
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    lines.push({ level: "FAIL", message: "DATABASE_URL is not set" });
  } else {
    lines.push({ level: "PASS", message: `DATABASE_URL host = ${parseDbHost(dbUrl)} (${maskDbUrl(dbUrl)})` });
  }
  const auth = classifyAuthUrl(process.env.BETTER_AUTH_URL);
  lines.push(auth.line);
  const mondayPresent = !!process.env.MONDAY_API_TOKEN;
  lines.push({
    level: mondayPresent ? "PASS" : "WARN",
    message: `MONDAY_API_TOKEN present: ${mondayPresent}`,
  });
  return { lines, dbUrl, mondayPresent, betterAuthTag: auth.tag };
}

type RowCount = { table: string; total: number | "missing"; active: number | "n/a" | "missing" };

async function snapshotTables(pool: Pool, tables: readonly string[], withArchived: boolean): Promise<RowCount[]> {
  const out: RowCount[] = [];
  for (const t of tables) {
    let total: number | "missing";
    try {
      const r = await pool.query<{ c: string }>(`SELECT count(*)::bigint AS c FROM ${t}`);
      total = Number(r.rows[0].c);
    } catch (e) {
      const msg = (e as Error).message;
      if (/relation .+ does not exist/.test(msg)) {
        out.push({ table: t, total: "missing", active: "missing" });
        continue;
      }
      throw e;
    }
    let active: number | "n/a" | "missing" = "n/a";
    if (withArchived) {
      try {
        const r = await pool.query<{ c: string }>(`SELECT count(*)::bigint AS c FROM ${t} WHERE archived_at IS NULL`);
        active = Number(r.rows[0].c);
      } catch (e) {
        const msg = (e as Error).message;
        if (/column .+ does not exist/.test(msg)) {
          active = "n/a";
        } else {
          throw e;
        }
      }
    }
    out.push({ table: t, total, active });
  }
  return out;
}

type RegionRow = { id: string; code: string | null; name: string | null };

async function regionsInventory(pool: Pool): Promise<RegionRow[]> {
  try {
    const r = await pool.query<RegionRow>(`SELECT id::text, code, name FROM regions ORDER BY code`);
    return r.rows;
  } catch {
    return [];
  }
}

async function goldenConstants(pool: Pool): Promise<{
  GOLDEN_LOCATIONS_ACTIVE: number;
  GOLDEN_KIOSKS_ACTIVE: number;
  GOLDEN_SALES_RECORDS: number;
  GOLDEN_TOTAL_REVENUE_GROSS_GBP: string;
}> {
  // sales_records.net_amount + .vat_amount are numeric(12,2) decimal pounds
  // per src/db/schema.ts:678. Sum and cast to text so the pg driver returns
  // the exact decimal string ("12345.67") — preserves precision verbatim
  // for Plan E's golden-baseline equality check.
  const [locActive, kioActive, salesCount, revenue] = await Promise.all([
    pool.query<{ c: string }>(`SELECT count(*)::bigint AS c FROM locations WHERE archived_at IS NULL`).catch(() => ({ rows: [{ c: "0" }] })),
    pool.query<{ c: string }>(`SELECT count(*)::bigint AS c FROM kiosks WHERE archived_at IS NULL`).catch(() => ({ rows: [{ c: "0" }] })),
    pool.query<{ c: string }>(`SELECT count(*)::bigint AS c FROM sales_records`).catch(() => ({ rows: [{ c: "0" }] })),
    pool
      .query<{ p: string }>(
        `SELECT COALESCE(SUM(net_amount + vat_amount), 0)::text AS p FROM sales_records`,
      )
      .catch(() => ({ rows: [{ p: "0" }] })),
  ]);
  return {
    GOLDEN_LOCATIONS_ACTIVE: Number(locActive.rows[0].c),
    GOLDEN_KIOSKS_ACTIVE: Number(kioActive.rows[0].c),
    GOLDEN_SALES_RECORDS: Number(salesCount.rows[0].c),
    GOLDEN_TOTAL_REVENUE_GROSS_GBP: revenue.rows[0].p,
  };
}

type MondayResult = { totalItems: number; distinctNormalisedNames: number; sameNameGroups: Array<{ normalised: string; count: number; boardIds: number[]; rawNames: string[] }> };

function runMondayProbe(): MondayResult | { error: string } {
  if (!process.env.MONDAY_API_TOKEN) {
    return { error: "MONDAY_API_TOKEN not set — Monday probe skipped" };
  }
  try {
    const stdout = execSync(
      "npx tsx scripts/probe-monday-vs-db-addresses.ts --mode=normalised-name-counts",
      { stdio: ["ignore", "pipe", "ignore"], env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as MondayResult;
  } catch (e) {
    return { error: `Monday probe failed: ${(e as Error).message}` };
  }
}

function bulletForLevel(l: EnvLine): string {
  return `- **${l.level}** — ${l.message}`;
}

function tableRowCounts(rows: RowCount[]): string {
  const lines = ["| Table | Total | Active (archived_at IS NULL) |", "|-------|-------|------------------------------|"];
  for (const r of rows) {
    lines.push(`| ${r.table} | ${r.total} | ${r.active} |`);
  }
  return lines.join("\n");
}

function tablePreserveCounts(rows: RowCount[]): string {
  const lines = ["| Table | Total |", "|-------|-------|"];
  for (const r of rows) {
    lines.push(`| ${r.table} | ${r.total} |`);
  }
  return lines.join("\n");
}

function tableRegions(rows: RegionRow[]): string {
  if (rows.length === 0) return "_(regions table empty or unavailable)_";
  const lines = ["| id | code | name |", "|----|------|------|"];
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.code ?? ""} | ${r.name ?? ""} |`);
  }
  return lines.join("\n");
}

function renderReport(args: {
  generatedAt: string;
  dbHost: string;
  authUrl: string;
  authTag: string;
  envLines: EnvLine[];
  wipeRows: RowCount[];
  preserveRows: RowCount[];
  regions: RegionRow[];
  monday: MondayResult | { error: string };
  golden: {
    GOLDEN_LOCATIONS_ACTIVE: number;
    GOLDEN_KIOSKS_ACTIVE: number;
    GOLDEN_SALES_RECORDS: number;
    GOLDEN_TOTAL_REVENUE_GROSS_GBP: string;
  };
}): string {
  const m = args.monday;
  const mondayHasError = "error" in m;
  const totalItems = mondayHasError ? "?" : m.totalItems;
  const distinctNames = mondayHasError ? "?" : m.distinctNormalisedNames;
  const groups = mondayHasError ? 0 : m.sameNameGroups.length;

  const sameNameTable = mondayHasError
    ? `_(${m.error})_`
    : groups === 0
      ? "_(no same-name groups detected on Monday boards)_"
      : [
          "| Normalised | Count | Boards | Raw names |",
          "|------------|-------|--------|-----------|",
          ...m.sameNameGroups.map(
            (g) => `| ${g.normalised} | ${g.count} | ${g.boardIds.join(", ")} | ${g.rawNames.join(" / ")} |`,
          ),
        ].join("\n");

  const q1Resolution = mondayHasError
    ? "**UNANSWERED** — Monday probe failed; rerun with MONDAY_API_TOKEN before Plan B."
    : groups === 0
      ? "**ANSWERED — clean by construction.** Monday emits 1 hotel item per normalised name; post-wipe state needs no Plan C merge intervention."
      : `**ANSWERED — ${groups} same-name group(s) on Monday.** Plan B emits a follow-up flag and Plan C merge UI is required immediately after Plan B.`;

  const hasGlobal = args.regions.some((r) => (r.code ?? "").toUpperCase() === "GLOBAL");
  const q2Resolution = hasGlobal
    ? "**ANSWERED — GLOBAL region exists.** Use it for the LOCATION_NEEDED sentinel's primary_region_id."
    : args.regions.length === 0
      ? "**INDETERMINATE — regions table empty/unavailable.** Recommend NULL for sentinel primary_region_id; reconfirm post-reseed."
      : `**ANSWERED — no GLOBAL region row.** Recommend NULL for sentinel primary_region_id (existing region rows: ${args.regions.map((r) => r.code).filter(Boolean).join(", ")}).`;

  return [
    "# Phase 7 Pre-Flight Report",
    "",
    `**Generated:** ${args.generatedAt}`,
    `**DATABASE_URL host:** ${args.dbHost}`,
    `**BETTER_AUTH_URL:** ${args.authUrl || "(unset)"} [${args.authTag}]`,
    `**ETL_SYSTEM_USER_ID:** \`${ETL_SYSTEM_USER_ID}\``,
    "",
    "## Environment Audit",
    "",
    args.envLines.map(bulletForLevel).join("\n"),
    "",
    "## Golden Snapshot (DB row counts)",
    "",
    "### Wipe-Set Tables",
    "",
    tableRowCounts(args.wipeRows),
    "",
    "### Preserve-Set Tables",
    "",
    tablePreserveCounts(args.preserveRows),
    "",
    "### Regions Inventory",
    "",
    tableRegions(args.regions),
    "",
    "## Monday Source-of-Truth Inventory",
    "",
    `- Total hotel items across boards: ${totalItems}`,
    `- Distinct normalised hotel names: ${distinctNames}`,
    `- Same-name groups on Monday boards: ${groups}`,
    "",
    sameNameTable,
    "",
    "## Open Question Resolutions",
    "",
    `- **Q1 — Monday hotel item cardinality:** ${q1Resolution}`,
    `- **Q2 — Sentinel region:** ${q2Resolution}`,
    "",
    "## Plan B / Plan E Inputs",
    "",
    "```typescript",
    "// Paste these constants into scripts/verify-data-reset.ts (Plan E).",
    "// Revenue = SUM(net_amount + vat_amount) on sales_records — schema columns",
    "// are numeric(12,2) decimal pounds (schema:678). Stored as a string to",
    "// preserve the exact decimal Plan E will compare against.",
    `export const GOLDEN_LOCATIONS_ACTIVE = ${args.golden.GOLDEN_LOCATIONS_ACTIVE};`,
    `export const GOLDEN_KIOSKS_ACTIVE = ${args.golden.GOLDEN_KIOSKS_ACTIVE};`,
    `export const GOLDEN_SALES_RECORDS = ${args.golden.GOLDEN_SALES_RECORDS};`,
    `export const GOLDEN_TOTAL_REVENUE_GROSS_GBP = "${args.golden.GOLDEN_TOTAL_REVENUE_GROSS_GBP}";`,
    "```",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const env = envAudit();
  if (!env.dbUrl) {
    console.error("DATABASE_URL is required for the DB snapshot phase.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.dbUrl });
  let wipeRows: RowCount[] = [];
  let preserveRows: RowCount[] = [];
  let regions: RegionRow[] = [];
  let golden = {
    GOLDEN_LOCATIONS_ACTIVE: 0,
    GOLDEN_KIOSKS_ACTIVE: 0,
    GOLDEN_SALES_RECORDS: 0,
    GOLDEN_TOTAL_REVENUE_GROSS_GBP: "0",
  };
  try {
    [wipeRows, preserveRows, regions, golden] = await Promise.all([
      snapshotTables(pool, WIPE_SET_TABLES, true),
      snapshotTables(pool, PRESERVE_SET_TABLES, false),
      regionsInventory(pool),
      goldenConstants(pool),
    ]);
  } finally {
    await pool.end();
  }

  const monday = runMondayProbe();

  const generatedAt = new Date().toISOString();
  const dbHost = parseDbHost(env.dbUrl);
  const report = renderReport({
    generatedAt,
    dbHost,
    authUrl: process.env.BETTER_AUTH_URL ?? "",
    authTag: env.betterAuthTag,
    envLines: env.lines,
    wipeRows,
    preserveRows,
    regions,
    monday,
    golden,
  });

  writeFileSync(REPORT_PATH, report, "utf8");

  // Stdout summary — operator-facing one-liner per phase.
  console.log(`[v2-preflight] db.host=${dbHost}`);
  console.log(`[v2-preflight] env: ${env.lines.map((l) => `${l.level}`).join("/")}`);
  console.log(`[v2-preflight] wipe-set: ${wipeRows.length} tables snapshotted`);
  console.log(`[v2-preflight] preserve-set: ${preserveRows.length} tables snapshotted`);
  const m = monday;
  if ("error" in m) {
    console.log(`[v2-preflight] monday: ${m.error}`);
  } else {
    console.log(
      `[v2-preflight] monday: totalItems=${m.totalItems} distinctNormalisedNames=${m.distinctNormalisedNames} sameNameGroups=${m.sameNameGroups.length}`,
    );
  }
  console.log(
    `[v2-preflight] GOLDEN_LOCATIONS_ACTIVE=${golden.GOLDEN_LOCATIONS_ACTIVE} GOLDEN_KIOSKS_ACTIVE=${golden.GOLDEN_KIOSKS_ACTIVE} GOLDEN_SALES_RECORDS=${golden.GOLDEN_SALES_RECORDS} GOLDEN_TOTAL_REVENUE_GROSS_GBP=${golden.GOLDEN_TOTAL_REVENUE_GROSS_GBP}`,
  );
  console.log(`[v2-preflight] report written: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
