/**
 * One-off READ-ONLY: emit a CSV of every active location with >1 kiosk
 * assignment (current OR historical), so ops can spot-check before the
 * kiosk_assignments.assignedAt backfill from locations.live_date overwrites
 * every kiosk at the same location with the same date.
 *
 * Usage: source prod env, then `npx tsx scripts/list-multi-kiosk-locations.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const OUT_PATH =
  "/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/tasks/analytics-audit/multi-kiosk-locations.csv";

const HEADER = [
  "location_id",
  "outlet_code",
  "location_name",
  "region",
  "kiosk_count",
  "location_live_date",
  "kiosk_id",
  "kiosk_serial_number",
  "kiosk_hardware_model",
  "assigned_at",
  "unassigned_at",
  "is_currently_assigned",
] as const;

type Row = Record<(typeof HEADER)[number], string>;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isoOrEmpty(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function main() {
  const result = (await db.execute(sql`
    WITH multi AS (
      SELECT location_id
      FROM kiosk_assignments
      GROUP BY location_id
      HAVING COUNT(*) > 1
    )
    SELECT
      l.id              AS location_id,
      l.outlet_code     AS outlet_code,
      l.name            AS location_name,
      r.name            AS region,
      cnt.kiosk_count   AS kiosk_count,
      l.live_date       AS location_live_date,
      k.id              AS kiosk_id,
      k.hardware_serial_number AS kiosk_serial_number,
      k.hardware_model  AS kiosk_hardware_model,
      ka.assigned_at    AS assigned_at,
      ka.unassigned_at  AS unassigned_at,
      (ka.unassigned_at IS NULL) AS is_currently_assigned
    FROM kiosk_assignments ka
    JOIN multi             ON multi.location_id = ka.location_id
    JOIN locations l       ON l.id = ka.location_id
    JOIN regions   r       ON r.id = l.primary_region_id
    JOIN kiosks    k       ON k.id = ka.kiosk_id
    JOIN (
      SELECT location_id, COUNT(*)::int AS kiosk_count
      FROM kiosk_assignments
      GROUP BY location_id
    ) cnt ON cnt.location_id = ka.location_id
    WHERE l.archived_at IS NULL
    ORDER BY l.outlet_code ASC, ka.assigned_at ASC
  `)) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

  const rows = (Array.isArray(result) ? result : (result.rows ?? [])) as Record<
    string,
    unknown
  >[];

  const csvRows: Row[] = rows.map((r) => ({
    location_id: String(r.location_id ?? ""),
    outlet_code: String(r.outlet_code ?? ""),
    location_name: String(r.location_name ?? ""),
    region: String(r.region ?? ""),
    kiosk_count: String(r.kiosk_count ?? ""),
    location_live_date: isoOrEmpty(r.location_live_date),
    kiosk_id: String(r.kiosk_id ?? ""),
    kiosk_serial_number: String(r.kiosk_serial_number ?? ""),
    kiosk_hardware_model: String(r.kiosk_hardware_model ?? ""),
    assigned_at: isoOrEmpty(r.assigned_at),
    unassigned_at: isoOrEmpty(r.unassigned_at),
    is_currently_assigned: r.is_currently_assigned ? "TRUE" : "FALSE",
  }));

  const out = [
    HEADER.join(","),
    ...csvRows.map((row) => HEADER.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, out + "\n", "utf8");

  const distinctLocations = new Set(csvRows.map((r) => r.location_id)).size;
  const distribution = new Map<number, number>();
  const seen = new Set<string>();
  for (const r of csvRows) {
    if (seen.has(r.location_id)) continue;
    seen.add(r.location_id);
    const n = Number(r.kiosk_count);
    distribution.set(n, (distribution.get(n) ?? 0) + 1);
  }
  const distStr = [...distribution.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${v} location(s) with ${k} kiosks`)
    .join(", ");

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Locations: ${distinctLocations}`);
  console.log(`Kiosk-assignment rows: ${csvRows.length}`);
  console.log(`Distribution: ${distStr}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
