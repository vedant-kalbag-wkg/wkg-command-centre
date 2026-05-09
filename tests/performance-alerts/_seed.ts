/**
 * Shared seed helper for performance-alert integration tests.
 *
 * Inserts K1–K10 synthetic fixtures in FK order:
 *   regions → pipelineStages → products → user → appSettings
 *   → locations → kiosks → kioskAssignments → salesRecords
 *
 * K1–K4, K10 generate £100–£200 revenue → land in Emerging tier (bottom 20%).
 * K5–K8    generate £400–£700 revenue → land in Developing/Standard tier.
 * K9       generates £999 revenue      → lands in Premium tier (top 20%).
 *
 * K5 deliberately has internalPocId = null (tests null-poc-skip path).
 * K1–K4, K9, K10 share POC user poc-user-001.
 * K6–K8 share POC user poc-user-002.
 *
 * The live pipeline stage id is inserted into app_settings as
 * "pipeline_stage_id_live" so classifyEligibleKiosks() resolves it.
 * "underperformance_window_days" is set to 365 so all fixtures fall within window.
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

// Location IDs (one per kiosk for clarity)
// UUID first segment must be exactly 8 hex chars — pad the index to 8 chars.
export const LOCATION_IDS = Array.from({ length: 10 }, (_, i) =>
  `d${String(i + 1).padStart(7, "0")}-0000-0000-0000-000000000001`,
);

// Kiosk IDs (uuid for kiosks table, string text for kiosk_id column)
export const KIOSK_IDS = Array.from({ length: 10 }, (_, i) =>
  `e${String(i + 1).padStart(7, "0")}-0000-0000-0000-000000000001`,
);

// Revenue per kiosk — determines tier classification
// With default thresholds (top:80, mid:50, bottom:20):
//   percentile >= 80 → Premium, >= 50 → Standard, >= 20 → Developing, < 20 → Emerging
// K1-K4 (£100-£200), K10 (£150) → Emerging
// K5-K8 (£400-£700) → Developing/Standard
// K9 (£999) → Premium
const REVENUES: Record<number, number> = {
  1: 100,
  2: 120,
  3: 150,
  4: 200,
  5: 400,
  6: 500,
  7: 600,
  8: 700,
  9: 999,
  10: 150,
};

// internalPocId per kiosk (1-based)
const POC_IDS: Record<number, string | null> = {
  1: POC_USER_1_ID,
  2: POC_USER_1_ID,
  3: POC_USER_1_ID,
  4: POC_USER_1_ID,
  5: null,          // K5 has no POC — triggers the null-poc-skip path
  6: POC_USER_2_ID,
  7: POC_USER_2_ID,
  8: POC_USER_2_ID,
  9: POC_USER_1_ID,
  10: POC_USER_1_ID,
};

export async function seedFixtures(pool: Pool): Promise<void> {
  const db = drizzle(pool);

  // 1. Region — use a test-specific code ("TS") that does not conflict with
  //    the canonical regions seeded by migration 0022 (UK, IE, DE, ES, CZ)
  //    or 0025 (AU). Canonical regions have random UUIDs so we cannot rely
  //    on onConflictDoNothing() landing our stable UUID at REGION_ID.
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

  // 6. Locations (one per kiosk)
  for (let i = 1; i <= 10; i++) {
    await db.insert(locations).values({
      id: LOCATION_IDS[i - 1],
      name: `Test Hotel ${i}`,
      primaryRegionId: REGION_ID,
      ianaTimezone: "Europe/London",
    }).onConflictDoNothing();
  }

  // 7. Kiosks
  for (let i = 1; i <= 10; i++) {
    await db.insert(kiosks).values({
      id: KIOSK_IDS[i - 1],
      kioskId: `K${i}`,
      outletCode: `OC-${i.toString().padStart(3, "0")}`,
      pipelineStageId: LIVE_STAGE_ID,
      internalPocId: POC_IDS[i],
    }).onConflictDoNothing();
  }

  // 8. Kiosk assignments (active: unassigned_at IS NULL)
  for (let i = 1; i <= 10; i++) {
    await db.insert(kioskAssignments).values({
      kioskId: KIOSK_IDS[i - 1],
      locationId: LOCATION_IDS[i - 1],
      assignedBy: "system",
      assignedByName: "System",
    }).onConflictDoNothing();
  }

  // 9. Sales records — one row per kiosk with the fixture revenue
  for (let i = 1; i <= 10; i++) {
    await db.insert(salesRecords).values({
      regionId: REGION_ID,
      saleRef: `SALEREF-K${i}`,
      refNo: `REF-K${i}`,
      transactionDate: new Date().toISOString().slice(0, 10),
      locationId: LOCATION_IDS[i - 1],
      productId: PRODUCT_ID,
      netAmount: REVENUES[i].toFixed(2),
      vatAmount: "0.00",
      currency: "GBP",
      netsuiteCode: `NS-K${i}`,
    }).onConflictDoNothing();
  }
}
