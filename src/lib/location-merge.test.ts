/**
 * Unit tests for applyLocationMerge — Phase 7 Plan 07-03 (DATA-02).
 *
 * Strategy: mock the Drizzle DB handle's surface (`select` chain, `insert`
 * chain, `update` chain, `transaction` callback, raw `execute`) so the
 * primitive's contract can be exercised without a live Postgres. Acceptance
 * criteria for this plan are about contract — what the primitive issues, what
 * it captures into the snapshot, what it rejects — not about the SQL semantics
 * (those are covered by the integration test on the UAT branch in Plan E).
 *
 * Tests covered:
 *   1. Snapshot row written with archived_ids + fk_changes capturing pre-merge state.
 *   2. Snapshot's audit_log_id matches the inserted merge audit row id.
 *   3. Sentinel-as-canonical → throws with "LOCATION_NEEDED" in the message.
 *   4. Sentinel-as-defunct → throws with "LOCATION_NEEDED" in the message.
 *   5. No-op re-run (every defunct already archived, no FK rows) — completes
 *      without error.
 */
import { describe, it, expect, vi } from "vitest";

import { applyLocationMerge } from "./location-merge";

// Mock the audit log helper — we don't care what it writes inside the
// transaction here, only that the merge primitive doesn't crash on it.
vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

type FkChange = {
  table: string;
  row_id: string;
  fk_column: string;
  previous_value: string;
};

type MockOptions = {
  /** Sentinel id to return from the `select({id})` on locations filtering by sentinel name+code. */
  sentinelId?: string;
  /** Canonical row name returned from the `select({name})` on locations by id. */
  canonicalName?: string;
  /** Pre-merge kiosk_assignments rows (location_id IN defunctIds). */
  kaRows?: Array<{ id: string; locationId: string }>;
  /** Pre-merge sales_records.location_id rows. */
  srPrimary?: Array<{ id: string; locationId: string }>;
  /** Pre-merge sales_records.processed_at_location_id rows. */
  srProcessed?: Array<{ id: string; processedAtLocationId: string }>;
};

/**
 * Builds a minimal Drizzle-shaped mock that:
 *   - Returns the sentinel select first, then the canonical-name select,
 *     then the per-FK-table preselect rows, in the order applyLocationMerge
 *     calls them.
 *   - Has a `transaction(cb)` that invokes the callback with a `tx` that
 *     records every insert/execute call so the test can assert on them.
 */
function buildMockDb(opts: MockOptions = {}) {
  // Pre-merge selects (outside the transaction).
  // applyLocationMerge order:
  //   1. SELECT {id} FROM locations WHERE outletCode=__LOCATION_NEEDED__ AND name=LOCATION_NEEDED LIMIT 1
  //   2. SELECT {name} FROM locations WHERE id=canonicalId LIMIT 1
  // Inside the transaction, then per-FK-table selects (kiosk_assignments,
  // sales_records primary, sales_records processed, location_products,
  // location_region_memberships, location_group_memberships,
  // location_hotel_group_memberships, location_flags, action_items).

  const outerSelectQueue: unknown[][] = [
    opts.sentinelId ? [{ id: opts.sentinelId }] : [],
    opts.canonicalName !== undefined ? [{ name: opts.canonicalName }] : [{ name: "" }],
  ];

  const innerSelectQueue: unknown[][] = [
    opts.kaRows ?? [],
    opts.srPrimary ?? [],
    opts.srProcessed ?? [],
    [], // location_products
    [], // location_region_memberships
    [], // location_group_memberships
    [], // location_hotel_group_memberships
    [], // location_flags
    [], // action_items
  ];

  type Captured = {
    auditInsertValues: Record<string, unknown> | null;
    snapshotInsertValues: Record<string, unknown> | null;
    executeCalls: number;
  };
  const captured: Captured = {
    auditInsertValues: null,
    snapshotInsertValues: null,
    executeCalls: 0,
  };

  // Outer (db.select) — used by the sentinel + canonical-name lookups.
  const makeOuterSelect = () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(outerSelectQueue.shift() ?? []),
      }),
    }),
  });

  // Inner tx select — used by per-FK preselects.
  const makeInnerSelect = () => ({
    from: () => ({
      where: () => Promise.resolve(innerSelectQueue.shift() ?? []),
    }),
  });

  const tx = {
    select: () => makeInnerSelect(),
    insert: (table: { _: { name: string } } | unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          // The merge primitive calls `.returning({id: ...})` on TWO inserts:
          // (1) the merge audit row, then (2) the snapshot row.
          // Distinguish by which has been seen first.
          if (captured.auditInsertValues === null) {
            captured.auditInsertValues = vals;
            return Promise.resolve([{ id: "merge-audit-id-fixture" }]);
          }
          captured.snapshotInsertValues = vals;
          return Promise.resolve([{ id: "snapshot-id-fixture" }]);
        },
      }),
    }),
    execute: () => {
      captured.executeCalls++;
      // node-postgres-shaped result with rowCount=0 → no rewrites in tests.
      return Promise.resolve({ rowCount: 0 });
    },
  };

  const db = {
    select: () => makeOuterSelect(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(tx);
    },
  };

  return { db, captured };
}

