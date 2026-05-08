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
  /** Captured `queryChunks` per execute call. Used by the composite-PK
   * regression test to inspect the WHERE clause of the membership UPDATE
   * (PR #36 review fix — the bug was "WHERE location_id <> previous_value"
   * matching every other location in the same region; the fix scopes by
   * "WHERE location_id = canonicalId"). */
  executeChunks: unknown[][];
  inserts: Array<{ values: Record<string, unknown> }>;
  updates: number;
  /** Number of `tx.select(...)` chain calls — used by the entityId-fallback
   * test to assert the merge audit row was looked up. */
  selects: number;
};

/**
 * Recursively walk a Drizzle `sql\`...\`` fragment's `queryChunks` array
 * and return every primitive value (strings, numbers, bound params) found.
 * Used to assert that a specific UUID appears in the WHERE clause of a
 * composite-PK UPDATE without coupling the test to drizzle's internal
 * fragment object shape.
 */
function collectChunkValues(chunks: unknown): unknown[] {
  if (chunks == null) return [];
  if (typeof chunks !== "object") return [chunks];
  if (Array.isArray(chunks)) {
    return chunks.flatMap(collectChunkValues);
  }
  const out: unknown[] = [];
  // Plain values from drizzle Param wrappers: `{ value }` or `{ encoder, value }`.
  if ("value" in chunks) {
    out.push((chunks as { value: unknown }).value);
  }
  // Identifier names: `{ name: "table" }`.
  if ("name" in chunks) {
    out.push((chunks as { name: unknown }).name);
  }
  // Nested SQL fragments expose `queryChunks`.
  if ("queryChunks" in chunks) {
    out.push(...collectChunkValues((chunks as { queryChunks: unknown }).queryChunks));
  }
  return out;
}

/**
 * Build a tx mock that replies to each `tx.execute(sql)` based on the SQL
 * fingerprint inferred from the call order:
 *   1. pg_advisory_xact_lock(738294108)  — returns {}
 *   2. SELECT … FOR UPDATE on snapshots — returns the configured snapshot rows
 *   3..N FK rewrites + DELETE snapshot — return {}
 *
 * `tx.select(...)` is also mocked — used by the post-PR #34 entityId
 * recovery path (lookup the merge audit row's entity_id to use as the
 * paired undo audit row's entityId). Returns
 * `[{ entityId: mergeAuditEntityId }]` if provided, else an empty array
 * (which exercises the legacy fallback to archivedIds[0] / snapshotId).
 */
function makeTx(
  snapshotRows: unknown[],
  mergeAuditEntityId?: string,
): {
  tx: unknown;
  calls: TxCalls;
} {
  const calls: TxCalls = {
    executes: [],
    executeChunks: [],
    inserts: [],
    updates: 0,
    selects: 0,
  };
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
      calls.executeChunks.push(frag.queryChunks ?? []);
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
    select: () => {
      calls.selects++;
      const drain = () =>
        Promise.resolve(
          mergeAuditEntityId !== undefined
            ? [{ entityId: mergeAuditEntityId }]
            : [],
        );
      return {
        from: () => ({
          where: () => ({ limit: drain }),
        }),
      };
    },
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

    // v3 snapshot: payload.canonical_id is set directly. No merge-audit
    // lookup needed (PR #36 review residual fix).
    const { tx, calls } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [ARCHIVED_1],
          fk_changes: [],
          canonical_id: CANONICAL,
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
    // entityId comes from payload.canonical_id (no audit-log lookup) so
    // the paired audit row points at the canonical, not a defunct.
    expect(calls.inserts[0].values.entityId).toBe(CANONICAL);
    // No tx.select on auditLogs — payload.canonical_id was authoritative.
    expect(calls.selects).toBe(0);
  });
});

