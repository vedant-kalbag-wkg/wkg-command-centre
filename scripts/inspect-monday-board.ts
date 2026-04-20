/**
 * Inspect a Monday.com board's column structure.
 *
 * Prints every column's id / title / type for a given board, plus the first
 * few items so you can see what the data looks like. Useful when figuring out
 * which column holds what before wiring an import.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/inspect-monday-board.ts <boardId>
 */

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN in .env.local");
  process.exit(1);
}

const boardId = process.argv[2];
if (!boardId) {
  console.error("Usage: tsx scripts/inspect-monday-board.ts <boardId>");
  process.exit(1);
}

async function monday<T>(query: string): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_TOKEN as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) {
    throw new Error(`Monday error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

type BoardMeta = {
  boards: {
    id: string;
    name: string;
    columns: { id: string; title: string; type: string }[];
    items_page: {
      items: {
        id: string;
        name: string;
        column_values: { id: string; text: string | null; value: string | null }[];
      }[];
    };
  }[];
};

async function main() {
  const data = await monday<BoardMeta>(`
    query {
      boards(ids: [${boardId}]) {
        id
        name
        columns { id title type }
        items_page(limit: 3) {
          items {
            id
            name
            column_values { id text value }
          }
        }
      }
    }
  `);

  const board = data.boards?.[0];
  if (!board) {
    console.error(`No board found for id ${boardId}`);
    process.exit(1);
  }

  console.log(`\nBoard: ${board.name} (id ${board.id})`);
  console.log(`\nColumns:`);
  console.log(`${"id".padEnd(24)}  ${"type".padEnd(18)}  title`);
  console.log("-".repeat(80));
  for (const col of board.columns) {
    console.log(`${col.id.padEnd(24)}  ${col.type.padEnd(18)}  ${col.title}`);
  }

  console.log(`\nFirst ${board.items_page.items.length} items (sample data):\n`);
  for (const item of board.items_page.items) {
    console.log(`• ${item.name}  (id ${item.id})`);
    for (const cv of item.column_values) {
      if (cv.text || cv.value) {
        const v = cv.text ?? cv.value;
        const preview = v && v.length > 80 ? `${v.slice(0, 77)}...` : v;
        console.log(`    ${cv.id.padEnd(22)}  ${preview}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
