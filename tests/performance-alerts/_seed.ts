/**
 * Shared seed helper for performance-alert integration tests (hotel-level).
 *
 * Inserts H1–H10 synthetic hotel fixtures in FK order:
 *   regions → pipelineStages → products → user → appSettings
 *   → locations → kiosks → kioskAssignments → salesRecords
 *
 * Composite-score fixtures (with default thresholds top:80 / mid:50 / bottom:20):
 *   H1–H3 land in Emerging tier (bottom 20% of composite)
 *   H4–H7 land in Developing tier
 *   H8–H10 land in Standard tier
 *
 *   (No Premium fixtures — composite caps below 65 with the constant-txn-per-hotel
 *    pattern; Premium is exercised by analytics tests separately.)
 *
 * H1 deliberately has internalPocId = NULL on the location row (tests
 * null-poc-skip path). H2–H5, H9, H10 share POC user poc-user-001.
 * H6–H8 share POC user poc-user-002.
 *
 * The live pipeline stage id is inserted into `app_settings` as
 * "pipeline_stage_id_live" so classifyEligibleLocations() resolves it.
 * "underperformance_window_days" is set to 365 so all fixtures fall within window.
 *
 * Maturity gate: kiosk_assignments.assigned_at is forced to 100 days ago so
 * every hotel passes the >=90-day maturity filter in classifyEligibleLocations.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  regions,
  pipelineStages,
  products,
  user,
  appSettings,
  locations,
  kiosks,
  kioskAssignments,
  salesRecords,
} from "@/db/schema";

// Stable IDs for cross-test references
export const REGION_ID = "a0000000-0000-0000-0000-000000000001";
export const LIVE_STAGE_ID = "b0000000-0000-0000-0000-000000000001";
export const PRODUCT_ID = "c0000000-0000-0000-0000-000000000001";
export const POC_USER_1_ID = "poc-user-001";
export const POC_USER_2_ID = "poc-user-002";

// Location IDs (one per hotel). UUID first segment must be exactly 8 hex
// chars — pad the index to 7 chars with a leading literal 'd'.
export const LOCATION_IDS = Array.from({ length: 10 }, (_, i) =>
  `d${String(i + 1).padStart(7, "0")}-0000-0000-0000-000000000001`,
);

// Kiosk IDs — one kiosk per hotel for clarity. Seeded so the cron's
// has_live_kiosk filter passes.
export const KIOSK_IDS = Array.from({ length: 10 }, (_, i) =>
  `e${String(i + 1).padStart(7, "0")}-0000-0000-0000-000000000001`,
);

// Revenue per hotel — drives composite-score tier classification.
// With 10 hotels and a single sales_record per hotel, revenue percentile
// dominates composite (transactions and txn/kiosk are equal across hotels,
// so they collapse to percentile=0 for all and contribute uniformly).
const REVENUES: Record<number, number> = {
  1: 100,
  2: 200,
  3: 300,
  4: 400,
  5: 500,
  6: 600,
  7: 700,
  8: 800,
  9: 900,
  10: 1000,
};

// numRooms per hotel — varied so revenuePerRoom is computable (and not null)
// for every hotel in the cohort. Monotonic with revenue → revenuePerRoom
// rank tracks revenue rank, no need to model it independently.
const NUM_ROOMS: Record<number, number> = {
  1: 60,
  2: 70,
  3: 80,
  4: 90,
  5: 100,
  6: 110,
  7: 120,
  8: 130,
  9: 140,
  10: 150,
};

// internalPocId per hotel — written to LOCATIONS (not kiosks) since the
// hotel-level rewrite. H1 has NULL → exercises the null-poc-skip path.
const POC_IDS: Record<number, string | null> = {
  1: null,           // H1 — null POC, lowest revenue → always lands in Emerging
  2: POC_USER_1_ID,
  3: POC_USER_1_ID,
  4: POC_USER_1_ID,
  5: POC_USER_1_ID,
  6: POC_USER_2_ID,
  7: POC_USER_2_ID,
  8: POC_USER_2_ID,
  9: POC_USER_1_ID,
  10: POC_USER_1_ID,
};

const HUNDRED_DAYS_MS = 100 * 24 * 60 * 60 * 1000;

export async function seedFixtures(pool: Pool): Promise<void> {
  const db = drizzle(pool);

  // 1. Region — test-specific code ("TS") that does not collide with
  //    canonical regions seeded by migration 0022/0025.
  await db.insert(regions).values({
    id: REGION_ID,
    name: "Test Region",
    code: "TS",
  }).onConflictDoNothing();

  // 2. Live pipeline stage
  await db.insert(pipelineStages).values({
    id: LIVE_STAGE_ID,
    name: "Live",
    position: 1.0,
    isDefault: false,
  }).onConflictDoNothing();

  // 3. Product (required FK on sales_records)
  await db.insert(products).values({
    id: PRODUCT_ID,
    name: "Test Product",
    netsuiteCode: "TEST-001",
  }).onConflictDoNothing();

  // 4. POC users
  await db.insert(user).values([
    {
      id: POC_USER_1_ID,
      name: "POC One",
      email: "poc-one@test.example",
      emailVerified: false,
      userType: "internal",
    },
    {
      id: POC_USER_2_ID,
      name: "POC Two",
      email: "poc-two@test.example",
      emailVerified: false,
      userType: "internal",
    },
  ]).onConflictDoNothing();

  // 5. App settings
  await db.insert(appSettings).values([
    { key: "pipeline_stage_id_live", value: LIVE_STAGE_ID },
    { key: "underperformance_window_days", value: "365" },
  ]).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: appSettings.value },
  });

  // 6. Locations — internal_poc_id, num_rooms, primary_region_id all set
  //    so classifyEligibleLocations can score them.
  for (let i = 1; i <= 10; i++) {
    await db.insert(locations).values({
      id: LOCATION_IDS[i - 1],
      name: `Test Hotel ${i}`,
      primaryRegionId: REGION_ID,
      ianaTimezone: "Europe/London",
      internalPocId: POC_IDS[i],
      numRooms: NUM_ROOMS[i],
    }).onConflictDoNothing();
  }

  // 7. Kiosks — one per hotel, all at the Live pipeline stage (eligibility).
  //    `internal_poc_id` on kiosks is irrelevant after the hotel-level
  //    rewrite (left null for clarity).
  for (let i = 1; i <= 10; i++) {
    await db.insert(kiosks).values({
      id: KIOSK_IDS[i - 1],
      kioskId: `K${i}`,
      outletCode: `OC-${i.toString().padStart(3, "0")}`,
      pipelineStageId: LIVE_STAGE_ID,
    }).onConflictDoNothing();
  }

  // 8. Kiosk assignments — `assigned_at` set 100 days back so every hotel
  //    clears the >=90-day maturity gate in classifyEligibleLocations.
  const assignedAt = new Date(Date.now() - HUNDRED_DAYS_MS);
  for (let i = 1; i <= 10; i++) {
    await db.insert(kioskAssignments).values({
      kioskId: KIOSK_IDS[i - 1],
      locationId: LOCATION_IDS[i - 1],
      assignedAt,
      assignedBy: "system",
      assignedByName: "System",
    }).onConflictDoNothing();
  }

  // 9. Sales records — one row per hotel with the fixture revenue.
  for (let i = 1; i <= 10; i++) {
    await db.insert(salesRecords).values({
      regionId: REGION_ID,
      saleRef: `SALEREF-H${i}`,
      refNo: `REF-H${i}`,
      transactionDate: new Date().toISOString().slice(0, 10),
      locationId: LOCATION_IDS[i - 1],
      productId: PRODUCT_ID,
      netAmount: REVENUES[i].toFixed(2),
      vatAmount: "0.00",
      currency: "GBP",
      netsuiteCode: `NS-H${i}`,
    }).onConflictDoNothing();
  }
}
