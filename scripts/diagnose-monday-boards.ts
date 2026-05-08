// One-shot diagnostic: inspect Monday boards used by the v2 reseed
// runbook and report what the importers see vs reject. Read-only; safe.
//
// Usage:
//   MONDAY_API_TOKEN=... npx tsx scripts/diagnose-monday-boards.ts
//
// Surfaces (per board):
//   - total items
//   - per-group breakdown
//   - presence of relevant columns (mirror9 / outlet_code1 / link_to_hotel_ssms)
//   - items WITH outlet code populated (the only ones that import)

import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const HOTEL_BOARDS: Array<{ id: number; name: string }> = [
  { id: 1356570756, name: "Live Estate" },
  { id: 1743012104, name: "Ready to Launch" },
  { id: 5026387784, name: "Removed" },
  { id: 5092887865, name: "Australia DCM" },
];

const ASSETS_BOARD = { id: 1426737864, name: "Assets" };

const HOTEL_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["mirror9"]) {
    id
    type
    ... on MirrorValue { display_value }
  }
`;

const ASSET_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["outlet_code1", "link_to_hotel_ssms"]) {
    id
    type
    text
    value
    ... on BoardRelationValue { linked_item_ids }
  }
`;

type Bucket = { total: number; withOutletCode: number; multiCode: number; codes: number };
type GroupStats = Record<string, Bucket>;

function emptyBucket(): Bucket {
  return { total: 0, withOutletCode: 0, multiCode: 0, codes: 0 };
}

async function inspectHotelBoard(boardId: number, boardName: string) {
  const groupStats: GroupStats = {};
  let total = 0;
  let withMirror9 = 0;
  let multiCode = 0;
  let totalCodes = 0;
  const multiExamples: Array<{ id: string; name: string; group: string; codes: string[] }> = [];

  for await (const item of iterateBoardItems(boardId, { itemFragment: HOTEL_FRAGMENT })) {
    total++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(no-group)";
    if (!groupStats[groupTitle]) groupStats[groupTitle] = emptyBucket();
    groupStats[groupTitle].total++;

    const mirror = item.column_values.find((cv) => cv.id === "mirror9");
    const display = (mirror as { display_value?: string } | undefined)?.display_value?.trim() ?? "";
    if (display.length > 0) {
      withMirror9++;
      groupStats[groupTitle].withOutletCode++;
      const codes = display.split(",").map((s) => s.trim()).filter(Boolean);
      totalCodes += codes.length;
      groupStats[groupTitle].codes += codes.length;
      if (codes.length > 1) {
        multiCode++;
        groupStats[groupTitle].multiCode++;
        multiExamples.push({ id: item.id, name: item.name, group: groupTitle, codes });
      }
    }
  }

  console.log(`\n=== HOTEL BOARD ${boardId} (${boardName}) ===`);
  console.log(`  Total items                    : ${total}`);
  console.log(`  Items with mirror9 populated   : ${withMirror9}`);
  console.log(`  Items with multi-code mirror9  : ${multiCode}  (codes lost beyond first)`);
  console.log(`  Total mirror9 codes seen       : ${totalCodes}`);
  console.log(`  Per-group breakdown:`);
  for (const [title, b] of Object.entries(groupStats).sort()) {
    console.log(
      `    ${title.padEnd(45)} total=${String(b.total).padStart(4)} withOutlet=${String(b.withOutletCode).padStart(4)} multi=${String(b.multiCode).padStart(3)} codes=${String(b.codes).padStart(4)}`,
    );
  }
  if (multiExamples.length > 0) {
    console.log(`  Multi-code hotels (only mirror9[0] is imported as the location's outlet_code):`);
    for (const ex of multiExamples) {
      console.log(`    [${ex.id}] ${ex.name}  (${ex.group})  codes=[${ex.codes.join(", ")}]  imported=${ex.codes[0]}  lost=[${ex.codes.slice(1).join(", ")}]`);
    }
  }
}

async function inspectAssetsBoard() {
  const groupStats: GroupStats = {};
  let total = 0;
  let withOutletCode = 0;
  let withLinkedHotel = 0;
  let withBoth = 0;

  for await (const item of iterateBoardItems(ASSETS_BOARD.id, { itemFragment: ASSET_FRAGMENT })) {
    total++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(no-group)";
    if (!groupStats[groupTitle]) groupStats[groupTitle] = emptyBucket();
    groupStats[groupTitle].total++;

    const outletCv = item.column_values.find((c) => c.id === "outlet_code1");
    const outletCode = outletCv?.text?.trim() ?? "";
    const hasOutlet = outletCode.length > 0;
    if (hasOutlet) {
      withOutletCode++;
      groupStats[groupTitle].withOutletCode++;
    }

    const linkCv = item.column_values.find((c) => c.id === "link_to_hotel_ssms") as
      | (typeof item.column_values[number] & { linked_item_ids?: string[] | null })
      | undefined;
    const hasLink = (linkCv?.linked_item_ids ?? []).length > 0;
    if (hasLink) withLinkedHotel++;
    if (hasOutlet && hasLink) withBoth++;
  }

  console.log(`\n=== ASSETS BOARD ${ASSETS_BOARD.id} (${ASSETS_BOARD.name}) ===`);
  console.log(`  Total items                    : ${total}`);
  console.log(`  With outlet_code1              : ${withOutletCode}`);
  console.log(`  With link_to_hotel_ssms        : ${withLinkedHotel}`);
  console.log(`  With BOTH (importable)         : ${withBoth}`);
  console.log(`  Per-group breakdown:`);
  for (const [title, b] of Object.entries(groupStats).sort()) {
    console.log(
      `    ${title.padEnd(45)} total=${String(b.total).padStart(4)} withOutlet=${String(b.withOutletCode).padStart(4)}`,
    );
  }
}

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");
  for (const b of HOTEL_BOARDS) await inspectHotelBoard(b.id, b.name);
  await inspectAssetsBoard();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
