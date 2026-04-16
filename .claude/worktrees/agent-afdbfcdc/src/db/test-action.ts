import { config } from "dotenv";
config({ path: ".env.local" });

// Simulate what the server action does
import { db } from "./index";
import { kiosks, pipelineStages } from "./schema";
import { eq } from "drizzle-orm";

async function test() {
  // Get default stage
  const [defaultStage] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(eq(pipelineStages.isDefault, true))
    .limit(1);

  console.log("Default stage:", defaultStage?.id);

  try {
    const [newKiosk] = await db
      .insert(kiosks)
      .values({
        kioskId: "ACTION-TEST-001",
        outletCode: null,
        hardwareModel: null,
        hardwareSerialNumber: null,
        softwareVersion: null,
        cmsConfigStatus: null,
        installationDate: null,
        deploymentPhaseTags: [],
        maintenanceFee: null,
        freeTrialStatus: false,
        freeTrialEndDate: null,
        regionGroup: null,
        pipelineStageId: defaultStage?.id ?? null,
        notes: null,
      })
      .returning({ id: kiosks.id, kioskId: kiosks.kioskId });

    console.log("Success:", newKiosk);

    // Cleanup
    await db.delete(kiosks).where(eq(kiosks.id, newKiosk.id));
    console.log("Cleaned up");
  } catch (err) {
    console.error("FULL ERROR:", JSON.stringify(err, null, 2));
    if (err instanceof Error) {
      console.error("Message:", err.message);
      console.error("Cause:", (err as any).cause);
    }
  }

  process.exit(0);
}

test();
