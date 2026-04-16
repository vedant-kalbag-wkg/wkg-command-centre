import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { kiosks, pipelineStages } from "./schema";
import { eq } from "drizzle-orm";

async function test() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  // Get default stage
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.isDefault, true)).limit(1);
  console.log("Default stage:", stage?.id, stage?.name);

  try {
    const [kiosk] = await db.insert(kiosks).values({
      kioskId: "TEST-INSERT-001",
      deploymentPhaseTags: [],
      freeTrialStatus: false,
      pipelineStageId: stage?.id ?? null,
    }).returning({ id: kiosks.id, kioskId: kiosks.kioskId });
    console.log("Inserted:", kiosk);

    // Clean up
    await db.delete(kiosks).where(eq(kiosks.id, kiosk.id));
    console.log("Cleaned up");
  } catch (err) {
    console.error("Error:", err);
  }

  await client.end();
}

test().catch(console.error);
