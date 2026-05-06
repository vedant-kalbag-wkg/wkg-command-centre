/**
 * Unit tests for mergeLocationsAction — Phase 7 Plan 07-03 (DATA-02).
 *
 * Mocks the auth + db + applyLocationMerge collaborators so we can exercise:
 *   - admin-only gate (RBAC error envelope).
 *   - advisory-lock contention envelope.
 *   - happy path returns { success: true, merged: N }.
 *
 * The actual merge SQL (FK rewrites + snapshot capture) is covered by
 * src/lib/location-merge.test.ts — this test only asserts the action wrapper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------------------
// Mocks (must be declared BEFORE the import-under-test).
// ----------------------------------------------------------------------------
vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("@/lib/location-merge", () => ({
  applyLocationMerge: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { mergeLocationsAction } from "./merge-action";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { applyLocationMerge } from "@/lib/location-merge";

const ADMIN_SESSION = {
  user: {
    id: "admin-1",
    name: "Test Admin",
    email: "admin@weknow.co",
  },
};

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(db.execute).mockReset();
  vi.mocked(applyLocationMerge).mockReset();
});

describe("mergeLocationsAction — RBAC gate", () => {
  it("returns an error envelope when requireRole throws (non-admin)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    const result = await mergeLocationsAction("canonical-1", ["defunct-1"]);
    expect(result).toEqual({ error: "Forbidden" });
    expect(applyLocationMerge).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("mergeLocationsAction — advisory lock", () => {
  it("returns lock_contention envelope when pg_try_advisory_lock returns false", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    // Lock acquisition returns { rows: [{ lock: false }] } — postgres-js shape.
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ lock: false }],
    } as never);
    const result = await mergeLocationsAction("canonical-1", ["defunct-1"]);
    expect(result).toEqual({ status: "lock_contention" });
    expect(applyLocationMerge).not.toHaveBeenCalled();
  });

  it("forwards fieldResolutions to applyLocationMerge (Plan 07-03 follow-up)", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ lock: true }],
    } as never);
    vi.mocked(applyLocationMerge).mockResolvedValueOnce({
      canonicalId: "canonical-1",
      defunctIds: ["defunct-1"],
      pairsMerged: 1,
      salesRecordsRewritten: 0,
      kioskAssignmentsRewritten: 0,
      locationProductsRewritten: 0,
      locationProductsDeleted: 0,
      hotelGroupMembershipsRewritten: 0,
      hotelGroupMembershipsDeleted: 0,
      regionMembershipsRewritten: 0,
      regionMembershipsDeleted: 0,
      groupMembershipsRewritten: 0,
      groupMembershipsDeleted: 0,
      locationFlagsRewritten: 0,
      actionItemsRewritten: 0,
      locationsArchived: 1,
      auditLogsWritten: 1,
      snapshotId: "snap-1",
      fkChangeCount: 0,
    } as never);
    vi.mocked(db.execute).mockResolvedValueOnce({} as never);

    const RESOLUTIONS = { address: "2 New Address Ln", hotelGroup: "Marriott" };
    const result = await mergeLocationsAction(
      "canonical-1",
      ["defunct-1"],
      RESOLUTIONS,
    );
    expect(result).toEqual({ success: true, merged: 1 });
    expect(applyLocationMerge).toHaveBeenCalledOnce();
    // 5th arg is the fieldResolutions; must equal what came in from the dialog.
    const callArgs = vi.mocked(applyLocationMerge).mock.calls[0];
    expect(callArgs[0]).toBe("canonical-1");
    expect(callArgs[1]).toEqual(["defunct-1"]);
    expect(callArgs[4]).toEqual(RESOLUTIONS);
  });

  it("returns success envelope on the happy path", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    // First execute: acquire lock → true.
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [{ lock: true }],
    } as never);
    vi.mocked(applyLocationMerge).mockResolvedValueOnce({
      canonicalId: "canonical-1",
      defunctIds: ["defunct-1", "defunct-2"],
      pairsMerged: 2,
      salesRecordsRewritten: 0,
      kioskAssignmentsRewritten: 0,
      locationProductsRewritten: 0,
      locationProductsDeleted: 0,
      hotelGroupMembershipsRewritten: 0,
      hotelGroupMembershipsDeleted: 0,
      regionMembershipsRewritten: 0,
      regionMembershipsDeleted: 0,
      groupMembershipsRewritten: 0,
      groupMembershipsDeleted: 0,
      locationFlagsRewritten: 0,
      actionItemsRewritten: 0,
      locationsArchived: 2,
      auditLogsWritten: 3,
      snapshotId: "snap-1",
      fkChangeCount: 0,
    } as never);
    // Second execute: pg_advisory_unlock in finally.
    vi.mocked(db.execute).mockResolvedValueOnce({} as never);

    const result = await mergeLocationsAction("canonical-1", [
      "defunct-1",
      "defunct-2",
    ]);
    expect(result).toEqual({ success: true, merged: 2 });
    expect(applyLocationMerge).toHaveBeenCalledOnce();
    // Lock acquisition + release == 2 execute calls.
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
