import { db } from "@/db";
import { locations, products, providers, regions } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEMO_REGION = { name: "Demo", code: "DEMO" };

const DEMO_LOCATIONS = [
  { name: "The Grand Hotel", outletCode: "GRAND-001" },
  { name: "City Centre Inn", outletCode: "CITY-002" },
  { name: "Riverside Lodge", outletCode: "RIVER-003" },
  { name: "Airport Express Hotel", outletCode: "AIR-004" },
  { name: "Harbour View Suites", outletCode: "HARB-005" },
];

const DEMO_PRODUCTS = [
  "London Eye",
  "Tower of London",
  "Shard View",
  "Thames River Cruise",
  "Windsor Castle",
  "Kew Gardens",
];

const DEMO_PROVIDERS = [
  "AttractionsCo",
  "SkyCo",
  "River Tours Ltd",
];

async function seedSalesDemo() {
  // Regions became required on locations in migration 0022 (primaryRegionId
  // NOT NULL). Ensure a demo region exists and attach all seeded locations.
  let [demoRegion] = await db
    .select({ id: regions.id })
    .from(regions)
    .where(eq(regions.code, DEMO_REGION.code))
    .limit(1);
  if (!demoRegion) {
    [demoRegion] = await db
      .insert(regions)
      .values(DEMO_REGION)
      .returning({ id: regions.id });
  }

  let locCount = 0;
  for (const loc of DEMO_LOCATIONS) {
    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.outletCode, loc.outletCode))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(locations).values({ ...loc, primaryRegionId: demoRegion.id });
      locCount++;
    }
  }

  let prodCount = 0;
  for (const name of DEMO_PRODUCTS) {
    const existing = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, name))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(products).values({ name });
      prodCount++;
    }
  }

  let provCount = 0;
  for (const name of DEMO_PROVIDERS) {
    const existing = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.name, name))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(providers).values({ name });
      provCount++;
    }
  }

  console.log(
    `Sales demo seed: ${locCount} locations, ${prodCount} products, ${provCount} providers (skipped existing).`,
  );
}

seedSalesDemo().catch(console.error);
