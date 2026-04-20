/**
 * Read-only check: verify that the Live Estate board's
 * link_to_ssm_groups__1 column is readable via BoardRelationValue
 * display_value / text, and report how many hotels currently have a
 * group linked.
 *
 * Run: npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/check-ssm-group-links.ts
 *
 * No DB writes, no Monday writes. Purely diagnostic.
 */

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN");
  process.exit(1);
}

const LIVE_ESTATE_BOARD_ID = 1356570756;

async function monday<T>(query: string): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_TOKEN as string,
      "Content-Type": "application/json",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`Monday error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

type Shape = {
  boards: {
    items_page: {
      cursor: string | null;
      items: {
        id: string;
        name: string;
        column_values: {
          id: string;
          text: string | null;
          display_value?: string | null;
        }[];
      }[];
    };
  }[];
};

async function main() {
  let cursor: string | null = null;
  let firstPage = true;
  let total = 0;
  let linked = 0;
  const sampleLinks: { hotel: string; group: string }[] = [];

  const columnFragment = `
    column_values(ids: ["link_to_ssm_groups__1"]) {
      id text
      ... on BoardRelationValue { display_value }
    }
  `;

  while (true) {
    const q = firstPage
      ? `{ boards(ids: [${LIVE_ESTATE_BOARD_ID}]) { items_page(limit: 500) { cursor items { id name ${columnFragment} } } } }`
      : `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name ${columnFragment} } } }`;
    const data = await monday<Shape | { next_items_page: Shape["boards"][number]["items_page"] }>(q);
    const page = firstPage
      ? (data as Shape).boards[0].items_page
      : (data as { next_items_page: Shape["boards"][number]["items_page"] }).next_items_page;
    for (const item of page.items) {
      total++;
      const cv = item.column_values.find((c) => c.id === "link_to_ssm_groups__1");
      const text = cv?.text?.trim() || cv?.display_value?.trim() || null;
      if (text) {
        linked++;
        if (sampleLinks.length < 5) {
          sampleLinks.push({ hotel: item.name, group: text });
        }
      }
    }
    if (!page.cursor || page.items.length === 0) break;
    firstPage = false;
    cursor = page.cursor;
  }

  console.log(`Total hotels on Live Estate: ${total}`);
  console.log(`Hotels with link_to_ssm_groups__1 populated: ${linked}`);
  console.log(`Hotels with no group linked: ${total - linked}`);
  if (sampleLinks.length > 0) {
    console.log(`\nSample hotel → group pairs:`);
    for (const s of sampleLinks) {
      console.log(`  ${s.hotel}  →  ${s.group}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
