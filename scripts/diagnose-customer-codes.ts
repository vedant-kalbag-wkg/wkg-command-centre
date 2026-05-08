// Probe customer-code populations across all relevant Monday boards before
// committing to a customer_code-primary refactor. If most rows are empty,
// the refactor needs different keys.

import { iterateBoardItems, mondayQuery, type MondayItem } from "@/lib/monday/client";

const HOTEL_BOARDS = [
  { id: 1356570756, name: "Live Estate", colId: "mirror3__1" },
  { id: 1743012104, name: "Ready to Launch", colId: "mirror3__1" },
  { id: 5026387784, name: "Removed", colId: "mirror3__1" },
  { id: 5092887865, name: "Australia DCM", colId: "mirror3__1" },
];
const HEATHROW = { id: 1356657751, name: "Heathrow Express SSMs", colId: "text4" };

const COL_Q = `query ($id: [ID!]) { boards(ids: $id) { id columns { id title type settings_str } } }`;

async function probe(boardId: number, name: string, colId: string) {
  // First: what does the column's settings_str say (esp. for mirror types)?
  const meta = await mondayQuery<{ boards: Array<{ columns: Array<{ id: string; title: string; type: string; settings_str: string }> }> }>(COL_Q, { id: [String(boardId)] });
  const col = meta.boards[0]?.columns.find((c) => c.id === colId);
  console.log(`\n=== ${name} (${boardId}) — column ${colId} ===`);
  if (!col) { console.log(`  Column ${colId} not present.`); return; }
  console.log(`  title : ${col.title}`);
  console.log(`  type  : ${col.type}`);
  if (col.type === "mirror") {
    try {
      const s = JSON.parse(col.settings_str);
      console.log(`  settings: ${JSON.stringify(s)}`);
    } catch { console.log(`  settings: ${col.settings_str}`); }
  }

  // Iterate items and tally
  const fragment = `
    id name
    group { id title }
    column_values(ids: ["${colId}"]) {
      id type text
      ... on MirrorValue { display_value }
    }
  `;
  let total = 0, populated = 0;
  const samples: Array<{ id: string; name: string; group: string; value: string }> = [];
  const empties: string[] = [];
  const groupCounts: Record<string, { items: number; populated: number }> = {};

  for await (const item of iterateBoardItems(boardId, { itemFragment: fragment })) {
    total++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(none)";
    if (!groupCounts[groupTitle]) groupCounts[groupTitle] = { items: 0, populated: 0 };
    groupCounts[groupTitle].items++;

    const cv = item.column_values.find((c) => c.id === colId) as
      | (typeof item.column_values[number] & { display_value?: string }) | undefined;
    const value = (cv?.display_value ?? cv?.text ?? "").trim();
    if (value) {
      populated++;
      groupCounts[groupTitle].populated++;
      if (samples.length < 6) samples.push({ id: item.id, name: item.name, group: groupTitle, value });
    } else if (empties.length < 6) {
      empties.push(`[${item.id}] "${item.name}" (${groupTitle})`);
    }
  }
  console.log(`  Total items   : ${total}`);
  console.log(`  Populated     : ${populated}  (${((populated/total)*100).toFixed(1)}%)`);
  console.log(`  Per-group:`);
  for (const [g, b] of Object.entries(groupCounts).sort()) {
    console.log(`    ${g.padEnd(40)} items=${String(b.items).padStart(4)} populated=${String(b.populated).padStart(4)}`);
  }
  console.log(`  Sample populated values:`);
  for (const s of samples) console.log(`    [${s.id}] ${s.name.padEnd(45)} (${s.group})  =${s.value}`);
  if (empties.length > 0) {
    console.log(`  Sample EMPTY items:`);
    for (const e of empties) console.log(`    ${e}`);
  }
}

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");
  for (const b of HOTEL_BOARDS) await probe(b.id, b.name, b.colId);
  await probe(HEATHROW.id, HEATHROW.name, HEATHROW.colId);
}
main().catch((e) => { console.error(e); process.exit(1); });
