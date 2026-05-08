import { db } from "@/db";
import { locations, products, providers, regions } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEMO_REGION = { name: "Demo", code: "DEMO" };

// Phase 07-06 — `outletCode` is gone from locations. Demo seed now stamps
// `customerCode` (the canonical hotel-level identifier) instead. The legacy
// shorthand "GRAND-001" / "CITY-002" was historically used as both a
// location identifier AND a kiosk identifier; here we keep the same string
// as the customer_code so existing dev workflows that look up by that value
// continue to work, but the column it lands in changed.
const DEMO_LOCATIONS = [
  { name: "The Grand Hotel", customerCode: "GRAND-001" },
  { name: "City Centre Inn", customerCode: "CITY-002" },
  { name: "Riverside Lodge", customerCode: "RIVER-003" },
  { name: "Airport Express Hotel", customerCode: "AIR-004" },
  { name: "Harbour View Suites", customerCode: "HARB-005" },
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
      .where(eq(locations.customerCode, loc.customerCode))
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