describe("undoMerge — happy path", () => {
  it("reverses fk_changes, restores archived rows, writes paired audit row with canonical entityId, and deletes snapshot", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const ARCHIVED_1 = "00000000-0000-0000-0000-00000000bbbb";
    const CANONICAL = "00000000-0000-0000-0000-00000000eeee";
    const FK_CHANGE = {
      table: "kiosk_assignments",
      row_id: "00000000-0000-0000-0000-00000000cccc",
      fk_column: "location_id",
      previous_value: ARCHIVED_1,
    };

    // v3 snapshot: payload.canonical_id is set directly. mergeAuditEntityId
    // is NOT passed to the mock — undo should not even need the lookup.
    const { tx, calls } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [ARCHIVED_1],
          fk_changes: [FK_CHANGE],
          canonical_id: CANONICAL,
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

    // No tx.select on auditLogs — payload.canonical_id is the primary
    // source post-PR #36 residual fix. The audit-log lookup is now
    // exercised only by the legacy-snapshot test below.
    expect(calls.selects).toBe(0);

    // Paired audit row written with action='location_merge_undone' and
    // entityId pointing at the canonical (the row the merge mutated), NOT
    // a defunct id (legacy fallback) or the snapshot UUID (legacy fallback).
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].values).toMatchObject({
      action: "location_merge_undone",
      entityType: "location",
      entityId: CANONICAL,
    });
    const meta = calls.inserts[0].values.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      snapshotId: SNAP_ID,
      fkChangesReversed: 1,
    });
  });

  it("falls back to merge audit row lookup when payload.canonical_id is missing (legacy v2 snapshot)", async () => {
    // Backward-compat path: a snapshot written by pre-v3 code (payload
    // has archived_ids + fk_changes but no canonical_id). undoMerge
    // recovers canonicalId via tx.select on audit_logs. This path was
    // the primary in the previous review pass and is now the fallback.
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const ARCHIVED_1 = "00000000-0000-0000-0000-00000000bbbb";
    const CANONICAL = "00000000-0000-0000-0000-00000000eeee";

    const { tx, calls } = makeTx(
      [
        {
          id: SNAP_ID,
          audit_log_id: "00000000-0000-0000-0000-00000000dddd",
          payload: {
            archived_ids: [ARCHIVED_1],
            fk_changes: [],
            // canonical_id intentionally omitted — legacy v2 snapshot.
          },
          created_at: "2026-05-06T00:00:00Z",
        },
      ],
      CANONICAL, // mergeAuditEntityId returns this from tx.select
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge(SNAP_ID);
    expect(result).toEqual({ success: true });
    expect(calls.selects).toBe(1); // audit-log lookup ran
    expect(calls.inserts[0].values.entityId).toBe(CANONICAL);
  });

  it("throws when payload.canonical_id is missing AND merge audit row is missing", async () => {
    // Both identity sources unavailable: pre-v3 snapshot whose
    // audit_logs row was deleted out-of-band. The previous fallback
    // chain would have silently used archivedIds[0] (a defunct UUID,
    // semantically wrong) as canonicalId — the composite-PK UPDATE
    // would have no-op'd and the audit row would have a defunct id as
    // its entityId. Post-fix: throw a precise error so the operator
    // knows to investigate the audit log instead of believing undo
    // succeeded.
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const ARCHIVED_1 = "00000000-0000-0000-0000-00000000bbbb";

    const { tx } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [ARCHIVED_1],
          fk_changes: [],
          // canonical_id missing
        },
        created_at: "2026-05-06T00:00:00Z",
      },
    ]); // mergeAuditEntityId omitted → tx.select returns []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge(SNAP_ID);
    expect(result).toMatchObject({
      error: expect.stringContaining("cannot recover canonical_id"),
    });
  });
});

describe("undoMerge — composite-PK WHERE clause (PR #36 review fix)", () => {
  it("scopes the membership UPDATE by canonicalId, not by 'location_id <> previous_value'", async () => {
    // Bug: the previous WHERE clause matched every non-defunct row sharing
    // the join-side id (e.g. every other location in UK region), then the
    // SET tried to make them all share a single (location_id, region_id)
    // tuple → UNIQUE/PK violation. Fix scopes by the canonical id (the
    // value the merge wrote) so the UPDATE matches exactly the row(s)
    // THIS merge changed. This test asserts the new WHERE shape contains
    // the canonical id as a parameter — independent of any specific SQL
    // string format drizzle picks.
    vi.mocked(requireRole).mockResolvedValueOnce(ADMIN_SESSION as never);

    const SNAP_ID = "00000000-0000-0000-0000-00000000aaaa";
    const DEFUNCT = "00000000-0000-0000-0000-00000000bbbb";
    const CANONICAL = "00000000-0000-0000-0000-00000000eeee";
    const REGION = "00000000-0000-0000-0000-00000000ffff";

    const FK_CHANGE = {
      table: "location_region_memberships",
      row_id: `${DEFUNCT}|${REGION}`, // composite-PK: "<locationId>|<otherId>"
      fk_column: "location_id",
      previous_value: DEFUNCT,
    };

    // v3 snapshot — payload.canonical_id is the primary identity source.
    const { tx, calls } = makeTx([
      {
        id: SNAP_ID,
        audit_log_id: "00000000-0000-0000-0000-00000000dddd",
        payload: {
          archived_ids: [DEFUNCT],
          fk_changes: [FK_CHANGE],
          canonical_id: CANONICAL,
        },
        created_at: "2026-05-06T00:00:00Z",
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.transaction).mockImplementationOnce(((cb: any) =>
      cb(tx)) as never);

    const result = await undoMerge(SNAP_ID);
    expect(result).toEqual({ success: true });

    // The composite-PK UPDATE is the third execute call (after lock +
    // select-snapshot). Inspect its queryChunks — the canonical id MUST
    // appear as a bound parameter (the WHERE clause now scopes by it).
    const compositeUpdateChunks = calls.executeChunks[2];
    const values = collectChunkValues(compositeUpdateChunks);

    // Canonical id is in the WHERE: location_id = ${canonicalId}::uuid.
    expect(values).toContain(CANONICAL);
    // Region id is the join-side scope: region_id = ${encOtherId}::uuid.
    expect(values).toContain(REGION);
    // Defunct id is the SET target: location_id = ${previous_value}::uuid.
    expect(values).toContain(DEFUNCT);
    // Identifier names tell us which table we hit.
    expect(values).toContain("location_region_memberships");
    expect(values).toContain("region_id");
  });
});
