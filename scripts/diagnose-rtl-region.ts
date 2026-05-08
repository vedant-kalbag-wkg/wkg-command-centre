// Inspect the `location` column on Ready to Launch + Heathrow In Progress
// items to see if country is reliably populated. That's what we need to
// derive per-item region without a UK default.

import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";

async function main() {
  if (!process.env.MONDAY_API_TOKEN) throw new Error("MONDAY_API_TOKEN not set");

  for (const [boardId, label] of [[1743012104, "Ready to Launch"], [1356657751, "Heathrow Express SSMs"]] as const) {
    console.log(`\n=== ${label} (${boardId}) — location column probe ===`);
    for await (const item of iterateBoardItems(boardId, {
      itemFragment: `id name group { id title } column_values(ids: ["location", "country", "country__1"]) { id type text value }`,
    })) {
      const grp = (item as MondayItem & { group?: { title?: string } }).group?.title ?? "";
      // Skip groups that already resolve via existing patterns
      if (boardId === 1743012104 && /waiting to launch/i.test(grp)) continue;
      const cells = item.column_values
        .filter((c) => c.text || c.value)
        .map((c) => `${c.id}=${c.text ?? c.value?.slice(0, 80)}`)
        .join(" | ");
      console.log(`  [${item.id}] "${item.name}" (${grp})  ${cells || "(no values)"}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
