// Find the "Number of SSMs" column on each hotel board, sum it across
// items, and compare against imported `kiosks` table state.

import { mondayQuery, iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const HOTEL_BOARDS = [
  { id: 1356570756, name: "Live Estate" },
  { id: 1743012104, name: "Ready to Launch" },
  { id: 5026387784, name: "Removed" },
  { id: 5092887865, name: "Australia DCM" },
];

type ColumnMeta = { id: string; title: string; type: string };

async function getColumns(boardId: number): Promise<ColumnMeta[]> {
  const q = `query ($id: [ID!]) { boards(ids: $id) { columns { id title type } } }`;
  const data = await mondayQuery<{ boards: Array<{ columns: ColumnMeta[] }> }>(q, { id: [String(boardId)] });
  return data.boards[0]?.columns ?? [];
}

function findSsmColumn(cols: ColumnMeta[]): ColumnMeta | undefined {
  // Match titles like "Number of SSMs", "# SSMs", "SSMs", "No. of SSMs", etc.
  const re = /(number\s*of\s*ssm|#\s*ssm|no\.?\s*of\s*ssm|^\s*ssms?\s*$)/i;
  return cols.find((c) => re.test(c.title));
}

async function inspectBoard(boardId: number, name: string) {
  const cols = await getColumns(boardId);
  const ssmCol = findSsmColumn(cols);
  console.log(`\n=== ${name} (${boardId}) ===`);
  if (!ssmCol) {
    console.log(`  No "Number of SSMs"-like column found.`);
    console.log(`  All columns: ${cols.map((c) => `${c.title}[${c.type}]`).join(", ")}`);
    return { boardId, name, ssmCol: null, sum: 0, nonZeroItems: 0, totalItems: 0 };
  }
  console.log(`  Found column "${ssmCol.title}" id=${ssmCol.id} type=${ssmCol.type}`);

  const fragment = `
    id name
    group { id title }
    column_values(ids: ["${ssmCol.id}", "mirror9"]) {
      id type text value
      ... on MirrorValue { display_value }
      ... on NumbersValue { number }
    }
  `;

  let sum = 0;
  let nonZero = 0;
  let total = 0;
  const perGroup: Record<string, { items: number; sum: number }> = {};
  const samples: Array<{ id: string; name: string; group: string; ssm: number; mirror9: string }> = [];

  for await (const item of iterateBoardItems(boardId, { itemFragment: fragment })) {
    total++;
    const groupTitle = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "(none)";
    const cv = item.column_values.find((c) => c.id === ssmCol.id) as
      | (typeof item.column_values[number] & { number?: number | null; display_value?: string })
      | undefined;
    let n: number | null = null;
    if (cv?.number !== null && cv?.number !== undefined) n = cv.number as number;
    else if (cv?.display_value) {
      const parsed = Number.parseInt(cv.display_value, 10);
      n = Number.isFinite(parsed) ? parsed : null;
    } else if (cv?.text) {
      const parsed = Number.parseInt(cv.text, 10);
      n = Number.isFinite(parsed) ? parsed : null;
    }
    const ssm = n ?? 0;
    sum += ssm;
    if (ssm > 0) nonZero++;
    if (!perGroup[groupTitle]) perGroup[groupTitle] = { items: 0, sum: 0 };
    perGroup[groupTitle].items++;
    perGroup[groupTitle].sum += ssm;

    const mirrorCv = item.column_values.find((c) => c.id === "mirror9") as
      | (typeof item.column_values[number] & { display_value?: string })
      | undefined;
    const mirror9 = mirrorCv?.display_value?.trim() ?? "";
    if (samples.length < 8 && ssm > 0) {
      samples.push({ id: item.id, name: item.name, group: groupTitle, ssm, mirror9 });
    }
  }

  console.log(`  Total items: ${total}`);
  console.log(`  Items with SSM>0: ${nonZero}`);
  console.log(`  Sum of "Number of SSMs": ${sum}`);
  console.log(`  Per-group breakdown:`);
  for (const [g, b] of Object.entries(perGroup).sort()) {
    console.log(`    ${g.padEnd(45)} items=${String(b.items).padStart(4)} ssm-sum=${String(b.sum).padStart(4)}`);
  }
  console.log(`  Sample items (first 8 with SSM>0):`);
  for (const s of samples) {
    console.log(`    [${s.id}] ${s.name}  (${s.group})  SSM=${s.ssm}  mirror9=[${s.mirror9}]`);
  }
  return { boardId, name, ssmCol, sum, nonZeroItems: nonZero, totalItems: total };
}

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  let grandSum = 0;
  for (const b of HOTEL_BOARDS) {
    const r = await inspectBoard(b.id, b.name);
    grandSum += r.sum;
  }
  console.log(`\n=== TOTAL "Number of SSMs" across all hotel boards: ${grandSum} ===`);
}

main().catch((e) => { console.error(e); process.exit(1); });
