// Cross-reference: do Assets-board items link back to Heathrow Express
// SSMs board items (via link_to_hotel_ssms)? If yes, Assets-import will
// pick them up given Heathrow items are in the hotelMondayIdToLocationId
// map. If no, Heathrow items are standalone and their kiosks aren't on
// the Assets board.

import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  // 1. All Heathrow item ids
  const heathrow: Record<string, string> = {};
  for await (const item of iterateBoardItems(1356657751, {
    itemFragment: `id name`,
  })) heathrow[item.id] = item.name;
  console.log(`Heathrow board has ${Object.keys(heathrow).length} items.`);

  // 2. All Assets items + their linked hotel
  type LinkRef = { id: string; name: string; outletCode: string | null; group: string; linkedTargets: string[] };
  const assetsLinkingToHeathrow: LinkRef[] = [];
  let assetsTotal = 0;
  let assetsWithLink = 0;
  for await (const item of iterateBoardItems(1426737864, {
    itemFragment: `id name group { id title } column_values(ids: ["outlet_code1", "link_to_hotel_ssms"]) { id type text ... on BoardRelationValue { linked_item_ids } }`,
  })) {
    assetsTotal++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "";
    const outletCv = item.column_values.find((c) => c.id === "outlet_code1");
    const outletCode = (outletCv?.text ?? "").trim() || null;
    const linkCv = item.column_values.find((c) => c.id === "link_to_hotel_ssms") as
      | (typeof item.column_values[number] & { linked_item_ids?: string[] | null }) | undefined;
    const linked = linkCv?.linked_item_ids ?? [];
    if (linked.length > 0) assetsWithLink++;
    const heathrowLinks = linked.filter((id) => id in heathrow);
    if (heathrowLinks.length > 0) {
      assetsLinkingToHeathrow.push({
        id: item.id, name: item.name, outletCode, group: groupTitle, linkedTargets: heathrowLinks,
      });
    }
  }

  console.log(`Assets total: ${assetsTotal}, with any link: ${assetsWithLink}`);
  console.log(`Assets linking to Heathrow board items: ${assetsLinkingToHeathrow.length}`);
  if (assetsLinkingToHeathrow.length > 0) {
    console.log(`\nAsset → Heathrow links:`);
    for (const ref of assetsLinkingToHeathrow) {
      const targets = ref.linkedTargets.map((id) => `${id} "${heathrow[id]}"`).join(", ");
      console.log(`  Asset[${ref.id}] outlet=${ref.outletCode ?? "(empty)"} group=${ref.group}  → ${targets}`);
    }
  } else {
    console.log(`\n  ZERO Assets items link back to the Heathrow Express SSMs board.`);
    console.log(`  Implication: Heathrow board items' kiosks live in the board itself`);
    console.log(`  (outlet_code1 directly), not as separate Assets entries.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
