/**
 * Phase 6 Plan 06-01 — Pre-merge collision probe (READ-ONLY).
 *
 * Reads `tasks/analytics-audit/multi-pos-merge-proposal.csv` and reports, for
 * every (canonical_id, defunct_id) pair, the per-table collision risk that
 * the bulk-merge primitive must handle. Surfaces collisions BEFORE the
 * destructive merge runs so the operator can pick a per-cluster strategy
 * (approve / swap / reject / address_fix).
 *
 * Five collision checks per pair:
 *   1. location_region_memberships — UNIQUE(location_id) standalone.
 *      Both rows present → defunct's row must be deleted before the FK rewrite.
 *   2. location_group_memberships  — UNIQUE(location_id) standalone. Same.
 *   3. location_hotel_group_memberships — composite PK (location_id, hotel_group_id).
 *      Both rows share at least one hotel_group_id → defunct's overlapping row
 *      must be deleted; non-overlapping rows can be rewritten.
 *   4. location_products — soft duplicate on (location_id, product_id, provider_id).
 *      No DB-level PK enforces this today, but rewriting both rows would create
 *      a duplicate availability row; defunct's overlapping row should be deleted.
 *   5. primary_region_id — different between canonical and defunct.
 *      Data-quality flag: should the merge stay within-region, or is the
 *      defunct's region wrong (address_fix candidate)?
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/probe-multi-pos-merge-collisions.ts
 *
 * No mutations. Exits 0 if no warnings, 1 if any cluster has unresolved
 * collisions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

export type CsvRow = {
  cluster_id: number;
  canonical_id: string;
  canonical_name: string;
  defunct_id: string | null;
  defunct_name: string | null;
};

export type Pair = {
  clusterId: number;
  canonicalId: string;
  canonicalName: string;
  defunctId: string;
  defunctName: string;
};

export type CollisionReport = {
  pair: Pair;
  warnings: string[];
};

/**
 * Parse the proposal CSV. Self-rows (where defunct_id is empty — first row
 * per cluster announces canonical) are skipped. Returns one Pair per real
 * (canonical, defunct) row.
 */
export function parseProposalCsv(csv: string): Pair[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  const idxClusterId = header.indexOf("cluster_id");
  const idxCanonicalId = header.indexOf("canonical_id");
  const idxCanonicalName = header.indexOf("canonical_name");
  const idxDefunctId = header.indexOf("defunct_id");
  const idxDefunctName = header.indexOf("defunct_name");

  if (
    idxClusterId < 0 ||
    idxCanonicalId < 0 ||
    idxCanonicalName < 0 ||
    idxDefunctId < 0 ||
    idxDefunctName < 0
  ) {
    throw new Error("CSV missing required columns");
  }

  const pairs: Pair[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const defunctId = cols[idxDefunctId];
    if (!defunctId || defunctId.trim() === "") continue; // self-row, skip
    pairs.push({
      clusterId: Number(cols[idxClusterId]),
      canonicalId: cols[idxCanonicalId],
      canonicalName: cols[idxCanonicalName],
      defunctId,
      defunctName: cols[idxDefunctName],
    });
  }
  return pairs;
}

// CSV line splitter that honours double-quoted fields with embedded commas.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