const ACTOR = { id: "actor-1", name: "Test Admin" };

describe("applyLocationMerge — sentinel guard", () => {
  it("throws when canonicalId equals the LOCATION_NEEDED sentinel id", async () => {
    const SENTINEL = "00000000-0000-0000-0000-00000000000a";
    const { db } = buildMockDb({ sentinelId: SENTINEL });

    await expect(
      applyLocationMerge(SENTINEL, ["00000000-0000-0000-0000-00000000000b"], ACTOR, db),
    ).rejects.toThrow(/LOCATION_NEEDED/);
  });

  it("throws when any defunctId equals the LOCATION_NEEDED sentinel id", async () => {
    const SENTINEL = "00000000-0000-0000-0000-00000000000a";
    const { db } = buildMockDb({ sentinelId: SENTINEL });

    await expect(
      applyLocationMerge(
        "00000000-0000-0000-0000-00000000000c",
        [SENTINEL],
        ACTOR,
        db,
      ),
    ).rejects.toThrow(/LOCATION_NEEDED/);
  });

  it("throws when canonicalId is also in defunctIds (caller dedupe gate)", async () => {
    const { db } = buildMockDb();
    await expect(
      applyLocationMerge("dup", ["dup"], ACTOR, db),
    ).rejects.toThrow(/canonicalId cannot appear in defunctIds/);
  });
});

describe("applyLocationMerge — snapshot capture", () => {
  it("writes snapshot row with archived_ids + fk_changes for every preselected FK row", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF1 = "00000000-0000-0000-0000-00000000000d";
    const DEF2 = "00000000-0000-0000-0000-00000000000e";
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      kaRows: [
        { id: "ka-1", locationId: DEF1 },
        { id: "ka-2", locationId: DEF2 },
      ],
      srPrimary: [{ id: "sr-1", locationId: DEF1 }],
      srProcessed: [{ id: "sr-2", processedAtLocationId: DEF2 }],
    });

    const result = await applyLocationMerge(CANONICAL, [DEF1, DEF2], ACTOR, db);

    expect(captured.snapshotInsertValues).not.toBeNull();
    expect(captured.snapshotInsertValues!.auditLogId).toBe("merge-audit-id-fixture");

    const payload = captured.snapshotInsertValues!.payload as {
      archived_ids: string[];
      fk_changes: FkChange[];
    };
    expect(payload.archived_ids).toEqual([DEF1, DEF2]);

    // 4 rows captured: 2× kiosk_assignments + 1× sales_records.location_id +
    // 1× sales_records.processed_at_location_id.
    expect(payload.fk_changes).toHaveLength(4);

    const ka = payload.fk_changes.filter((c) => c.table === "kiosk_assignments");
    expect(ka).toHaveLength(2);
    expect(ka[0]).toMatchObject({ fk_column: "location_id" });

    const sr = payload.fk_changes.filter((c) => c.table === "sales_records");
    const srCols = sr.map((c) => c.fk_column).sort();
    expect(srCols).toEqual(["location_id", "processed_at_location_id"]);

    expect(result.snapshotId).toBe("snapshot-id-fixture");
    expect(result.fkChangeCount).toBe(4);
  });

  it("snapshot's audit_log_id references the merge audit row written first in the same transaction", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF = "00000000-0000-0000-0000-00000000000d";
    const { db, captured } = buildMockDb({
      kaRows: [{ id: "ka-1", locationId: DEF }],
    });

    await applyLocationMerge(CANONICAL, [DEF], ACTOR, db);

    expect(captured.auditInsertValues).not.toBeNull();
    expect(captured.auditInsertValues!.action).toBe("merge");
    expect(captured.auditInsertValues!.entityType).toBe("location");
    expect(captured.auditInsertValues!.entityId).toBe(CANONICAL);

    expect(captured.snapshotInsertValues).not.toBeNull();
    expect(captured.snapshotInsertValues!.auditLogId).toBe("merge-audit-id-fixture");
  });
});

describe("applyLocationMerge — no-op shape", () => {
  it("completes without error when no FK rows match (everything already archived)", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF = "00000000-0000-0000-0000-00000000000d";
    // No FK rows in any preselect; every UPDATE returns rowCount=0.
    const { db } = buildMockDb();

    const result = await applyLocationMerge(CANONICAL, [DEF], ACTOR, db);

    expect(result.kioskAssignmentsRewritten).toBe(0);
    expect(result.salesRecordsRewritten).toBe(0);
    expect(result.locationsArchived).toBe(0);
    // The merge audit + snapshot rows still get written (snapshot's
    // archived_ids = defunctIds even when fk_changes is empty); this matches
    // the production shape where a defunct row already archived in a prior
    // run still flows through cleanly. Re-running undoMerge against this
    // snapshot would restore archived_at=NULL on rows already NULL → no-op.
    expect(result.snapshotId).toBe("snapshot-id-fixture");
    expect(result.fkChangeCount).toBe(0);
  });
});
