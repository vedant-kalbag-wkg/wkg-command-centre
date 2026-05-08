/**
 * Probe Monday — two modes:
 *
 *   --mode=addresses (default, back-compat)
 *     READ-ONLY. Fetches hotels from the 4 Monday hotel boards, reads each
 *     hotel's "location" column (= Monday's address field), and produces a
 *     CSV diff against the current state of `locations.address` in the DB.
 *     Status per row: MATCH / DIFF / MONDAY_BLANK / DB_BLANK / NO_MONDAY /
 *     BOTH_BLANK. Output: stdout summary + /tmp/monday-vs-db-addresses.csv.
 *     Requires: DATABASE_URL, MONDAY_API_TOKEN.
 *
 *   --mode=normalised-name-counts (Phase 7 plan 07-01)
 *     READ-ONLY. Iterates the same 4 hotel boards and tallies item counts
 *     per `normaliseName(item.name)`. Answers RESEARCH.md OQ#1: does Monday
 *     have one hotel item per same-name group, or N? Output: JSON to stdout
 *     `{ totalItems, distinctNormalisedNames, sameNameGroups[] }`; markdown
 *     summary to stderr. Requires: MONDAY_API_TOKEN. DATABASE_URL not used.
 *
 * Usage:
 *   DATABASE_URL=... MONDAY_API_TOKEN=... npx tsx scripts/probe-monday-vs-db-addresses.ts
 *   MONDAY_API_TOKEN=... npx tsx scripts/probe-monday-vs-db-addresses.ts --mode=normalised-name-counts
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

async function mondayQuery<T>(query: string): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_TOKEN as string,
      "Content-Type": "application/json",
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Monday error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

type MondayHotel = {
  outletCodes: string[];
  hotelName: string;
  boardName: string;
  mondayItemId: string;
  hotelAddress: string | null;
};

async function fetchAllHotels(): Promise<MondayHotel[]> {
  const out: MondayHotel[] = [];
  for (const boardId of HOTEL_BOARD_IDS) {
    let cursor: string | null = null;
    let firstPage = true;
    let count = 0;
    while (true) {
      const colFrag = `column_values { id text type ... on MirrorValue { display_value } ... on LocationValue { text } }`;
      const query = firstPage
        ? `{ boards(ids: [${boardId}]) { items_page(limit: 500) { cursor items { id name ${colFrag} } } } }`
        : `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name ${colFrag} } } }`;

      const data = (await mondayQuery(query)) as Record<string, unknown>;
      const page = firstPage
        ? (data as { boards: Array<{ items_page: PageShape }> }).boards[0].items_page
        : (data as { next_items_page: PageShape }).next_items_page;

      for (const item of page.items) {
        const cols = new Map(item.column_values.map((cv) => [cv.id, cv]));
        const mirrorVal = cols.get("mirror9");
        const display = mirrorVal?.display_value ?? mirrorVal?.text ?? null;
        const outletCodes: string[] = [];
        if (display) {
          for (const code of display.split(",")) {
            const t = code.trim();
            if (t) outletCodes.push(t);
          }
        }
        const locCol = cols.get("location");
        const hotelAddress = locCol?.text?.trim() || null;

        out.push({
          outletCodes,
          hotelName: item.name,
          boardName: BOARD_NAMES[boardId] ?? `Board ${boardId}`,
          mondayItemId: item.id,
          hotelAddress,
        });
        count++;
      }
      cursor = page.cursor;
      firstPage = false;
      if (!cursor || page.items.length === 0) break;
    }
    console.error(`[fetch] ${BOARD_NAMES[boardId]}: ${count} hotels`);
  }
  return out;
}

interface PageShape {
  cursor: string | null;
  items: Array<{
    id: string;
    name: string;
    column_values: Array<{
      id: string;
      text: string | null;
      type: string;
      display_value?: string;
    }>;
  }>;
}

// normaliseName: same-name collapse function used by Plan A pre-flight + Plan
// D guardrail. MUST be lifted verbatim into src/lib/normalise.ts in plan 07-02
// (D-09 — single source of truth across hotel importer, sales ETL, same-name
// detection). If the regex sequence changes, change all three sites together.
function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
}

async function runNormalisedNameCountsMode(): Promise<void> {
  if (!MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  type Group = { boardIds: Set<number>; count: number; rawNames: string[] };
  const groups = new Map<string, Group>();
  let totalItems = 0;

  for (const boardId of HOTEL_BOARD_IDS) {
    let cursor: string | null = null;
    let firstPage = true;
    let perBoard = 0;
    while (true) {
      const query = firstPage
        ? `{ boards(ids: [${boardId}]) { items_page(limit: 500) { cursor items { id name } } } }`
        : `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name } } }`;
      const data = (await mondayQuery(query)) as Record<string, unknown>;
      const page: { cursor: string | null; items: Array<{ id: string; name: string }> } = firstPage
        ? (data as { boards: Array<{ items_page: { cursor: string | null; items: Array<{ id: string; name: string }> } }> }).boards[0]
            .items_page
        : (data as { next_items_page: { cursor: string | null; items: Array<{ id: string; name: string }> } }).next_items_page;

      for (const item of page.items) {
        totalItems++;
        perBoard++;
        const norm = normaliseName(item.name);
        let g = groups.get(norm);
        if (!g) {
          g = { boardIds: new Set(), count: 0, rawNames: [] };
          groups.set(norm, g);
        }
        g.boardIds.add(boardId);
        g.count++;
        g.rawNames.push(item.name);
      }
      cursor = page.cursor;
      firstPage = false;
      if (!cursor || page.items.length === 0) break;
    }
    console.error(`[normalised-name-counts] ${BOARD_NAMES[boardId]}: ${perBoard} items`);
  }

  const sameNameGroups = [...groups.entries()]
    .filter(([, g]) => g.count > 1)
    .map(([normalised, g]) => ({
      normalised,
      count: g.count,
      boardIds: [...g.boardIds].sort((a, b) => a - b),
      rawNames: [...new Set(g.rawNames)].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.normalised.localeCompare(b.normalised));

  const result = {
    totalItems,
    distinctNormalisedNames: groups.size,
    sameNameGroups,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  if (sameNameGroups.length === 0) {
    process.stderr.write("\nno same-name groups detected on Monday boards\n");
  } else {
    process.stderr.write(`\nSame-name groups (${sameNameGroups.length}):\n\n`);
    process.stderr.write("| Normalised | Count | Boards | Raw names |\n");
    process.stderr.write("|------------|-------|--------|-----------|\n");
    for (const g of sameNameGroups) {
      process.stderr.write(
        `| ${g.normalised} | ${g.count} | ${g.boardIds.join(", ")} | ${g.rawNames.join(" / ")} |\n`,
      );
    }
  }
}

async function runAddressProbeMode(): Promise<void> {
  if (!MONDAY_API_TOKEN) {
    console.error("Missing MONDAY_API_TOKEN");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }

  console.error("[probe] fetching Monday hotels…");
  const hotels = await fetchAllHotels();
  console.error(`[probe] total Monday hotel items: ${hotels.length}`);

  // Build outlet_code → hotel map (multi outlet codes per hotel)
  const outletToHotel = new Map<string, MondayHotel>();
  for (const h of hotels) {
    for (const code of h.outletCodes) {
      // If two boards have the same code, prefer Live Estate > Ready to Launch > Australia DCM > Removed
      const existing = outletToHotel.get(code);
      if (!existing) {
        outletToHotel.set(code, h);
        continue;
      }
      const priority = (b: string) =>
        b === "Live Estate" ? 0 : b === "Ready to Launch" ? 1 : b === "Australia DCM" ? 2 : 3;
      if (priority(h.boardName) < priority(existing.boardName)) {
        outletToHotel.set(code, h);
      }
    }
  }
  console.error(`[probe] distinct outlet codes in Monday: ${outletToHotel.size}`);

  // Pull DB locations
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const dbRows = (
    (await db.execute(sql`
      SELECT id::text, outlet_code, name, COALESCE(address,'') AS address, archived_at IS NOT NULL AS archived
        FROM locations
       WHERE outlet_code IS NOT NULL
       ORDER BY archived_at NULLS FIRST, outlet_code
    `)) as unknown as { rows: Array<{ id: string; outlet_code: string; name: string; address: string; archived: boolean }> }
  ).rows;
  console.error(`[probe] DB locations with outlet_code: ${dbRows.length}`);

  // Compute diff
  const counts = {
    total: 0,
    archived: 0,
    MATCH: 0,
    DIFF: 0,
    MONDAY_BLANK: 0,
    DB_BLANK: 0,
    NO_MONDAY: 0,
    BOTH_BLANK: 0,
  };

  const csvRows: string[] = [
    "id,outlet_code,name,archived,status,db_address,monday_hotel_name,monday_address,monday_board,monday_item_id",
  ];
  function csvField(s: string | null | undefined): string {
    const v = s ?? "";
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  for (const row of dbRows) {
    counts.total++;
    if (row.archived) counts.archived++;

    const monday = outletToHotel.get(row.outlet_code);
    const dbAddr = row.address.trim();
    const mondayAddr = monday?.hotelAddress?.trim() ?? "";

    let status: keyof typeof counts;
    if (!monday) {
      status = "NO_MONDAY";
    } else if (!dbAddr && !mondayAddr) {
      status = "BOTH_BLANK";
    } else if (!mondayAddr) {
      status = "MONDAY_BLANK";
    } else if (!dbAddr) {
      status = "DB_BLANK";
    } else if (dbAddr === mondayAddr) {
      status = "MATCH";
    } else {
      status = "DIFF";
    }
    counts[status]++;

    csvRows.push(
      [
        row.id,
        csvField(row.outlet_code),
        csvField(row.name),
        row.archived ? "Y" : "N",
        status,
        csvField(dbAddr),
        csvField(monday?.hotelName ?? ""),
        csvField(mondayAddr),
        csvField(monday?.boardName ?? ""),
        csvField(monday?.mondayItemId ?? ""),
      ].join(","),
    );
  }

  const outPath = "/tmp/monday-vs-db-addresses.csv";
  writeFileSync(outPath, csvRows.join("\n") + "\n", "utf8");

  console.log("\n=== Summary ===");
  console.log(`Total DB locations w/ outlet_code: ${counts.total} (active: ${counts.total - counts.archived}, archived: ${counts.archived})`);
  console.log(`  MATCH (db == monday)             : ${counts.MATCH}`);
  console.log(`  DIFF  (both populated, different): ${counts.DIFF}    ← rows that would change`);
  console.log(`  DB_BLANK (monday populates a NULL): ${counts.DB_BLANK}    ← rows that get populated`);
  console.log(`  MONDAY_BLANK (db keeps existing) : ${counts.MONDAY_BLANK}    ← rows where Monday gives no fix`);
  console.log(`  BOTH_BLANK                        : ${counts.BOTH_BLANK}    ← unfixable from Monday alone`);
  console.log(`  NO_MONDAY (no matching hotel)     : ${counts.NO_MONDAY}    ← outlet_code has no Monday match`);
  console.log(`\nFull CSV written to ${outPath}`);

  await pool.end();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "addresses";
  if (mode === "normalised-name-counts") {
    await runNormalisedNameCountsMode();
  } else if (mode === "addresses") {
    await runAddressProbeMode();
  } else {
    console.error(`Unknown --mode=${mode}. Valid: addresses, normalised-name-counts`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
