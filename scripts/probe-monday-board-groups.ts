// One-shot probe — list groups on each Monday hotel board to confirm whether
// `group.title` encodes region. Plan B Task 2 hotel importer needs a stable
// board+item → primaryRegionId resolution; this probe answers that.
//
// Run with:
//   MONDAY_API_TOKEN=... npx tsx scripts/probe-monday-board-groups.ts

import { mondayQueryWithRetry } from "@/lib/monday/client";

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

async function main(): Promise<void> {
  if (!process.env.MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN not set");
  }

  for (const boardId of HOTEL_BOARD_IDS) {
    const query = `{
      boards(ids: [${boardId}]) {
        id
        name
        groups { id title color }
      }
    }`;
    const data = (await mondayQueryWithRetry<{
      boards: Array<{
        id: string;
        name: string;
        groups: Array<{ id: string; title: string; color: string }>;
      }>;
    }>(query, {})).boards[0];

    process.stdout.write(
      `\n=== Board ${boardId} (${BOARD_NAMES[boardId]}) — Monday name: "${data.name}" ===\n`,
    );
    for (const g of data.groups) {
      process.stdout.write(
        `  ${g.id.padEnd(28)}  ${g.title.padEnd(40)}  ${g.color}\n`,
      );
    }

    // Sample 3 items to see how items distribute across groups
    const itemsQuery = `{
      boards(ids: [${boardId}]) {
        items_page(limit: 3) {
          items { id name group { id title } }
        }
      }
    }`;
    const itemsData = (await mondayQueryWithRetry<{
      boards: Array<{
        items_page: {
          items: Array<{
            id: string;
            name: string;
            group: { id: string; title: string };
          }>;
        };
      }>;
    }>(itemsQuery, {})).boards[0].items_page.items;
    process.stdout.write("  --- sample items ---\n");
    for (const item of itemsData) {
      process.stdout.write(
        `  item=${item.id.padEnd(14)} name="${item.name.slice(0, 40)}" group="${item.group.title}"\n`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
