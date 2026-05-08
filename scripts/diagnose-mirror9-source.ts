// Inspect the `mirror9` column's `settings_str` on hotel boards to find
// what board+column it mirrors from. Then probe a few of the gap hotels
// to see if the upstream has codes that Assets is missing.

import { mondayQuery, iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const HOTEL_BOARDS = ["1356570756", "1743012104", "5026387784", "5092887865"];

const COL_Q = `query ($id: [ID!]) { boards(ids: $id) { id name columns { id title type settings_str } } }`;

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  // 1. Find mirror9's settings on each hotel board
  for (const id of HOTEL_BOARDS) {
    const data = await mondayQuery<{ boards: Array<{ name: string; columns: Array<{ id: string; title: string; type: string; settings_str: string }> }> }>(COL_Q, { id: [id] });
    const board = data.boards[0];
    const m9 = board.columns.find((c) => c.id === "mirror9");
    if (!m9) { console.log(`${board.name}: no mirror9`); continue; }
    console.log(`\n=== ${board.name} (${id}) — mirror9 ===`);
    console.log(`  title : ${m9.title}`);
    console.log(`  settings_str:`);
    try {
      const settings = JSON.parse(m9.settings_str);
      console.log(JSON.stringify(settings, null, 2));
    } catch {
      console.log(`  ${m9.settings_str}`);
    }
  }

  // 2. Also inspect link_to_ssm_groups__1 settings — where does that point?
  console.log(`\n=== Live Estate — link_to_ssm_groups__1 (board_relation) ===`);
  const data = await mondayQuery<{ boards: Array<{ columns: Array<{ id: string; title: string; type: string; settings_str: string }> }> }>(COL_Q, { id: ["1356570756"] });
  const link = data.boards[0].columns.find((c) => c.id === "link_to_ssm_groups__1");
  if (link) {
    try { console.log(JSON.stringify(JSON.parse(link.settings_str), null, 2)); }
    catch { console.log(link.settings_str); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
