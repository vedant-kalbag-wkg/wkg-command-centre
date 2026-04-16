import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pipelineStages } from "./schema";
import { eq, count } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const DEFAULT_STAGES = [
  { name: "Prospect", position: 1000, color: "#00A6D3", isDefault: true },
  { name: "On Hold", position: 2000, color: "#575A5C", isDefault: false },
  { name: "Delivered to Region", position: 3000, color: "#0087AA", isDefault: false },
  { name: "Awaiting Configuration", position: 4000, color: "#F4BA1E", isDefault: false },
  { name: "Configured", position: 5000, color: "#68D871", isDefault: false },
  { name: "Ready to Launch", position: 6000, color: "#00A6D3", isDefault: false },
  { name: "Live", position: 7000, color: "#00C48C", isDefault: false },
  { name: "Offline", position: 8000, color: "#F41E56", isDefault: false },
  { name: "Decommissioned", position: 9000, color: "#ADADAD", isDefault: false },
];

async function seedPipelineStages() {
  const [result] = await db.select({ count: count() }).from(pipelineStages);
  const existing = Number(result.count);

  if (existing > 0) {
    console.log(`Pipeline stages already seeded (${existing} rows). Skipping.`);
    await client.end();
    return;
  }

  await db.insert(pipelineStages).values(
    DEFAULT_STAGES.map((stage) => ({
      name: stage.name,
      position: stage.position,
      color: stage.color,
      isDefault: stage.isDefault,
    }))
  );

  console.log(`Seeded ${DEFAULT_STAGES.length} pipeline stages successfully.`);
  await client.end();
}

seedPipelineStages().catch((err) => {
  console.error("Error seeding pipeline stages:", err);
  process.exit(1);
});
