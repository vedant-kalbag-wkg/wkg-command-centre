import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq } from "drizzle-orm";

const MARKETS = [
  { name: "UK & Ireland", code: "UKI" },
  { name: "Continental Europe", code: "CEU" },
  { name: "Middle East", code: "ME" },
  { name: "Asia Pacific", code: "APAC" },
  { name: "Americas", code: "AM" },
];

async function seedMarkets() {
  let count = 0;
  for (const market of MARKETS) {
    const existing = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.name, market.name))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(markets).values(market);
      count++;
    }
  }

  console.log(
    `Markets seed: ${count} markets inserted (skipped ${MARKETS.length - count} existing).`,
  );
}

seedMarkets().catch(console.error);
