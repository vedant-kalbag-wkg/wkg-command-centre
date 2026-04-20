/**
 * Schema-drift guard for Monday.com imports.
 *
 * Each import script declares the column IDs it depends on for a given board
 * and calls `assertBoardColumns` before iterating items. If Monday has
 * renamed, removed, or otherwise lost any of the declared columns, the
 * script fails loudly with a structured error listing every gap.
 *
 * This catches the class of failure that hid behind commit 72a80bd, where a
 * non-existent column ID was silently read as null for every row.
 */

export type MondayQueryFn = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Columns read by `scripts/import-from-monday.ts` from the Assets board
 * (MONDAY_BOARD_ID, currently 1426737864). Item.name is used as the asset id
 * and is a top-level field (not a column), so it is not listed here.
 */
export const ASSETS_BOARD_COLUMNS: string[] = [
  "outlet_code1", // text  — Outlet Code
  "label3", // status — Make/Model
  "status_1", // status — Config Status
  "color", // status — Current Location
  "text9", // text   — Cust_cd
  "text3", // text   — ADN
  "label", // status — Network
  "label9", // status — Condition
  "label93", // status — Age
  "checkbox2", // checkbox — SSM Config
  "checkbox8", // checkbox — PDQ Config
  "checkbox0", // checkbox — DB Config
  "checkbox", // checkbox — Pick up GeoCode
  "checkbox1__1", // checkbox — SSM24 Ready
];

/**
 * Columns read by `scripts/enrich-locations-from-monday.ts` from every one
 * of the four hotel boards (Live Estate, Ready to Launch, Removed, Australia
 * DCM). Item.name is used as the hotel name and is not listed.
 *
 * Columns that only exist on the Live Estate board (e.g. `live_date`, the
 * region status) are declared separately as `HOTEL_LIVE_ONLY_COLUMNS` and
 * only enforced for that board, because Ready to Launch / Removed don't
 * carry those lifecycle fields and the enrich code handles their absence
 * gracefully via null-safe `getText()`.
 */
export const HOTEL_BOARD_CORE_COLUMNS: string[] = [
  "mirror9", // mirror        — Outlet Code (mirrored from Assets)
  "number_of_rooms", // numbers       — Hotel's Number of Rooms
  "rating__1", // rating        — Hotel Star Rating
  "link_to_ssm_groups__1", // board_relation — SSM Group
  "group0", // dropdown      — Hotel Group
  "status", // status        — Status
  "key_contact_name", // text          — Key Contact Name
  "key_contact_email", // email         — Key Contact Email
  "finance_contact1", // text          — Finance Contact
  "numbers__1", // numbers       — Maintenance Fee (ex VAT)
  "date9", // date          — Free Trial End Date
  "location", // location      — Hotel Address
  "status_11", // status        — Location Group
  "label8__1", // status        — Sourced by
  "long_text__1", // long_text     — Notes
];

/**
 * Additional columns that exist only on the Live Estate board. Enforced only
 * there — other hotel boards may not carry them because they describe live
 * operations.
 */
export const HOTEL_LIVE_ONLY_COLUMNS: string[] = [
  "status_17", // status — Launch Phase
  "live_date", // date   — Live Date
  "color_mkttv13g", // status — Region
];

interface ColumnMeta {
  id: string;
  type: string;
  title: string;
}

interface BoardsResponse {
  boards: { id: string; name: string; columns: ColumnMeta[] }[];
}

async function fetchBoardColumns(
  mondayQuery: MondayQueryFn,
  boardId: number | string,
): Promise<{ name: string; id: string; columns: ColumnMeta[] }> {
  const data = (await mondayQuery(
    `query { boards(ids: [${boardId}]) { id name columns { id type title } } }`,
  )) as BoardsResponse;
  const board = data?.boards?.[0];
  if (!board) {
    throw new Error(
      `[SCHEMA-GUARD] board ${boardId} not found — check board id / access token`,
    );
  }
  return board;
}

/**
 * Strict check: throws if any expected column is missing. Use on boards
 * whose schema is load-bearing (Assets, Live Estate) — silent drift there
 * corrupts the whole import run.
 */
export async function assertBoardColumns(
  mondayQuery: MondayQueryFn,
  boardId: number | string,
  expected: string[],
  boardLabel: string,
): Promise<void> {
  const board = await fetchBoardColumns(mondayQuery, boardId);
  const actual = new Set(board.columns.map((c) => c.id));
  const missing = expected.filter((id) => !actual.has(id));

  if (missing.length > 0) {
    const preview = board.columns
      .slice(0, 40)
      .map((c) => `${c.id}:${c.type}:"${c.title}"`)
      .join("\n    ");
    throw new Error(
      `[SCHEMA-GUARD] board "${board.name}" (${board.id}, ${boardLabel}) is missing ${missing.length} expected column(s):\n  missing: ${missing.join(", ")}\n  present (first 40):\n    ${preview}\n`,
    );
  }

  console.log(
    `[SCHEMA-GUARD] ${boardLabel} (${board.name}, ${board.id}): ${expected.length}/${expected.length} columns present`,
  );
}

/**
 * Lenient check: logs a structured warning for any missing column but does
 * not throw. Use on accessory boards (Ready to Launch, Removed, Australia
 * DCM) whose schemas legitimately drift from Live Estate's — we want to
 * know when a column disappears, but the script still reads what it can
 * via null-safe `getText()`.
 */
export async function warnBoardColumns(
  mondayQuery: MondayQueryFn,
  boardId: number | string,
  expected: string[],
  boardLabel: string,
): Promise<void> {
  const board = await fetchBoardColumns(mondayQuery, boardId);
  const actual = new Set(board.columns.map((c) => c.id));
  const missing = expected.filter((id) => !actual.has(id));

  if (missing.length > 0) {
    console.warn(
      `[SCHEMA-GUARD] board "${board.name}" (${board.id}, ${boardLabel}) is missing ${missing.length} column(s) — proceeding with nulls: ${missing.join(", ")}`,
    );
  } else {
    console.log(
      `[SCHEMA-GUARD] ${boardLabel} (${board.name}, ${board.id}): ${expected.length}/${expected.length} columns present`,
    );
  }
}
