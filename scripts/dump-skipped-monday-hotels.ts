/**
 * Dry-run diagnostic: re-fetch Monday.com hotels and classify the hotels the
 * import-location-products-from-monday.ts script would SKIP against the
 * current prod `locations` table.
 *
 * ZERO writes.
 *
 * Run:
 *   set -a; source .env.local; set +a
 *   DATABASE_URL="<prod>" npx tsx scripts/dump-skipped-monday-hotels.ts
 */

import { db } from "@/db";
import { locations } from "@/db/schema";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN");
  process.exit(1);
}

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

async function mondayQuery(query: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_TOKEN!,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }
    const json = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      if (msg.includes("Rate limit") || msg.includes("complexity")) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      throw new Error(`Monday GraphQL error: ${msg}`);
    }
    return json.data;
  }
  throw new Error("Monday API: max retries exceeded");
}

interface HotelRow {
  boardName: string;
  hotelName: string;
  outletCodes: string[];
  subitemCount: number;
}

async function fetchAllHotels(): Promise<HotelRow[]> {
  const all: HotelRow[] = [];
  for (const boardId of HOTEL_BOARD_IDS) {
    console.log(`[FETCH] ${BOARD_NAMES[boardId]} (${boardId})...`);
    let cursor: string | null = null;
    let firstPage = true;
    let count = 0;
    while (true) {
      const itemFragment = `
        id name
        column_values(ids: ["mirror9"]) {
          id type
          ... on MirrorValue { display_value }
        }
        subitems { id }
      `;
      const query = firstPage
        ? `{ boards(ids: [${boardId}]) { items_page(limit: 100) { cursor items { ${itemFragment} } } } }`
        : `{ next_items_page(limit: 100, cursor: "${cursor}") { cursor items { ${itemFragment} } } }`;
      const data = (await mondayQuery(query)) as Record<string, unknown>;
      interface PageShape {
        cursor: string | null;
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; type: string; display_value?: string }>;
          subitems: Array<{ id: string }>;
        }>;
      }
      const page: PageShape = firstPage
        ? (data as { boards: Array<{ items_page: PageShape }> }).boards[0].items_page
        : (data as { next_items_page: PageShape }).next_items_page;
      for (const item of page.items) {
        const mirror = item.column_values.find((cv) => cv.id === "mirror9");
        const codes: string[] = [];
        if (mirror?.display_value) {
          for (const c of mirror.display_value.split(",")) {
            const t = c.trim();
            if (t) codes.push(t);
          }
        }
        if (item.subitems.length > 0) {
          all.push({
            boardName: BOARD_NAMES[boardId],
            hotelName: item.name,
            outletCodes: codes,
            subitemCount: item.subitems.length,
          });
        }
      }
      count += page.items.length;
      firstPage = false;
      if (!page.cursor || page.items.length === 0) break;
      cursor = page.cursor;
    }
    console.log(`[FETCH]   ${BOARD_NAMES[boardId]}: ${count} hotels`);
  }
  console.log(`[FETCH] Total hotels with subitems: ${all.length}\n`);
  return all;
}

async function main() {
  const hotels = await fetchAllHotels();

  const locRows = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations);
  const locOutletCodes = new Set(
    locRows.filter((l) => l.outletCode).map((l) => l.outletCode!)
  );
  console.log(`[DB] Loaded ${locOutletCodes.size} distinct outlet codes from locations\n`);

  const case1: HotelRow[] = [];
  const case2: HotelRow[] = [];
  const case3: Array<HotelRow & { matched: string[]; unmatched: string[] }> = [];

  for (const h of hotels) {
    if (h.outletCodes.length === 0) {
      case1.push(h);
      continue;
    }
    const matched = h.outletCodes.filter((c) => locOutletCodes.has(c));
    const unmatched = h.outletCodes.filter((c) => !locOutletCodes.has(c));
    if (matched.length === 0) {
      case2.push(h);
    } else if (unmatched.length > 0) {
      case3.push({ ...h, matched, unmatched });
    }
  }

  console.log("=== Skipped Monday hotels ===\n");

  console.log(`[case 1] Zero outlet codes on Monday (${case1.length} hotels):`);
  for (const h of case1) {
    console.log(`  board=${h.boardName}  name=${h.hotelName}  subitems=${h.subitemCount}`);
  }

  console.log(`\n[case 2] Outlet codes on Monday, none match locations (${case2.length} hotels):`);
  for (const h of case2) {
    console.log(
      `  board=${h.boardName}  name=${h.hotelName}  codes=[${h.outletCodes.join(", ")}]  subitems=${h.subitemCount}`
    );
  }

  console.log(`\n[case 3] Outlet codes partially match (${case3.length} hotels):`);
  for (const h of case3) {
    console.log(
      `  board=${h.boardName}  name=${h.hotelName}  matched=[${h.matched.join(", ")}]  unmatched=[${h.unmatched.join(", ")}]  subitems=${h.subitemCount}`
    );
  }

  const totalSkipped = case1.length + case2.length;
  const boardDist: Record<string, number> = {};
  const unmatchedCodes = new Set<string>();
  for (const h of case2) {
    boardDist[h.boardName] = (boardDist[h.boardName] ?? 0) + 1;
    for (const c of h.outletCodes) unmatchedCodes.add(c);
  }
  for (const h of case3) {
    boardDist[h.boardName] = (boardDist[h.boardName] ?? 0) + 1;
    for (const c of h.unmatched) unmatchedCodes.add(c);
  }

  console.log(`\nSummary:`);
  console.log(`  total_skipped (case1+case2 from import logic) = ${totalSkipped}`);
  console.log(`  case1_no_codes       = ${case1.length}`);
  console.log(`  case2_no_match       = ${case2.length}`);
  console.log(`  case3_partial_match  = ${case3.length}`);
  console.log(`  hotels_with_products_total = ${hotels.length}`);

  console.log(`\n  for case 2 + case 3 unmatched codes:`);
  console.log(
    `    board distribution: ${Object.entries(boardDist).map(([b, n]) => `${b}: ${n}`).join(", ")}`
  );
  console.log(`    unique outlet codes that need new locations (${unmatchedCodes.size}):`);
  console.log(`    [${Array.from(unmatchedCodes).sort().join(", ")}]`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
