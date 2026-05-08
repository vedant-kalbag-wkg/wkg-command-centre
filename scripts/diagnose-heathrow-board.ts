// Dump all items on the Heathrow Express SSMs board with their relevant
// columns. Used to figure out integration shape vs the other hotel boards.

import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const FRAGMENT = `
  id name
  group { id title }
  column_values(ids: ["outlet_code1", "number_of_ssms", "status", "live_date", "category1", "text4", "text2"]) {
    id type text value
    ... on NumbersValue { number }
    ... on StatusValue { label }
    ... on DateValue { date }
  }
`;

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");
  type Row = {
    id: string;
    name: string;
    group: string;
    outletCode: string | null;
    numberOfSsms: number;
    status: string | null;
    liveDate: string | null;
    category: string | null;
    custCd: string | null;
    ssmAssigned: string | null;
  };
  const items: Row[] = [];
  for await (const item of iterateBoardItems(1356657751, { itemFragment: FRAGMENT })) {
    const get = (id: string) => item.column_values.find((c) => c.id === id) as
      | (typeof item.column_values[number] & { number?: number | null; label?: string; date?: string })
      | undefined;
    items.push({
      id: item.id,
      name: item.name,
      group: (item as MondayItem & { group?: { title?: string } }).group?.title ?? "",
      outletCode: get("outlet_code1")?.text?.trim() || null,
      numberOfSsms: (get("number_of_ssms")?.number as number | null | undefined) ?? 0,
      status: get("status")?.label ?? null,
      liveDate: get("live_date")?.date ?? null,
      category: get("category1")?.text ?? null,
      custCd: get("text4")?.text ?? null,
      ssmAssigned: get("text2")?.text ?? null,
    });
  }
  console.log("All 12 items on Heathrow Express SSMs (board 1356657751):\n");
  for (const i of items) {
    console.log(`  [${i.id}] ${i.name.padEnd(45)}  group=${i.group.padEnd(14)} ssm=${i.numberOfSsms} outlet=${(i.outletCode ?? "(empty)").padEnd(14)} status=${i.status ?? ""}  custCd=${i.custCd ?? ""}  liveDate=${i.liveDate ?? ""}`);
  }
  const ssmSum = items.reduce((s, i) => s + i.numberOfSsms, 0);
  const liveItems = items.filter((i) => i.group.toLowerCase().includes("live"));
  const liveSsm = liveItems.reduce((s, i) => s + i.numberOfSsms, 0);
  const codesSeen = [...new Set(items.flatMap((i) => (i.outletCode ?? "").split(",").map((s) => s.trim()).filter(Boolean)))].sort();
  console.log(`\nTotal items     : ${items.length}`);
  console.log(`Σ Number of SSMs: ${ssmSum}`);
  console.log(`Σ in Live group : ${liveSsm}`);
  console.log(`With outlet_code1: ${items.filter((i) => i.outletCode).length}`);
  console.log(`Distinct outlet codes seen: [${codesSeen.join(", ")}]`);
}

main().catch((e) => { console.error(e); process.exit(1); });
