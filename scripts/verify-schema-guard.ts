import {
  ASSETS_BOARD_COLUMNS,
  HOTEL_BOARD_CORE_COLUMNS,
  HOTEL_LIVE_ONLY_COLUMNS,
  assertBoardColumns,
  warnBoardColumns,
  type MondayQueryFn,
} from "./monday-schema";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN");
  process.exit(1);
}

const mondayQuery: MondayQueryFn = async (query) => {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_TOKEN as string,
      "Content-Type": "application/json",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: unknown; errors?: unknown };
  if (!json.data) throw new Error(`Monday error: ${JSON.stringify(json.errors)}`);
  return json.data;
};

async function main() {
  await assertBoardColumns(mondayQuery, 1426737864, ASSETS_BOARD_COLUMNS, "Assets");
  await assertBoardColumns(
    mondayQuery,
    1356570756,
    [...HOTEL_BOARD_CORE_COLUMNS, ...HOTEL_LIVE_ONLY_COLUMNS],
    "Live Estate",
  );
  // Sibling hotel boards — warn-only, since they carry partial schemas by design.
  await warnBoardColumns(mondayQuery, 1743012104, HOTEL_BOARD_CORE_COLUMNS, "Ready to Launch");
  await warnBoardColumns(mondayQuery, 5026387784, HOTEL_BOARD_CORE_COLUMNS, "Removed");
  await warnBoardColumns(mondayQuery, 5092887865, HOTEL_BOARD_CORE_COLUMNS, "Australia DCM");
  console.log("\nAll strict schema guards passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
