/**
 * One-off READ-ONLY: cluster active locations by exact-match address (pass 1)
 * and by normalised-name within region (pass 2), pick a canonical record per
 * cluster, and write a CSV proposal for human review BEFORE any merge runs.
 *
 * Usage: source the prod env, then `npx tsx scripts/propose-multi-pos-merge.ts`.
 *
 * Runs only SELECT queries. No mutations. (Audit task D8 / phase 5.5.)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  outlet_code: string;
  primary_region_id: string;
  region_name: string;
  created_at: string;
  sales_count: number;
  amount_total: number;
  kiosks_count: number;
};

type Cluster = {
  basis: "address" | "name+region";
  address: string | null;
  region: string;
  members: LocationRow[];
};

type CsvRow = {
  cluster_id: number;
  cluster_basis: string;
  address: string;
  region: string;
  canonical_outlet_code: string;
  canonical_id: string;
  canonical_name: string;
  canonical_sales_count: number;
  canonical_amount_total: number;
  defunct_outlet_code: string;
  defunct_id: string;
  defunct_name: string;
  defunct_sales_count: number;
  defunct_amount_total: number;
  defunct_kiosks_count: string;
  notes: string;
};

const OUTPUT_PATH =
  "/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/tasks/analytics-audit/multi-pos-merge-proposal.csv";

const CSV_HEADER = [
  "cluster_id",
  "cluster_basis",
  "address",
  "region",
  "canonical_outlet_code",
  "canonical_id",
  "canonical_name",
  "canonical_sales_count",
  "canonical_amount_total",
  "defunct_outlet_code",
  "defunct_id",
  "defunct_name",
  "defunct_sales_count",
  "defunct_amount_total",
  "defunct_kiosks_count",
  "notes",
] as const;

function csvEscape(value: string | number): string {
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normaliseName(name: string): string {
  // lower, trim, collapse internal whitespace, strip a trailing single-letter
  // suffix used to disambiguate the second/third POS (e.g. " b", " c").
  let n = name.toLowerCase().trim().replace(/\s+/g, " ");
  n = n.replace(/\s+[a-z]$/, "");
  return n;
}

function pickCanonical(members: LocationRow[]): LocationRow {
  return [...members].sort((a, b) => {
    if (b.sales_count !== a.sales_count) return b.sales_count - a.sales_count;
    if (a.created_at !== b.created_at)
      return a.created_at.localeCompare(b.created_at);
    return a.id.localeCompare(b.id);
  })[0];
}

function buildNotes(
  cluster: Cluster,
  canonical: LocationRow,
): string {
  const notes: string[] = [];
  const regionIds = new Set(cluster.members.map((m) => m.primary_region_id));
  if (regionIds.size > 1) notes.push("different region between cluster members");
  const normNames = new Set(cluster.members.map((m) => normaliseName(m.name)));
  if (normNames.size > 1) notes.push("different normalised name across cluster");
  const addrs = new Set(
    cluster.members.map((m) => (m.address ?? "").trim()),
  );
  if (cluster.basis === "name+region" && addrs.size > 1)
    notes.push("different addresses within name+region cluster");
  void canonical;
  return notes.join("; ");
}

async function fetchActiveLocations(): Promise<LocationRow[]> {
  const result = (await db.execute(sql`
    SELECT
      l.id::text                                    AS id,
      l.name                                        AS name,
      l.address                                     AS address,
      l.outlet_code                                 AS outlet_code,
      l.primary_region_id::text                     AS primary_region_id,
      r.name                                        AS region_name,
      l.created_at::text                            AS created_at,
      COALESCE(s.sales_count, 0)::bigint            AS sales_count,
      COALESCE(s.amount_total, 0)::numeric          AS amount_total,
      COALESCE(k.kiosks_count, 0)::bigint           AS kiosks_count
    FROM locations l
    JOIN regions r ON r.id = l.primary_region_id
    LEFT JOIN (
      SELECT location_id, COUNT(*) AS sales_count, SUM(net_amount) AS amount_total
      FROM sales_records
      GROUP BY location_id
    ) s ON s.location_id = l.id
    LEFT JOIN (
      SELECT location_id, COUNT(*) AS kiosks_count
      FROM kiosk_assignments
      GROUP BY location_id
    ) k ON k.location_id = l.id
    WHERE l.archived_at IS NULL
  `)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    address: r.address === null ? null : String(r.address),
    outlet_code: String(r.outlet_code),
    primary_region_id: String(r.primary_region_id),
    region_name: String(r.region_name),
    created_at: String(r.created_at),
    sales_count: Number(r.sales_count),
    amount_total: Number(r.amount_total),
    kiosks_count: Number(r.kiosks_count),
  }));
}

function clusterByAddress(locations: LocationRow[]): {
  clusters: Cluster[];
  clusteredIds: Set<string>;
} {
  const groups = new Map<string, LocationRow[]>();
  for (const loc of locations) {
    if (loc.address === null) continue;
    const key = loc.address.trim();
    if (key === "") continue;
    const list = groups.get(key) ?? [];
    list.push(loc);
    groups.set(key, list);
  }
  const clusters: Cluster[] = [];
  const clusteredIds = new Set<string>();
  for (const [address, members] of groups) {
    if (members.length < 2) continue;
    clusters.push({
      basis: "address",
      address,
      region: members[0].region_name,
      members,
    });
    for (const m of members) clusteredIds.add(m.id);
  }
  return { clusters, clusteredIds };
}

function clusterByNameRegion(
  locations: LocationRow[],
  alreadyClustered: Set<string>,
): Cluster[] {
  const groups = new Map<string, LocationRow[]>();
  for (const loc of locations) {
    if (alreadyClustered.has(loc.id)) continue;
    const key = `${loc.primary_region_id}::${normaliseName(loc.name)}`;
    const list = groups.get(key) ?? [];
    list.push(loc);
    groups.set(key, list);
  }
  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    clusters.push({
      basis: "name+region",
      address: null,
      region: members[0].region_name,
      members,
    });
  }
  return clusters;
}

function buildCsvRows(clusters: Cluster[]): CsvRow[] {
  const rows: CsvRow[] = [];
  clusters.sort((a, b) => {
    if (a.basis !== b.basis) return a.basis === "address" ? -1 : 1;
    const ar = a.region.localeCompare(b.region);
    if (ar !== 0) return ar;
    return (a.address ?? "").localeCompare(b.address ?? "");
  });

  let clusterId = 0;
  for (const cluster of clusters) {
    clusterId += 1;
    const canonical = pickCanonical(cluster.members);
    const notes = buildNotes(cluster, canonical);

    rows.push({
      cluster_id: clusterId,
      cluster_basis: cluster.basis,
      address: cluster.address ?? "",
      region: cluster.region,
      canonical_outlet_code: canonical.outlet_code,
      canonical_id: canonical.id,
      canonical_name: canonical.name,
      canonical_sales_count: canonical.sales_count,
      canonical_amount_total: canonical.amount_total,
      defunct_outlet_code: "",
      defunct_id: "",
      defunct_name: "",
      defunct_sales_count: 0,
      defunct_amount_total: 0,
      defunct_kiosks_count: "",
      notes,
    });

    const defuncts = cluster.members
      .filter((m) => m.id !== canonical.id)
      .sort((a, b) => a.outlet_code.localeCompare(b.outlet_code));

    for (const d of defuncts) {
      rows.push({
        cluster_id: clusterId,
        cluster_basis: cluster.basis,
        address: cluster.address ?? "",
        region: cluster.region,
        canonical_outlet_code: canonical.outlet_code,
        canonical_id: canonical.id,
        canonical_name: canonical.name,
        canonical_sales_count: canonical.sales_count,
        canonical_amount_total: canonical.amount_total,
        defunct_outlet_code: d.outlet_code,
        defunct_id: d.id,
        defunct_name: d.name,
        defunct_sales_count: d.sales_count,
        defunct_amount_total: d.amount_total,
        defunct_kiosks_count: String(d.kiosks_count),
        notes: "",
      });
    }
  }

  return rows;
}

function serialiseCsv(rows: CsvRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADER.join(","));
  for (const r of rows) {
    lines.push(
      [
        r.cluster_id,
        r.cluster_basis,
        r.address,
        r.region,
        r.canonical_outlet_code,
        r.canonical_id,
        r.canonical_name,
        r.canonical_sales_count,
        r.canonical_amount_total,
        r.defunct_outlet_code,
        r.defunct_id,
        r.defunct_name,
        r.defunct_sales_count,
        r.defunct_amount_total,
        r.defunct_kiosks_count,
        r.notes,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const locations = await fetchActiveLocations();
  console.log(`Fetched ${locations.length} active locations.`);

  const { clusters: addressClusters, clusteredIds } =
    clusterByAddress(locations);
  const nameClusters = clusterByNameRegion(locations, clusteredIds);
  const allClusters = [...addressClusters, ...nameClusters];

  const csvRows = buildCsvRows(allClusters);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, serialiseCsv(csvRows), "utf8");

  const totalDefuncts = allClusters.reduce(
    (n, c) => n + (c.members.length - 1),
    0,
  );
  const totalSalesReattributed = allClusters.reduce(
    (n, c) =>
      n +
      c.members.reduce((sub, m) => sub + m.sales_count, 0) -
      pickCanonical(c.members).sales_count,
    0,
  );
  const warningClusters = allClusters.filter(
    (c) => buildNotes(c, pickCanonical(c.members)) !== "",
  );

  console.log(`\nWrote ${csvRows.length} rows to ${OUTPUT_PATH}`);
  console.log(`Address-basis clusters:     ${addressClusters.length}`);
  console.log(`Name+region-basis clusters: ${nameClusters.length}`);
  console.log(`Total defunct rows:         ${totalDefuncts}`);
  console.log(`Sales rows to re-attribute: ${totalSalesReattributed}`);
  console.log(`Clusters with notes:        ${warningClusters.length}`);
  for (const c of warningClusters) {
    const canonical = pickCanonical(c.members);
    console.log(
      `  - ${c.basis} / ${c.region} / ${c.address ?? normaliseName(canonical.name)}: ${buildNotes(c, canonical)}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
