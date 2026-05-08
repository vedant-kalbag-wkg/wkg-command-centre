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
  /**
   * Defunct ids that the pre-archive Step B.5 select should report as
   * `archived_at IS NULL` (i.e. they will be stamped by Step D's archive
   * UPDATE and therefore belong in `payload.archived_ids`). Defaults to
   * empty — tests that exercise the snapshot must opt-in explicitly so the
   * archived_ids subset is verifiable.
   */
  preArchiveIds?: string[];
  /**
   * Whether the transaction-scoped `pg_try_advisory_xact_lock` should
   * report acquired (true) or in-contention (false). Defaults to true so
   * existing tests pass through the lock unchanged. The contention test
   * sets this to false.
   */
  lockAcquired?: boolean;
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
  // applyLocationMerge order (Phase 07-06):
  //   1. SELECT {id} FROM locations INNER JOIN regions ... WHERE name=LOCATION_NEEDED AND code=GLOBAL LIMIT 1
  //      (via getSentinelLocationId — uses .innerJoin in the chain)
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
    // Step B.5 — pre-archive check: rows where archived_at IS NULL among
    // the input defunctIds. The primitive uses this to scope archived_ids
    // in the snapshot payload to ONLY the rows that will actually be
    // stamped by Step D's archive UPDATE (fix from PR #34 review).
    (opts.preArchiveIds ?? []).map((id) => ({ id })),
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
  // Phase 07-06: the sentinel resolution now joins through `regions`, so the
  // chain for that call is select().from().innerJoin().where().limit(). The
  // canonical-name select stays select().from().where().limit(). We expose
  // both shapes by making `.from()` return an object that has BOTH
  // `.innerJoin()` and `.where()` — the chain ultimately funnels into the
  // same `outerSelectQueue.shift()` regardless of branch.
  const makeOuterSelect = () => {
    const drain = () => Promise.resolve(outerSelectQueue.shift() ?? []);
    const whereChain = () => ({ limit: drain });
    return {
      from: () => ({
        where: whereChain,
        innerJoin: () => ({ where: whereChain }),
      }),
    };
  };

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
      // Also carries `rows: [{ lock }]` so the FIRST execute (Step 0's
      // pg_try_advisory_xact_lock parse) reads acquired vs contention from
      // the same shape. Subsequent execute calls (the per-table UPDATE
      // statements in Step D) read rowCount and ignore the rows field.
      const lockAcquired = opts.lockAcquired ?? true;
      return Promise.resolve({ rowCount: 0, rows: [{ lock: lockAcquired }] });
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
      // Both defuncts currently `archived_at IS NULL` — Step D will stamp
      // both, so the snapshot's archived_ids must list both for undo.
      preArchiveIds: [DEF1, DEF2],
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
      preArchiveIds: [DEF],
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
      preArchiveIds: [DEF],
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
      preArchiveIds: [DEF],
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
  it("writes no snapshot when no FK rows match AND every defunct is already archived", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF = "00000000-0000-0000-0000-00000000000d";
    // No FK rows in any preselect; every UPDATE returns rowCount=0.
    // preArchiveIds defaults to [] → Step B.5 reports zero rows to archive.
    const { db, captured } = buildMockDb();

    const result = await applyLocationMerge(CANONICAL, [DEF], ACTOR, db);

    expect(result.kioskAssignmentsRewritten).toBe(0);
    expect(result.salesRecordsRewritten).toBe(0);
    expect(result.locationsArchived).toBe(0);
    // Post-fix (PR #34 review): when both `fk_changes` and `idsToArchive`
    // are empty, the snapshot guard short-circuits and no snapshot row is
    // written. undoMerge would have nothing to do anyway, so skipping the
    // snapshot keeps the storage clean.
    expect(result.snapshotId).toBeNull();
    expect(captured.snapshotInsertValues).toBeNull();
    expect(result.fkChangeCount).toBe(0);
  });
});

describe("applyLocationMerge — pre-archive filter (PR #34 review fix)", () => {
  it("excludes pre-archived defuncts from snapshot.archived_ids so undo cannot un-archive them", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF_LIVE = "00000000-0000-0000-0000-00000000000d";
    const DEF_PREARCHIVED = "00000000-0000-0000-0000-00000000000e";

    // Both defuncts have FK rows pointing at them (the merge will rewrite
    // the FKs regardless), but only DEF_LIVE is `archived_at IS NULL`.
    // DEF_PREARCHIVED was archived BEFORE this merge began — Step D's
    // archive UPDATE will skip it, and the snapshot's archived_ids must
    // also exclude it so undo's `archived_at = NULL` restore doesn't
    // resurrect a row that should have stayed archived.
    const { db, captured } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      kaRows: [
        { id: "ka-1", locationId: DEF_LIVE },
        { id: "ka-2", locationId: DEF_PREARCHIVED },
      ],
      preArchiveIds: [DEF_LIVE], // ONLY the unarchived one
    });

    const result = await applyLocationMerge(
      CANONICAL,
      [DEF_LIVE, DEF_PREARCHIVED],
      ACTOR,
      db,
    );

    const payload = captured.snapshotInsertValues!.payload as {
      archived_ids: string[];
      fk_changes: FkChange[];
    };
    // Critical assertion: pre-archived defunct is NOT in archived_ids,
    // even though it was passed in defunctIds and had FK rows rewritten.
    expect(payload.archived_ids).toEqual([DEF_LIVE]);
    expect(payload.archived_ids).not.toContain(DEF_PREARCHIVED);

    // FK changes still capture both rows — Step D rewrites FKs for both
    // regardless of archive state, and undo restores both FKs.
    expect(payload.fk_changes).toHaveLength(2);
    expect(result.snapshotId).toBe("snapshot-id-fixture");
  });

  it("writes no snapshot when every defunct is pre-archived and no FK rows exist", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF = "00000000-0000-0000-0000-00000000000d";
    // No FK rows; defunct already archived → preArchiveIds defaults to [].
    const { db, captured } = buildMockDb();

    const result = await applyLocationMerge(CANONICAL, [DEF], ACTOR, db);

    expect(result.snapshotId).toBeNull();
    expect(captured.snapshotInsertValues).toBeNull();
  });
});

describe("applyLocationMerge — advisory lock (PR #34 review fix)", () => {
  it("throws LOCATION_MERGE_LOCK_CONTENTION when pg_try_advisory_xact_lock returns false", async () => {
    const CANONICAL = "00000000-0000-0000-0000-000000000001";
    const DEF = "00000000-0000-0000-0000-00000000000d";
    // The merge primitive's first execute call inside the tx is
    // pg_try_advisory_xact_lock; the mock returns lock=false to simulate
    // a concurrent merge / undo holding the lock.
    const { db } = buildMockDb({
      canonicalName: "Residence Inn — Canonical",
      lockAcquired: false,
    });

    await expect(
      applyLocationMerge(CANONICAL, [DEF], ACTOR, db),
    ).rejects.toThrow("location_merge_lock_contention");
  });
});
