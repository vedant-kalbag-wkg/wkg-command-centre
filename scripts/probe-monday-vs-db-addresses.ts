/**
 * Probe Monday's address coverage vs what we have in `locations.address`.
 *
 * READ-ONLY. Fetches hotels from the 4 Monday hotel boards (mirrors
 * scripts/enrich-locations-from-monday.ts), reads each hotel's "location"
 * column (= Monday's address field), and produces a CSV diff against the
 * current state of `locations.address` in the DB.
 *
 * Usage:
 *   DATABASE_URL=... MONDAY_API_TOKEN=... npx tsx scripts/probe-monday-vs-db-addresses.ts
 *
 * Output:
 *   stdout: human-readable summary stats
 *   /tmp/monday-vs-db-addresses.csv: full row-by-row diff
 *
 * Status values per row:
 *   MATCH         — Monday and DB addresses are identical (whitespace-trimmed)
 *   DIFF          — both populated, but different
 *   MONDAY_BLANK  — DB has an address, Monday doesn't
 *   DB_BLANK      — Monday has an address, DB doesn't
 *   NO_MONDAY     — DB has an outlet_code with no matching Monday hotel
 *   BOTH_BLANK    — neither has an address
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
if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

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

async function main(): Promise<void> {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
