/**
 * Unit tests for undoMerge — Phase 7 Plan 07-03 (DATA-02 D-05).
 *
 * Mocks the auth + tx surface to exercise:
 *   - happy path: returns {success:true} AND snapshot DELETE was issued AND
 *     a paired audit row of action='location_merge_undone' was inserted.
 *   - already-undone path: SELECT FOR UPDATE returns no rows ⇒ envelope
 *     {error: 'snapshot_already_undone'}.
 *   - non-admin: requireRole throws ⇒ error envelope.
 *
 * The full SQL semantics (transaction rollback, advisory-xact-lock blocking
 * a concurrent forward-merge) are covered by Plan E's UAT integration run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { undoMerge } from "./undo-merge";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";

const ADMIN_SESSION = {
  user: { id: "admin-1", name: "Test Admin", email: "admin@weknow.co" },
};

type TxCalls = {
  executes: string[];
  inserts: Array<{ values: Record<string, unknown> }>;
  updates: number;
};

/**
 * Build a tx mock that replies to each `tx.execute(sql)` based on the SQL
 * fingerprint inferred from the call order:
 *   1. pg_advisory_xact_lock(738294108)  — returns {}
 *   2. SELECT … FOR UPDATE on snapshots — returns the configured snapshot rows
 *   3..N FK rewrites + DELETE snapshot — return {}
 */
function makeTx(snapshotRows: unknown[]): {
  tx: unknown;
  calls: TxCalls;
} {
  const calls: TxCalls = { executes: [], inserts: [], updates: 0 };
  let executeCount = 0;
  const tx = {
    execute: (frag: { queryChunks?: unknown[]; toString?: () => string }) => {
      executeCount++;
      // Stash a stringified marker per call so the test can assert ordering.
      const marker =
        executeCount === 1
          ? "lock"
          : executeCount === 2
            ? "select-snapshot"
            : "other";
      calls.executes.push(marker);
      if (executeCount === 2) {
        return Promise.resolve({ rows: snapshotRows });
      }
      return Promise.resolve({ rowCount: 1 });
    },
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        calls.inserts.push({ values: vals });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          calls.updates++;
          return Promise.resolve();
        },
      }),
    }),
  };
  return { tx, calls };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(db.transaction).mockReset();
});

describe("undoMerge — RBAC gate", () => {
  it("returns error envelope when requireRole throws", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    const result = await undoMerge("00000000-0000-0000-0000-00000000aaaa");
    expect(result).toEqual({ error: "Forbidden" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("undoMerge — already-undone path", () => {
  it("returns snapshot_already_undone when SELECT FOR UPDATE finds no row", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);
    const { tx, calls } = makeTx([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge("00000000-0000-0000-0000-00000000aaaa");
    expect(result).toEqual({ error: "snapshot_already_undone" });

    // Lock acquired, snapshot SELECT issued; no inserts / updates.
    expect(calls.executes[0]).toBe("lock");
    expect(calls.executes[1]).toBe("select-snapshot");
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toBe(0);
  });
});

describe("undoMerge — canonical_field_changes restore (Plan 07-03 follow-up)", () => {
  it("restores pre-write canonical field values when snapshot includes canonical_field_changes", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const ARCHIVED_1 = "00000000-0000-0000-0000-00000000bbbb";
    const CANONICAL = "00000000-0000-0000-0000-00000000eeee";

    const { tx, calls } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [ARCHIVED_1],
          fk_changes: [],
          canonical_field_changes: {
            canonical_id: CANONICAL,
            fields: {
              address: "1 Old Address Rd",
              hotelGroup: "Old Group",
            },
          },
        },
        created_at: "2026-05-06T00:00:00Z",
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge(SNAP_ID);
    expect(result).toEqual({ success: true });

    // 2 update calls expected:
    //   1. the canonical-field-restore (set address+hotelGroup back)
    //   2. the archived_at = NULL restore on the archived rows
    expect(calls.updates).toBe(2);

    // The paired audit row's metadata should record the restored field count.
    expect(calls.inserts).toHaveLength(1);
    const meta = calls.inserts[0].values.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      snapshotId: SNAP_ID,
      canonicalFieldsRestored: 2,
    });
  });
});

describe("undoMerge — happy path", () => {
  it("reverses fk_changes, restores archived rows, writes paired audit row, and deletes snapshot", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const ARCHIVED_1 = "00000000-0000-0000-0000-00000000bbbb";
    const FK_CHANGE = {
      table: "kiosk_assignments",
      row_id: "00000000-0000-0000-0000-00000000cccc",
      fk_column: "location_id",
      previous_value: ARCHIVED_1,
    };

    const { tx, calls } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [ARCHIVED_1],
          fk_changes: [FK_CHANGE],
        },
        created_at: "2026-05-06T00:00:00Z",
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge(SNAP_ID);
    expect(result).toEqual({ success: true });

    // Lock + select-snapshot + 1 fk-rewrite + 1 snapshot-delete = 4 executes.
    expect(calls.executes).toHaveLength(4);
    expect(calls.executes[0]).toBe("lock");
    expect(calls.executes[1]).toBe("select-snapshot");

    // Restoration of archived rows happens via the drizzle update builder.
    expect(calls.updates).toBe(1);

    // Paired audit row written with action='location_merge_undone'.
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].values).toMatchObject({
      action: "location_merge_undone",
      entityType: "location",
      entityId: ARCHIVED_1,
    });
    const meta = calls.inserts[0].values.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      snapshotId: SNAP_ID,
      fkChangesReversed: 1,
    });
  });
});
