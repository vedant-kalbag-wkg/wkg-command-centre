// Inspect board 1466686598 ("SSM Group" target) — is this the operator's
// canonical kiosk-tracking board upstream of Assets?

import { mondayQuery, iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const SSM_GROUPS_BOARD = "1466686598";

const META_Q = `query ($id: [ID!]) { boards(ids: $id) { id name description columns { id title type settings_str } groups { id title } items_count } }`;

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  const meta = await mondayQuery<{
    boards: Array<{
      id: string;
      name: string;
      description: string | null;
      items_count: number | null;
      columns: Array<{ id: string; title: string; type: string; settings_str: string }>;
      groups: Array<{ id: string; title: string }>;
    }>;
  }>(META_Q, { id: [SSM_GROUPS_BOARD] });

  const board = meta.boards[0];
  if (!board) {
    console.log(`Board ${SSM_GROUPS_BOARD} not accessible.`);
    return;
  }
  console.log(`=== Board: ${board.name} (${board.id}) ===`);
  console.log(`  description: ${board.description ?? "(none)"}`);
  console.log(`  items_count: ${board.items_count ?? "?"}`);
  console.log(`  groups (${board.groups.length}):`);
  for (const g of board.groups) console.log(`    ${g.id}  "${g.title}"`);
  console.log(`  columns (${board.columns.length}):`);
  for (const c of board.columns) {
    console.log(`    id=${c.id.padEnd(40)} type=${(c.type ?? "").padEnd(15)} title="${c.title}"`);
  }

  // Sample first few items to understand shape
  console.log(`\n=== First 10 items ===`);
  let count = 0;
  for await (const item of iterateBoardItems(Number(SSM_GROUPS_BOARD), {
    itemFragment: `id name group { id title } column_values { id type text value ... on MirrorValue { display_value } ... on BoardRelationValue { linked_item_ids } }`,
  })) {
    count++;
    console.log(`\n--- Item ${item.id}: "${item.name}" (group: ${(item as MondayItem & { group?: { title?: string } }).group?.title ?? "?"}) ---`);
    for (const cv of item.column_values) {
      const v = cv as typeof cv & { display_value?: string; linked_item_ids?: string[] | null };
      const valStr = v.display_value ?? v.text ?? (v.linked_item_ids ? `linked=[${v.linked_item_ids.join(",")}]` : "");
      if (valStr) console.log(`    ${cv.id.padEnd(40)} ${(cv.type ?? "").padEnd(15)} ${valStr}`);
    }
    if (count >= 10) break;
  }

  // Total count
  console.log(`\n=== Total items on this board (full pass) ===`);
  let totalCount = 0;
  const groupCounts: Record<string, number> = {};
  for await (const item of iterateBoardItems(Number(SSM_GROUPS_BOARD), {
    itemFragment: `id group { id title }`,
  })) {
    totalCount++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(none)";
    groupCounts[groupTitle] = (groupCounts[groupTitle] ?? 0) + 1;
  }
  console.log(`  TOTAL: ${totalCount} items`);
  for (const [g, n] of Object.entries(groupCounts).sort()) {
    console.log(`    ${g.padEnd(45)} ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
