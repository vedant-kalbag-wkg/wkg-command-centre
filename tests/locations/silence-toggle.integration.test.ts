import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── DB injection (must be hoisted before any module that imports @/db) ──────
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

// ─── Mock next/cache (revalidatePath is a no-op in integration tests) ─────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ─── Mock @/lib/rbac to inject an admin session ──────────────────────────────
// NOTE: vi.mock factories are hoisted — do NOT reference module-level variables.
// Inline the session literal directly inside the factory.
vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn().mockResolvedValue({
    user: { id: "admin-user-id", name: "Test Admin", role: "admin" as const },
  }),
  getSessionOrThrow: vi.fn().mockResolvedValue({
    user: { id: "admin-user-id", name: "Test Admin", role: "admin" as const },
  }),
}));

import { eq } from "drizzle-orm";
import { locations, regions } from "@/db/schema";
import {
  silenceLocation,
  unsilenceLocation,
} from "@/app/(app)/locations/[id]/silence-actions";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// Stable test location UUID + region (regions.primaryRegionId is NOT NULL on
// locations since migration 0022).
const TEST_LOCATION_ID = "f1000000-0000-4000-8000-000000000001";
const TEST_REGION_ID = "f2000000-0000-4000-8000-000000000001";

async function seedLocation(ctx: TestDbContext) {
  await ctx.db.insert(regions).values({
    id: TEST_REGION_ID,
    name: "Test Region",
    code: "TS",
  }).onConflictDoNothing();
  await ctx.db.insert(locations).values({
    id: TEST_LOCATION_ID,
    name: "Test Hotel — Silence Toggle",
    primaryRegionId: TEST_REGION_ID,
    ianaTimezone: "Europe/London",
  }).onConflictDoNothing();
}

async function getLocationRow(ctx: TestDbContext) {
  const rows = await ctx.db
    .select()
    .from(locations)
    .where(eq(locations.id, TEST_LOCATION_ID))
    .limit(1);
  return rows[0] ?? null;
}

describe("silenceLocation + unsilenceLocation (PERF-06, hotel-level)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Reset silencing state between tests
    await ctx.db
      .update(locations)
      .set({ alertSilencedAt: null, alertSilencedReason: null })
      .where(eq(locations.id, TEST_LOCATION_ID));
  });

  it("silenceLocation: sets alertSilencedAt + reason in DB", async () => {
    await seedLocation(ctx);

    const result = await silenceLocation(
      TEST_LOCATION_ID,
      "Undergoing scheduled maintenance",
    );
    expect(result.ok).toBe(true);

    const row = await getLocationRow(ctx);
    expect(row).not.toBeNull();
    expect(row!.alertSilencedAt).toBeInstanceOf(Date);
    expect(row!.alertSilencedReason).toBe("Undergoing scheduled maintenance");
  });

  it("unsilenceLocation: clears alertSilencedAt + reason in DB", async () => {
    await seedLocation(ctx);

    await silenceLocation(TEST_LOCATION_ID, "Temporary silence");
    const silenced = await getLocationRow(ctx);
    expect(silenced!.alertSilencedAt).toBeInstanceOf(Date);

    const result = await unsilenceLocation(TEST_LOCATION_ID);
    expect(result.ok).toBe(true);

    const row = await getLocationRow(ctx);
    expect(row!.alertSilencedAt).toBeNull();
    expect(row!.alertSilencedReason).toBeNull();
  });

  it("silenceLocation: rejects reason shorter than 3 chars", async () => {
    await seedLocation(ctx);

    const result = await silenceLocation(TEST_LOCATION_ID, "ab");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/at least 3/i);
    }
  });

  it("silenceLocation: rejects invalid UUID", async () => {
    const result = await silenceLocation("not-a-uuid", "Valid reason here");
    expect(result.ok).toBe(false);
  });

  it("silenceLocation: returns error for non-existent location", async () => {
    const result = await silenceLocation(
      "99999999-0000-4000-8000-000000000099",
      "Valid reason here",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("unsilenceLocation: accepts optional reason", async () => {
    await seedLocation(ctx);

    await silenceLocation(TEST_LOCATION_ID, "Temporary silence");

    const result = await unsilenceLocation(
      TEST_LOCATION_ID,
      "Issue resolved — re-enabling alerts",
    );
    expect(result.ok).toBe(true);

    const row = await getLocationRow(ctx);
    expect(row!.alertSilencedAt).toBeNull();
  });
});
