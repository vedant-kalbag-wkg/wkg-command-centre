// Inspect a Monday board's metadata + columns + groups + first items.
// Usage: BOARD_ID=1356657751 npx tsx scripts/diagnose-new-board.ts

import { mondayQuery, iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const BOARD_ID = process.env.BOARD_ID ?? "1356657751";

const META_Q = `query ($id: [ID!]) { boards(ids: $id) { id name description columns { id title type } groups { id title } items_count } }`;

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");
  const meta = await mondayQuery<{ boards: Array<{ id: string; name: string; description: string | null; items_count: number | null; columns: Array<{ id: string; title: string; type: string }>; groups: Array<{ id: string; title: string }> }> }>(META_Q, { id: [BOARD_ID] });
  const b = meta.boards[0];
  if (!b) { console.log(`Board ${BOARD_ID} not accessible.`); return; }
  console.log(`=== ${b.name} (${b.id}) ===`);
  console.log(`  description: ${b.description ?? "(none)"}`);
  console.log(`  items_count: ${b.items_count}`);
  console.log(`  groups (${b.groups.length}):`);
  for (const g of b.groups) console.log(`    ${g.id}  "${g.title}"`);
  console.log(`  columns (${b.columns.length}):`);
  for (const c of b.columns) {
    console.log(`    id=${c.id.padEnd(40)} type=${(c.type ?? "").padEnd(15)} title="${c.title}"`);
  }

  const hasMirror9 = b.columns.some((c) => c.id === "mirror9");
  const hasSsms = b.columns.some((c) => c.id === "number_of_ssms");
  console.log(`\n  has mirror9        : ${hasMirror9}`);
  console.log(`  has number_of_ssms : ${hasSsms}`);

  // Group/SSM rollup
  const byGroup: Record<string, { items: number; withMirror9: number; ssmSum: number }> = {};
  let total = 0, withMirror9 = 0, ssmSum = 0;
  for await (const item of iterateBoardItems(Number(BOARD_ID), {
    itemFragment: `id name group { id title } column_values(ids: ["mirror9", "number_of_ssms"]) { id type ... on MirrorValue { display_value } ... on NumbersValue { number } }`,
  })) {
    total++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(none)";
    if (!byGroup[groupTitle]) byGroup[groupTitle] = { items: 0, withMirror9: 0, ssmSum: 0 };
    byGroup[groupTitle].items++;
    const m9 = item.column_values.find((c) => c.id === "mirror9") as { display_value?: string } | undefined;
    const codes = (m9?.display_value ?? "").trim();
    if (codes) { withMirror9++; byGroup[groupTitle].withMirror9++; }
    const ssm = item.column_values.find((c) => c.id === "number_of_ssms") as { number?: number | null } | undefined;
    const n = (ssm?.number as number | null | undefined) ?? 0;
    ssmSum += n;
    byGroup[groupTitle].ssmSum += n;
  }
  console.log(`\n  Total items   : ${total}`);
  console.log(`  With mirror9  : ${withMirror9}`);
  console.log(`  Σ Number of SSMs: ${ssmSum}`);
  console.log(`  Per-group:`);
  for (const [g, b2] of Object.entries(byGroup).sort()) {
    console.log(`    ${g.padEnd(45)} items=${String(b2.items).padStart(4)} withMirror9=${String(b2.withMirror9).padStart(4)} ssm-sum=${String(b2.ssmSum).padStart(4)}`);
  }

  // Sample first 5 items
  console.log(`\n=== Sample first 5 items ===`);
  let n = 0;
  for await (const item of iterateBoardItems(Number(BOARD_ID), {
    itemFragment: `id name group { id title } column_values(ids: ["mirror9", "number_of_ssms"]) { id type ... on MirrorValue { display_value } ... on NumbersValue { number } }`,
  })) {
    n++;
    const m9 = (item.column_values.find((c) => c.id === "mirror9") as { display_value?: string } | undefined)?.display_value ?? "";
    const ssm = (item.column_values.find((c) => c.id === "number_of_ssms") as { number?: number | null } | undefined)?.number ?? null;
    console.log(`  [${item.id}] ${item.name}  (${(item as MondayItem & { group?: { title?: string } }).group?.title})  ssm=${ssm}  mirror9=[${m9}]`);
    if (n >= 5) break;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
