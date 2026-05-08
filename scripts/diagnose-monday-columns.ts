// Print all column metadata for the hotel + Assets boards.
import { mondayQuery } from "@/lib/monday/client";

const BOARDS = [
  { id: "1356570756", name: "Live Estate" },
  { id: "1743012104", name: "Ready to Launch" },
  { id: "5026387784", name: "Removed" },
  { id: "5092887865", name: "Australia DCM" },
  { id: "1426737864", name: "Assets" },
];

const Q = `query ($id: [ID!]) { boards(ids: $id) { name columns { id title type } } }`;

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");
  for (const b of BOARDS) {
    const data = await mondayQuery<{ boards: Array<{ name: string; columns: Array<{ id: string; title: string; type: string }> }> }>(Q, { id: [b.id] });
    const board = data.boards[0];
    console.log(`\n=== ${board.name} (${b.id}) — ${board.columns.length} columns ===`);
    for (const c of board.columns) {
      console.log(`  id=${c.id.padEnd(40)} type=${(c.type ?? "").padEnd(15)} title="${c.title}"`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
