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

// Mock the audit log helper. Tests that care about per-field `update` audit
// rows (Plan 07-03 follow-up: fieldResolutions lift) assert against the
// mock's call list directly. The other tests don't care what gets written.
vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeAuditLog } from "@/lib/audit";

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
  /**
   * Pre-write canonical row used by the field-resolutions preselect (the
   * primitive reads the canonical's CURRENT values BEFORE writing the
   * resolutions, so the snapshot can capture them for undo).
   */
  canonicalPreWrite?: Record<string, unknown>;
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

  // Canonical pre-write read is the FIRST inner select when fieldResolutions
  // is non-empty — the primitive needs the canonical's current field values to
  // capture them in the snapshot for undo. Tests that don't pass resolutions
  // leave this slot empty and the queue starts at kaRows.
  const innerSelectQueue: unknown[][] = [];
  if (opts.canonicalPreWrite !== undefined) {
    innerSelectQueue.push([opts.canonicalPreWrite]);
  }
  innerSelectQueue.push(
    opts.kaRows ?? [],
    opts.srPrimary ?? [],
    opts.srProcessed ?? [],
    [], // location_products
    [], // location_region_memberships
    [], // location_group_memberships
    [], // location_hotel_group_memberships
    [], // location_flags
    [], // action_items
  );

  type Captured = {
    auditInsertValues: Record<string, unknown> | null;
    snapshotInsertValues: Record<string, unknown> | null;
    /** Whatever `tx.update(locations).set(...)` got called with. */
    canonicalFieldUpdate: Record<string, unknown> | null;
    executeCalls: number;
  };
  const captured: Captured = {
    auditInsertValues: null,
    snapshotInsertValues: null,
    canonicalFieldUpdate: null,
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

  // Inner tx select — used by per-FK preselects + canonical pre-write read.
  // The canonical pre-write read uses .limit(1); the per-FK preselects don't.
  // We shape both via a chain that tolerates an optional `.limit()`.
  const makeInnerSelect = () => {
    const drainQueue = () => Promise.resolve(innerSelectQueue.shift() ?? []);
    return {
      from: () => ({
        where: () => {
          const wherePromise: Promise<unknown[]> & { limit?: () => Promise<unknown[]> } =
            drainQueue() as never;
          // `.limit()` is awaitable on its own — used by the canonical pre-write read.
          (wherePromise as { limit: () => Promise<unknown[]> }).limit = () =>
            // Already drained inside drainQueue() above — but the primitive's
            // canonical pre-write select chains .where().limit(1) without
            // awaiting the .where() in between, so the inner shift was the
            // correct row. Just re-resolve the same promise.
            wherePromise;
          return wherePromise;
        },
      }),
    };
  };

  const tx = {
    select: () => makeInnerSelect(),
    insert: (table: { _: { name: string } } | unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          // The merge primitive calls `.returning({id: ...})` on TWO inserts:
          // (1) the merge audit row, then (2) the snapshot row.
          if (captured.auditInsertValues === null) {
            captured.auditInsertValues = vals;
            return Promise.resolve([{ id: "merge-audit-id-fixture" }]);
          }
          captured.snapshotInsertValues = vals;
          return Promise.resolve([{ id: "snapshot-id-fixture" }]);
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          captured.canonicalFieldUpdate = vals;
          return Promise.resolve();
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

describe("applyLocationMerge — fieldResolutions lift (Plan 07-03 follow-up)", () => {
  const CANONICAL = "00000000-0000-0000-0000-000000000001";
  const DEF = "00000000-0000-0000-0000-00000000000d";

  it("writes resolved field values to the canonical row inside the tx, before FK rewrites", async () => {
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      canonicalPreWrite: {
        name: "Residence Inn — Canonical",
        address: "1 Old Address Rd",
        hotelGroup: "Old Group",
        starRating: 3,
        roomCount: 100,
        sourcedBy: "manual",
        status: "active",
        maintenanceFee: "100.00",
        customerCode: "CUST-1",
        locationGroup: "Group-A",
      },
    });

    await applyLocationMerge(
      CANONICAL,
      [DEF],
      ACTOR,
      db,
      { address: "2 New Address Ln", hotelGroup: "Marriott" },
    );

    expect(captured.canonicalFieldUpdate).not.toBeNull();
    // Only the resolved fields should be written — NOT every column the
    // dialog could have offered.
    expect(captured.canonicalFieldUpdate).toEqual({
      address: "2 New Address Ln",
      hotelGroup: "Marriott",
    });
  });

  it("captures pre-write canonical field values into snapshot.payload.canonical_field_changes", async () => {
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      canonicalPreWrite: {
        name: "Residence Inn — Canonical",
        address: "1 Old Address Rd",
        hotelGroup: "Old Group",
        starRating: 3,
        roomCount: 100,
        sourcedBy: "manual",
        status: "active",
        maintenanceFee: "100.00",
        customerCode: "CUST-1",
        locationGroup: "Group-A",
      },
    });

    await applyLocationMerge(
      CANONICAL,
      [DEF],
      ACTOR,
      db,
      { address: "2 New Address Ln", hotelGroup: "Marriott" },
    );

    const payload = captured.snapshotInsertValues!.payload as {
      archived_ids: string[];
      fk_changes: unknown[];
      canonical_field_changes?: {
        canonical_id: string;
        fields: Record<string, unknown>;
      };
    };
    expect(payload.canonical_field_changes).toBeDefined();
    expect(payload.canonical_field_changes!.canonical_id).toBe(CANONICAL);
    expect(payload.canonical_field_changes!.fields).toEqual({
      address: "1 Old Address Rd",
      hotelGroup: "Old Group",
    });
  });

  it("writes one action='update' audit row per resolved field with old/new values", async () => {
    vi.mocked(writeAuditLog).mockClear();
    const { db } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      canonicalPreWrite: {
        name: "Residence Inn — Canonical",
        address: "1 Old Address Rd",
        hotelGroup: "Old Group",
        starRating: 3,
        roomCount: 100,
        sourcedBy: "manual",
        status: "active",
        maintenanceFee: "100.00",
        customerCode: "CUST-1",
        locationGroup: "Group-A",
      },
    });

    await applyLocationMerge(
      CANONICAL,
      [DEF],
      ACTOR,
      db,
      { address: "2 New Address Ln", hotelGroup: "Marriott" },
    );

    const fieldUpdateCalls = vi
      .mocked(writeAuditLog)
      .mock.calls.filter(
        (c) =>
          (c[0] as { action: string }).action === "update" &&
          (c[0] as { entityType: string }).entityType === "location" &&
          (c[0] as { entityId: string }).entityId === CANONICAL,
      );
    expect(fieldUpdateCalls).toHaveLength(2);

    const byField: Record<string, (typeof fieldUpdateCalls)[number][0]> = {};
    for (const c of fieldUpdateCalls) {
      const e = c[0] as { field: string };
      byField[e.field] = c[0];
    }
    expect(byField.address).toMatchObject({
      action: "update",
      entityType: "location",
      entityId: CANONICAL,
      field: "address",
      oldValue: "1 Old Address Rd",
      newValue: "2 New Address Ln",
    });
    expect(byField.hotelGroup).toMatchObject({
      action: "update",
      entityType: "location",
      entityId: CANONICAL,
      field: "hotelGroup",
      oldValue: "Old Group",
      newValue: "Marriott",
    });
  });

  it("rejects field keys outside the locations whitelist (no canonical write, no audit row)", async () => {
    vi.mocked(writeAuditLog).mockClear();
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      canonicalPreWrite: {
        name: "Residence Inn — Canonical",
        address: "1 Old Address Rd",
      },
    });

    // `passwordHash` and `__proto__` are not on the merge-dialog's field list.
    await applyLocationMerge(
      CANONICAL,
      [DEF],
      ACTOR,
      db,
      {
        address: "2 New Address Ln",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        passwordHash: "evil" as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __proto__: { admin: true } as any,
      },
    );

    // Only the whitelisted key flowed through.
    expect(captured.canonicalFieldUpdate).toEqual({
      address: "2 New Address Ln",
    });
    const fieldUpdateCalls = vi
      .mocked(writeAuditLog)
      .mock.calls.filter(
        (c) => (c[0] as { action: string }).action === "update",
      );
    expect(fieldUpdateCalls).toHaveLength(1);
    expect((fieldUpdateCalls[0][0] as { field: string }).field).toBe("address");
  });

  it("does not write canonical_field_changes when fieldResolutions is empty/undefined", async () => {
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
    });

    await applyLocationMerge(CANONICAL, [DEF], ACTOR, db);

    expect(captured.canonicalFieldUpdate).toBeNull();
    const payload = captured.snapshotInsertValues!.payload as {
      canonical_field_changes?: unknown;
    };
    expect(payload.canonical_field_changes).toBeUndefined();
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
