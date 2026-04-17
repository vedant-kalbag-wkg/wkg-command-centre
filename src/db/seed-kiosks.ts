import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { kiosks, pipelineStages, locations, kioskAssignments } from "./schema";
import { eq, count } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

/**
 * Seed kiosks with varied pipeline stages, regions, and assignment states.
 * Idempotent: skips if kiosks already exist.
 * Depends on: seed-pipeline-stages (pipeline stages) and seed-sales-demo (locations).
 */
async function seedKiosks() {
  // Idempotent guard
  const [result] = await db.select({ count: count() }).from(kiosks);
  const existing = Number(result.count);

  if (existing > 0) {
    console.log(`Kiosks already seeded (${existing} rows). Skipping.`);
    await client.end();
    return;
  }

  // Look up pipeline stages by name (never hardcode UUIDs)
  const stages = await db
    .select({ id: pipelineStages.id, name: pipelineStages.name })
    .from(pipelineStages);

  if (stages.length === 0) {
    console.error(
      "No pipeline stages found. Run seed-pipeline-stages first.",
    );
    await client.end();
    process.exit(1);
  }

  const stageMap = new Map(stages.map((s) => [s.name, s.id]));

  function stageId(name: string): string {
    const id = stageMap.get(name);
    if (!id) throw new Error(`Pipeline stage "${name}" not found`);
    return id;
  }

  // Look up locations by outlet code (seeded by seed-sales-demo)
  const locs = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations);

  const locMap = new Map(
    locs.filter((l) => l.outletCode).map((l) => [l.outletCode!, l.id]),
  );

  // Define kiosk seed data
  const SEED_KIOSKS = [
    {
      kioskId: "KSK-001",
      hardwareModel: "Kiosk Pro 22",
      hardwareSerialNumber: "SN-KP22-0001",
      softwareVersion: "3.2.1",
      regionGroup: "London",
      pipelineStage: "Prospect",
      outletCode: "GRAND-001", // assigned
      notes: "Initial prospect for Grand Hotel lobby",
    },
    {
      kioskId: "KSK-002",
      hardwareModel: "Kiosk Pro 22",
      hardwareSerialNumber: "SN-KP22-0002",
      softwareVersion: "3.2.1",
      regionGroup: "London",
      pipelineStage: "Live",
      outletCode: "CITY-002", // assigned
      notes: "Live in City Centre Inn reception",
    },
    {
      kioskId: "KSK-003",
      hardwareModel: "Kiosk Lite 15",
      hardwareSerialNumber: "SN-KL15-0003",
      softwareVersion: "3.1.0",
      regionGroup: "Manchester",
      pipelineStage: "Awaiting Configuration",
      outletCode: "RIVER-003", // assigned
      notes: "Delivered, pending CMS config",
    },
    {
      kioskId: "KSK-004",
      hardwareModel: "Kiosk Lite 15",
      hardwareSerialNumber: "SN-KL15-0004",
      softwareVersion: "3.2.1",
      regionGroup: "Manchester",
      pipelineStage: "Configured",
      outletCode: null, // unassigned
      notes: "Configured but not yet assigned to a location",
    },
    {
      kioskId: "KSK-005",
      hardwareModel: "Kiosk Pro 22",
      hardwareSerialNumber: "SN-KP22-0005",
      softwareVersion: "3.0.0",
      regionGroup: "Edinburgh",
      pipelineStage: "Offline",
      outletCode: "AIR-004", // assigned
      notes: "Taken offline for hardware repair",
    },
    {
      kioskId: "KSK-006",
      hardwareModel: "Kiosk Max 32",
      hardwareSerialNumber: "SN-KM32-0006",
      softwareVersion: "3.2.1",
      regionGroup: "Edinburgh",
      pipelineStage: "Ready to Launch",
      outletCode: null, // unassigned
      notes: "Ready but awaiting location assignment",
    },
    {
      kioskId: "KSK-007",
      hardwareModel: "Kiosk Max 32",
      hardwareSerialNumber: "SN-KM32-0007",
      softwareVersion: "3.2.1",
      regionGroup: "Bristol",
      pipelineStage: "Delivered to Region",
      outletCode: "HARB-005", // assigned
      notes: "Delivered to Harbour View Suites",
    },
    {
      kioskId: "KSK-008",
      hardwareModel: "Kiosk Pro 22",
      hardwareSerialNumber: "SN-KP22-0008",
      softwareVersion: "2.9.0",
      regionGroup: "Bristol",
      pipelineStage: "Decommissioned",
      outletCode: null, // unassigned
      notes: "End-of-life unit, replaced by KSK-007",
    },
  ];

  // Insert kiosks
  const insertedKiosks = await db
    .insert(kiosks)
    .values(
      SEED_KIOSKS.map((k) => ({
        kioskId: k.kioskId,
        hardwareModel: k.hardwareModel,
        hardwareSerialNumber: k.hardwareSerialNumber,
        softwareVersion: k.softwareVersion,
        regionGroup: k.regionGroup,
        pipelineStageId: stageId(k.pipelineStage),
        outletCode: k.outletCode,
        notes: k.notes,
      })),
    )
    .returning({ id: kiosks.id, kioskId: kiosks.kioskId, outletCode: kiosks.outletCode });

  console.log(`Seeded ${insertedKiosks.length} kiosks.`);

  // Create assignments for kiosks linked to locations
  let assignmentCount = 0;
  for (const kiosk of insertedKiosks) {
    if (!kiosk.outletCode) continue;
    const locationId = locMap.get(kiosk.outletCode);
    if (!locationId) {
      console.warn(
        `Location for outlet code "${kiosk.outletCode}" not found — skipping assignment for ${kiosk.kioskId}.`,
      );
      continue;
    }

    await db.insert(kioskAssignments).values({
      kioskId: kiosk.id,
      locationId,
      assignedBy: "system",
      assignedByName: "Seed Script",
      reason: "Initial seed assignment",
    });
    assignmentCount++;
  }

  console.log(`Created ${assignmentCount} kiosk assignments.`);
  await client.end();
}

seedKiosks().catch((err) => {
  console.error("Error seeding kiosks:", err);
  process.exit(1);
});
