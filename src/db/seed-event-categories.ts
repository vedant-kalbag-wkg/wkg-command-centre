import { db } from "@/db";
import { eventCategories } from "@/db/schema";
import { eq } from "drizzle-orm";

const CORE_CATEGORIES = [
  { name: "Promotion", color: "#00A6D3", isCore: true },
  { name: "Holiday", color: "#4BC8E8", isCore: true },
  { name: "Operational Change", color: "#121212", isCore: true },
  { name: "Market Event", color: "#006080", isCore: true },
];

async function seedEventCategories() {
  let count = 0;
  for (const cat of CORE_CATEGORIES) {
    const existing = await db
      .select({ id: eventCategories.id })
      .from(eventCategories)
      .where(eq(eventCategories.name, cat.name))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(eventCategories).values(cat);
      count++;
    }
  }

  console.log(
    `Event categories seed: ${count} categories inserted (skipped ${CORE_CATEGORIES.length - count} existing).`,
  );
}

seedEventCategories().catch(console.error);