// Generic query callback so tests can inject canned rows without a real DB.
export type QueryFn = (
  text: string,
  params: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Run all five collision checks for a single pair. Returns the warnings
 * collected; empty array if the pair has no collisions.
 */
export async function probeCollisionsForPair(
  pair: Pair,
  query: QueryFn,
): Promise<CollisionReport> {
  const warnings: string[] = [];

  // 1. location_region_memberships UNIQUE(location_id) collision.
  {
    const { rows } = await query(
      `SELECT location_id::text AS location_id
         FROM location_region_memberships
        WHERE location_id IN ($1, $2)`,
      [pair.canonicalId, pair.defunctId],
    );
    const ids = new Set(rows.map((r) => String(r.location_id)));
    if (ids.has(pair.canonicalId) && ids.has(pair.defunctId)) {
      warnings.push(
        `region collision: both canonical and defunct have a location_region_memberships row — defunct's row will be deleted before the FK rewrite`,
      );
    }
  }

  // 2. location_group_memberships UNIQUE(location_id) collision.
  {
    const { rows } = await query(
      `SELECT location_id::text AS location_id
         FROM location_group_memberships
        WHERE location_id IN ($1, $2)`,
      [pair.canonicalId, pair.defunctId],
    );
    const ids = new Set(rows.map((r) => String(r.location_id)));
    if (ids.has(pair.canonicalId) && ids.has(pair.defunctId)) {
      warnings.push(
        `group collision: both canonical and defunct have a location_group_memberships row — defunct's row will be deleted before the FK rewrite`,
      );
    }
  }

  // 3. location_hotel_group_memberships composite PK collision (shared hotel_group_id).
  {
    const { rows } = await query(
      `SELECT hotel_group_id::text AS hotel_group_id, location_id::text AS location_id
         FROM location_hotel_group_memberships
        WHERE location_id IN ($1, $2)`,
      [pair.canonicalId, pair.defunctId],
    );
    const canonicalGroups = new Set(
      rows.filter((r) => r.location_id === pair.canonicalId).map((r) => String(r.hotel_group_id)),
    );
    const defunctGroups = new Set(
      rows.filter((r) => r.location_id === pair.defunctId).map((r) => String(r.hotel_group_id)),
    );
    const overlap = [...defunctGroups].filter((g) => canonicalGroups.has(g));
    if (overlap.length > 0) {
      warnings.push(
        `hotel_group PK collision: ${overlap.length} hotel_group(s) shared by canonical and defunct — defunct's overlapping rows will be deleted, non-overlapping rows rewritten`,
      );
    }
  }

  // 4. location_products soft duplicate on (location_id, product_id, provider_id).
  {
    const { rows } = await query(
      `SELECT location_id::text AS location_id,
              product_id::text  AS product_id,
              COALESCE(provider_id::text, '') AS provider_id
         FROM location_products
        WHERE location_id IN ($1, $2)`,
      [pair.canonicalId, pair.defunctId],
    );
    const canonicalKeys = new Set(
      rows
        .filter((r) => r.location_id === pair.canonicalId)
        .map((r) => `${r.product_id}|${r.provider_id}`),
    );
    const defunctKeys = new Set(
      rows
        .filter((r) => r.location_id === pair.defunctId)
        .map((r) => `${r.product_id}|${r.provider_id}`),
    );
    const overlap = [...defunctKeys].filter((k) => canonicalKeys.has(k));
    if (overlap.length > 0) {
      warnings.push(
        `location_products PK collision: ${overlap.length} (product_id, provider_id) pair(s) shared — defunct's overlapping rows will be deleted before the FK rewrite`,
      );
    }
  }

  // 5. primary_region_id mismatch — data-quality flag.
  {
    const { rows } = await query(
      `SELECT id::text AS id, primary_region_id::text AS primary_region_id
         FROM locations
        WHERE id IN ($1, $2)`,
      [pair.canonicalId, pair.defunctId],
    );
    const canonicalRegion = rows.find((r) => r.id === pair.canonicalId)?.primary_region_id;
    const defunctRegion = rows.find((r) => r.id === pair.defunctId)?.primary_region_id;
    if (canonicalRegion && defunctRegion && canonicalRegion !== defunctRegion) {
      warnings.push(
        `cross-region merge: canonical primary_region_id=${canonicalRegion} differs from defunct primary_region_id=${defunctRegion} — confirm this is intentional or mark cluster as 'address_fix'`,
      );
    }
  }

  return { pair, warnings };
}

export function formatReport(reports: CollisionReport[]): {
  output: string;
  exitCode: number;
} {
  const lines: string[] = [];
  let totalWarnings = 0;
  // Group by clusterId for readability.
  const byCluster = new Map<number, CollisionReport[]>();
  for (const r of reports) {
    const list = byCluster.get(r.pair.clusterId) ?? [];
    list.push(r);
    byCluster.set(r.pair.clusterId, list);
  }
  const clusterIds = [...byCluster.keys()].sort((a, b) => a - b);
  for (const clusterId of clusterIds) {
    const reportsForCluster = byCluster.get(clusterId)!;
    const clusterHasWarnings = reportsForCluster.some((r) => r.warnings.length > 0);
    if (!clusterHasWarnings) continue;
    lines.push("");
    lines.push(`=== Cluster ${clusterId} ===`);
    for (const r of reportsForCluster) {
      if (r.warnings.length === 0) continue;
      lines.push(
        `  pair: ${r.pair.canonicalName} (${r.pair.canonicalId}) ← ${r.pair.defunctName} (${r.pair.defunctId})`,
      );
      for (const w of r.warnings) {
        lines.push(`    - ${w}`);
        totalWarnings++;
      }
    }
  }
  if (totalWarnings === 0) {
    return {
      output: `Probed ${reports.length} pair(s); no collisions detected.\n`,
      exitCode: 0,
    };
  }
  lines.push("");
  lines.push(
    `Summary: ${totalWarnings} warning(s) across ${[...byCluster.values()].filter((rs) => rs.some((r) => r.warnings.length > 0)).length} cluster(s) of ${clusterIds.length} total.`,
  );
  lines.push(
    "Operator action: confirm bulk-merge order-of-ops handles each collision, or mark the cluster's decision as 'rejected' / 'address_fix' in the merge-review UI.",
  );
  return { output: lines.join("\n") + "\n", exitCode: 1 };
}

const CSV_PATH = join(
  process.cwd(),
  "tasks/analytics-audit/multi-pos-merge-proposal.csv",
);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:   READ-ONLY collision probe (no writes)");

  const csv = readFileSync(CSV_PATH, "utf8");
  const pairs = parseProposalCsv(csv);
  console.log(`Parsed ${pairs.length} (canonical, defunct) pair(s) from proposal CSV.`);

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const query: QueryFn = async (text, params) => {
    const result = await client.query(text, params as never[]);
    return { rows: result.rows as Record<string, unknown>[] };
  };

  try {
    const reports: CollisionReport[] = [];
    for (const pair of pairs) {
      const r = await probeCollisionsForPair(pair, query);
      reports.push(r);
    }
    const { output, exitCode } = formatReport(reports);
    process.stdout.write(output);
    process.exitCode = exitCode;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
