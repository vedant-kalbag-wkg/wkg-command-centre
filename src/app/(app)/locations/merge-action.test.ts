/**
 * Unit tests for mergeLocationsAction — Phase 7 Plan 07-03 (DATA-02).
 *
 * Mocks the auth + applyLocationMerge collaborators so we can exercise:
 *   - admin-only gate (RBAC error envelope).
 *   - lock-contention envelope routed from the primitive's typed error.
 *   - happy path returns { success: true, merged: N }.
 *   - fieldResolutions forwarded to the primitive verbatim.
 *
 * The actual merge SQL (FK rewrites + snapshot capture + advisory lock
 * acquisition) is covered by src/lib/location-merge.test.ts — this test
 * only asserts the action wrapper.
 *
 * PR #34 review fix: the action layer used to acquire a session-scoped
 * `pg_try_advisory_lock` on `db.execute`, which landed on a different pool
 * connection than the transaction that runs the merge. The lock is now
 * acquired INSIDE the primitive's transaction via
 * `pg_try_advisory_xact_lock`, and the action catches the typed
 * `LOCATION_MERGE_LOCK_CONTENTION` error to surface
 * `{ status: "lock_contention" }`.
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
    // The action no longer calls db.execute directly post-PR #34 review;
    // the spy is kept so tests can assert that we did NOT touch it.
    execute: vi.fn(),
  },
}));

vi.mock("@/lib/location-merge", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/location-merge")
  >("@/lib/location-merge");
  return {
    ...actual,
    applyLocationMerge: vi.fn(),
    // Re-export the contention-error constant so the action can import it
    // and our tests can throw the exact same string the primitive throws.
    LOCATION_MERGE_LOCK_CONTENTION: actual.LOCATION_MERGE_LOCK_CONTENTION,
  };
});

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { mergeLocationsAction } from "./merge-action";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import {
  applyLocationMerge,
  LOCATION_MERGE_LOCK_CONTENTION,
} from "@/lib/location-merge";
import { revalidateTag } from "next/cache";

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
  vi.mocked(revalidateTag).mockReset();
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

describe("mergeLocationsAction — lock contention envelope", () => {
  it("routes LOCATION_MERGE_LOCK_CONTENTION from the primitive to { status: 'lock_contention' }", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    vi.mocked(applyLocationMerge).mockRejectedValueOnce(
      new Error(LOCATION_MERGE_LOCK_CONTENTION),
    );

    const result = await mergeLocationsAction("canonical-1", ["defunct-1"]);
    expect(result).toEqual({ status: "lock_contention" });
    // No revalidate on contention — the merge never ran.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("does NOT acquire a session-scoped lock via db.execute (PR #34 review fix)", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
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
      canonicalFieldChangeCount: 0,
    } as never);

    await mergeLocationsAction("canonical-1", ["defunct-1"]);

    // Action layer must NOT touch db.execute — that's what landed the
    // session-scoped lock on a different connection than the transaction.
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("mergeLocationsAction — happy path + forwarding", () => {
  it("forwards fieldResolutions to applyLocationMerge as the 5th positional arg", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
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
      canonicalFieldChangeCount: 2,
    } as never);

    const RESOLUTIONS = { address: "2 New Address Ln", hotelGroup: "Marriott" };
    const result = await mergeLocationsAction(
      "canonical-1",
      ["defunct-1"],
      RESOLUTIONS,
    );
    expect(result).toEqual({ success: true, merged: 1 });
    expect(applyLocationMerge).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(applyLocationMerge).mock.calls[0];
    expect(callArgs[0]).toBe("canonical-1");
    expect(callArgs[1]).toEqual(["defunct-1"]);
    expect(callArgs[4]).toEqual(RESOLUTIONS);
    expect(revalidateTag).toHaveBeenCalledWith("locations", "max");
  });

  it("returns success envelope with the correct merged count", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
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
      canonicalFieldChangeCount: 0,
    } as never);

    const result = await mergeLocationsAction("canonical-1", [
      "defunct-1",
      "defunct-2",
    ]);
    expect(result).toEqual({ success: true, merged: 2 });
    expect(applyLocationMerge).toHaveBeenCalledOnce();
  });

  it("returns generic error envelope on non-contention errors from the primitive", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    vi.mocked(applyLocationMerge).mockRejectedValueOnce(
      new Error("canonicalId cannot appear in defunctIds"),
    );

    const result = await mergeLocationsAction("dup", ["dup"]);
    expect(result).toEqual({
      error: "canonicalId cannot appear in defunctIds",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
