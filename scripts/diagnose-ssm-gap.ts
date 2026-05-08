// Per-hotel reconciliation: declared `Number of SSMs` vs the count of
// items on the Assets board that link back to that hotel. Surfaces the
// operator-data-entry gap (hotel says "we have 2 SSMs", Assets has 1).
//
// Also reports outlet-code situation per linked Assets item — some may
// have empty outlet_code1 (per user: hotel boards' mirror9 is the
// fallback source of truth in that case).

import { mondayQuery, iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const HOTEL_BOARDS = [
  { id: 1356570756, name: "Live Estate" },
  { id: 1743012104, name: "Ready to Launch" },
  { id: 5026387784, name: "Removed" },
  { id: 5092887865, name: "Australia DCM" },
];
const ASSETS_BOARD_ID = 1426737864;

// Predicate: which groups represent currently-live deployed hotels?
function isLiveGroup(boardId: number, groupTitle: string): boolean {
  if (boardId === 5026387784) return false; // Removed
  // "Live: ..." groups on Live Estate + AU DCM; "Engagements", "On Hold" excluded.
  // "Ready to Launch" main group on RTL board counts as live (kiosk imminent).
  if (/^live[:\s]/i.test(groupTitle)) return true;
  if (/^ready to launch$/i.test(groupTitle)) return true;
  return false;
}

const HOTEL_FRAGMENT = `
  id name
  group { id title }
  column_values(ids: ["number_of_ssms", "mirror9"]) {
    id type text value
    ... on NumbersValue { number }
    ... on MirrorValue { display_value }
  }
`;

const ASSET_FRAGMENT = `
  id name
  group { id title }
  column_values(ids: ["outlet_code1", "link_to_hotel_ssms"]) {
    id type text value
    ... on BoardRelationValue { linked_item_ids }
  }
`;

type Hotel = {
  id: string;
  name: string;
  boardId: number;
  boardName: string;
  group: string;
  numberOfSsms: number;
  mirror9Codes: string[];
};

type Asset = {
  id: string;
  name: string;
  group: string;
  outletCode: string | null;
  linkedHotelId: string | null;
};

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  // 1. Pull all hotels
  const hotels: Hotel[] = [];
  for (const b of HOTEL_BOARDS) {
    for await (const item of iterateBoardItems(b.id, { itemFragment: HOTEL_FRAGMENT })) {
      const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "";
      const ssmCv = item.column_values.find((c) => c.id === "number_of_ssms") as
        | (typeof item.column_values[number] & { number?: number | null }) | undefined;
      const mirrorCv = item.column_values.find((c) => c.id === "mirror9") as
        | (typeof item.column_values[number] & { display_value?: string }) | undefined;
      const ssm = (ssmCv?.number as number | null | undefined) ?? 0;
      const mirror = (mirrorCv?.display_value ?? "").trim();
      const codes = mirror ? mirror.split(",").map((s) => s.trim()).filter(Boolean) : [];
      hotels.push({
        id: item.id, name: item.name, boardId: b.id, boardName: b.name,
        group: groupTitle, numberOfSsms: ssm, mirror9Codes: codes,
      });
    }
  }
  console.log(`Loaded ${hotels.length} hotels across ${HOTEL_BOARDS.length} boards.`);

  // 2. Pull all assets
  const assets: Asset[] = [];
  for await (const item of iterateBoardItems(ASSETS_BOARD_ID, { itemFragment: ASSET_FRAGMENT })) {
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "";
    const outletCv = item.column_values.find((c) => c.id === "outlet_code1");
    const outletCode = (outletCv?.text ?? "").trim() || null;
    const linkCv = item.column_values.find((c) => c.id === "link_to_hotel_ssms") as
      | (typeof item.column_values[number] & { linked_item_ids?: string[] | null }) | undefined;
    const linked = linkCv?.linked_item_ids ?? [];
    assets.push({
      id: item.id, name: item.name, group: groupTitle,
      outletCode, linkedHotelId: linked.length > 0 ? linked[0] : null,
    });
  }
  console.log(`Loaded ${assets.length} Assets-board items.`);

  // 3. Index Assets by linked hotel
  const assetsByHotel = new Map<string, Asset[]>();
  for (const a of assets) {
    if (!a.linkedHotelId) continue;
    if (!assetsByHotel.has(a.linkedHotelId)) assetsByHotel.set(a.linkedHotelId, []);
    assetsByHotel.get(a.linkedHotelId)!.push(a);
  }

  // 4. Per-hotel reconciliation
  type Row = {
    hotel: Hotel;
    assetCount: number;
    assetsWithOutletCode: number;
    assetsWithoutOutletCode: number;
    gap: number; // numberOfSsms - assetCount
    assetSummary: string;
  };
  const rows: Row[] = [];
  for (const h of hotels) {
    const linkedAssets = assetsByHotel.get(h.id) ?? [];
    const withOutlet = linkedAssets.filter((a) => a.outletCode).length;
    const withoutOutlet = linkedAssets.length - withOutlet;
    rows.push({
      hotel: h,
      assetCount: linkedAssets.length,
      assetsWithOutletCode: withOutlet,
      assetsWithoutOutletCode: withoutOutlet,
      gap: h.numberOfSsms - linkedAssets.length,
      assetSummary: linkedAssets
        .map((a) => `${a.outletCode ?? "(no-code)"} [${a.id}]`)
        .join(", "),
    });
  }

  // 5. Filter + report
  const liveRows = rows.filter((r) => isLiveGroup(r.hotel.boardId, r.hotel.group));
  const liveSsmTotal = liveRows.reduce((s, r) => s + r.hotel.numberOfSsms, 0);
  const liveAssetTotal = liveRows.reduce((s, r) => s + r.assetCount, 0);
  console.log(`\n=== LIVE-only reconciliation ===`);
  console.log(`  Hotels in live groups: ${liveRows.length}`);
  console.log(`  Σ Number of SSMs:      ${liveSsmTotal}`);
  console.log(`  Σ Linked Assets:       ${liveAssetTotal}`);
  console.log(`  Net gap:               ${liveSsmTotal - liveAssetTotal}`);

  console.log(`\n=== Hotels where Number of SSMs > linked-Assets count (operator gap) ===`);
  console.log(`  ${"Board".padEnd(18)} ${"Group".padEnd(28)} ${"Hotel".padEnd(50)} SSM  Assets  Gap  mirror9`);
  const gapRows = liveRows.filter((r) => r.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.hotel.name.localeCompare(b.hotel.name));
  for (const r of gapRows) {
    const m9 = r.hotel.mirror9Codes.length > 0 ? `[${r.hotel.mirror9Codes.join(",")}]` : "[]";
    console.log(
      `  ${r.hotel.boardName.padEnd(18)} ${r.hotel.group.padEnd(28)} ${r.hotel.name.padEnd(50).slice(0, 50)} ${String(r.hotel.numberOfSsms).padStart(3)}  ${String(r.assetCount).padStart(6)}  ${String(r.gap).padStart(3)}  ${m9}`,
    );
  }
  console.log(`  Total gap rows: ${gapRows.length}; Σ missing kiosks: ${gapRows.reduce((s, r) => s + r.gap, 0)}`);

  console.log(`\n=== Hotels where Assets has more items than Number of SSMs (mis-counted on Monday) ===`);
  const surplusRows = liveRows.filter((r) => r.gap < 0)
    .sort((a, b) => a.gap - b.gap || a.hotel.name.localeCompare(b.hotel.name));
  for (const r of surplusRows) {
    console.log(
      `  ${r.hotel.boardName.padEnd(18)} ${r.hotel.group.padEnd(28)} ${r.hotel.name.padEnd(50).slice(0, 50)} ${String(r.hotel.numberOfSsms).padStart(3)}  ${String(r.assetCount).padStart(6)}  ${String(r.gap).padStart(3)}`,
    );
  }
  console.log(`  Total surplus rows: ${surplusRows.length}; Σ extra assets: ${surplusRows.reduce((s, r) => s + Math.abs(r.gap), 0)}`);

  console.log(`\n=== Live-group Assets items with EMPTY outlet_code1 (mirror9 fallback candidates) ===`);
  let candidateCount = 0;
  for (const r of liveRows) {
    const linked = assetsByHotel.get(r.hotel.id) ?? [];
    const noCode = linked.filter((a) => !a.outletCode);
    if (noCode.length === 0) continue;
    candidateCount += noCode.length;
    const m9 = r.hotel.mirror9Codes.length > 0 ? `[${r.hotel.mirror9Codes.join(",")}]` : "[]";
    for (const a of noCode) {
      console.log(`  ${r.hotel.boardName.padEnd(18)} ${r.hotel.name.padEnd(45).slice(0, 45)} hotel-mirror9=${m9.padEnd(20)} assetId=${a.id} group=${a.group}`);
    }
  }
  console.log(`  Total Assets items missing outlet_code1 in live-group hotels: ${candidateCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
