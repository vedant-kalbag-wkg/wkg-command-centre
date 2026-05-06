/**
 * Phase 7.1 — `updateLocationField` accepts `locationType` only when the
 * value matches the LOCATION_TYPES enum (or is null/empty for "clear").
 * The CHECK constraint added in migration 0034 is the last line of defence;
 * this test pins the application-layer guard so a 23514 from Postgres never
 * reaches the user.
 *
 * Strategy: stub `db.update(...).set(...).where(...)` to a no-op and
 * intercept what `updateData` ends up containing, by capturing the args
 * passed to `.set(...)`. For invalid values the action returns
 * `{ error: ... }` *before* hitting the DB, so the stub never fires.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const setSpy = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ name: "Test Hotel" }],
        }),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => {
        setSpy(data);
        return { where: async () => undefined };
      },
    }),
  },
}));

const requireRoleFn = vi.fn();
vi.mock("@/lib/rbac", () => ({
  requireRole: (...roles: string[]) => requireRoleFn(...roles),
  redactSensitiveFields: (x: unknown) => x,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {},
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async () => "https://example.com/signed",
}));

import { updateLocationField } from "../actions";

const LOC_ID = "00000000-0000-0000-0000-0000000000aa";

beforeEach(() => {
  setSpy.mockReset();
  requireRoleFn.mockReset();
  requireRoleFn.mockResolvedValue({
    user: { id: "admin-1", name: "Admin", role: "admin" },
  });
});

describe("updateLocationField — locationType validation (Phase 7.1)", () => {
  for (const valid of [
    "hotel",
    "retail_desk",
    "online",
    "airport",
    "hex_kiosk",
    "internal",
  ]) {
    it(`accepts "${valid}" and writes it through to the DB`, async () => {
      const result = await updateLocationField(LOC_ID, "locationType", valid);
      expect(result).not.toHaveProperty("error");
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0]![0]).toMatchObject({ locationType: valid });
    });
  }

  it("treats null as 'clear classification' (writes null)", async () => {
    const result = await updateLocationField(LOC_ID, "locationType", null);
    expect(result).not.toHaveProperty("error");
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ locationType: null });
  });

  it("treats empty string as 'clear classification' (writes null)", async () => {
    const result = await updateLocationField(LOC_ID, "locationType", "");
    expect(result).not.toHaveProperty("error");
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ locationType: null });
  });

  it("rejects values outside the enum without touching the DB", async () => {
    const result = await updateLocationField(LOC_ID, "locationType", "warehouse");
    expect(result).toEqual({ error: "Invalid location type: warehouse" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rejects mixed-case as a guard against client-side casing drift", async () => {
    const result = await updateLocationField(LOC_ID, "locationType", "Hotel");
    expect(result).toEqual({ error: "Invalid location type: Hotel" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("does not allow bypass via attempting an unrelated field name", async () => {
    // Smoke check that the field whitelist itself still filters arbitrary
    // attribute names (e.g. "id", "createdAt"). This is technically the same
    // behaviour as before Phase 7.1 but worth pinning so the new branch in
    // the type-narrowing block can't accidentally widen the surface.
    const result = await updateLocationField(LOC_ID, "id", "anything");
    expect(result).toEqual({ error: "Invalid field: id" });
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("updateLocationField — primaryRegionId validation (Phase 7.2)", () => {
  const VALID_UUID = "12345678-1234-1234-1234-123456789abc";

  it("accepts a canonical UUID and writes it through", async () => {
    const result = await updateLocationField(LOC_ID, "primaryRegionId", VALID_UUID);
    expect(result).not.toHaveProperty("error");
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ primaryRegionId: VALID_UUID });
  });

  it("rejects null (NOT NULL since 0022)", async () => {
    const result = await updateLocationField(LOC_ID, "primaryRegionId", null);
    expect(result).toEqual({ error: "A region is required" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rejects empty string", async () => {
    const result = await updateLocationField(LOC_ID, "primaryRegionId", "");
    expect(result).toEqual({ error: "A region is required" });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rejects non-UUID values without touching the FK", async () => {
    const result = await updateLocationField(LOC_ID, "primaryRegionId", "UK");
    expect(result).toEqual({ error: "A region is required" });
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("updateLocationField — internalPocId clear behaviour (Phase 7.4)", () => {
  it("empty string clears the FK to null (matches '— Unassigned —' picker option)", async () => {
    const result = await updateLocationField(LOC_ID, "internalPocId", "");
    expect(result).not.toHaveProperty("error");
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ internalPocId: null });
  });

  it("null also clears the FK", async () => {
    const result = await updateLocationField(LOC_ID, "internalPocId", null);
    expect(result).not.toHaveProperty("error");
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ internalPocId: null });
  });

  it("non-empty value passes through to the DB (FK enforces existence)", async () => {
    const result = await updateLocationField(LOC_ID, "internalPocId", "user-abc");
    expect(result).not.toHaveProperty("error");
    expect(setSpy.mock.calls[0]![0]).toMatchObject({ internalPocId: "user-abc" });
  });
});

describe("updateLocationField — outletCode rejected post-Phase-07-06", () => {
  // Phase 07-06 — locations.outlet_code is gone (migration 0040). The
  // outletCode field is no longer in EDITABLE_LOCATION_FIELDS, so the
  // zod-driven validator now rejects it as an unknown field. The previous
  // trim/length validation tests are subsumed by this single contract:
  // the column doesn't exist, so the API path doesn't exist either.
  it("rejects outletCode as an unknown field (column gone)", async () => {
    setSpy.mockReset();
    const result = await updateLocationField(LOC_ID, "outletCode", "anything");
    expect(result).toEqual({ error: "Invalid field: outletCode" });
    expect(setSpy).not.toHaveBeenCalled();
  });
});
