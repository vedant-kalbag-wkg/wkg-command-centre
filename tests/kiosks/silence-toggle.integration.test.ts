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
import { kiosks } from "@/db/schema";
import { silenceKiosk, unsilenceKiosk } from "@/app/(app)/kiosks/[id]/silence-actions";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// Stable test kiosk UUID (version 4, variant 8 — passes Zod uuid() validation)
const TEST_KIOSK_ID = "f1000000-0000-4000-8000-000000000001";
const TEST_KIOSK_TEXT_ID = "TEST-SILENCE-001";

async function seedKiosk(ctx: TestDbContext) {
  await ctx.db.insert(kiosks).values({
    id: TEST_KIOSK_ID,
    kioskId: TEST_KIOSK_TEXT_ID,
  }).onConflictDoNothing();
}

async function getKioskRow(ctx: TestDbContext) {
  const rows = await ctx.db
    .select()
    .from(kiosks)
    .where(eq(kiosks.id, TEST_KIOSK_ID))
    .limit(1);
  return rows[0] ?? null;
}

describe("silenceKiosk + unsilenceKiosk (PERF-06)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Reset kiosk silencing state between tests
    await ctx.db
      .update(kiosks)
      .set({ alertSilencedAt: null, alertSilencedReason: null })
      .where(eq(kiosks.id, TEST_KIOSK_ID));
  });

  it("silenceKiosk: sets alertSilencedAt + reason in DB", async () => {
    await seedKiosk(ctx);

    const result = await silenceKiosk(TEST_KIOSK_ID, "Undergoing scheduled maintenance");
    expect(result.ok).toBe(true);

    const row = await getKioskRow(ctx);
    expect(row).not.toBeNull();
    expect(row!.alertSilencedAt).toBeInstanceOf(Date);
    expect(row!.alertSilencedReason).toBe("Undergoing scheduled maintenance");
  });

  it("unsilenceKiosk: clears alertSilencedAt + reason in DB", async () => {
    await seedKiosk(ctx);

    // First silence it
    await silenceKiosk(TEST_KIOSK_ID, "Temporary silence");
    const silenced = await getKioskRow(ctx);
    expect(silenced!.alertSilencedAt).toBeInstanceOf(Date);

    // Then unsilence
    const result = await unsilenceKiosk(TEST_KIOSK_ID);
    expect(result.ok).toBe(true);

    const row = await getKioskRow(ctx);
    expect(row!.alertSilencedAt).toBeNull();
    expect(row!.alertSilencedReason).toBeNull();
  });

  it("silenceKiosk: rejects reason shorter than 3 chars", async () => {
    await seedKiosk(ctx);

    const result = await silenceKiosk(TEST_KIOSK_ID, "ab");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/at least 3/i);
    }
  });

  it("silenceKiosk: rejects invalid UUID", async () => {
    const result = await silenceKiosk("not-a-uuid", "Valid reason here");
    expect(result.ok).toBe(false);
  });

  it("silenceKiosk: returns error for non-existent kiosk", async () => {
    const result = await silenceKiosk(
      "99999999-0000-4000-8000-000000000099",
      "Valid reason here",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("unsilenceKiosk: accepts optional reason", async () => {
    await seedKiosk(ctx);

    await silenceKiosk(TEST_KIOSK_ID, "Temporary silence");

    const result = await unsilenceKiosk(TEST_KIOSK_ID, "Issue resolved — re-enabling alerts");
    expect(result.ok).toBe(true);

    const row = await getKioskRow(ctx);
    expect(row!.alertSilencedAt).toBeNull();
  });
});
