import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { auditLogs } from "@/db/schema";
import {
  AUDIT_LOG_PAGE_SIZE,
  _listAuditLogFilterValuesForActor,
  _listAuditLogsForActor,
} from "@/app/(app)/settings/audit-log/pipeline";

/**
 * Integration tests for the audit-log viewer pipeline. The page is RSC-only
 * and doesn't go through any "use server" boundary — these tests drive the
 * pure pipeline helpers against a Testcontainers Postgres.
 *
 * Seed shape (5 rows): 2 location/set_location_type, 2 system/monday_import_triggered,
 * 1 user/create — three different actors so the actor distinct count tests
 * have something to lock onto.
 */
describe("audit-log viewer (pipeline)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  // Capture the createdAt of every seeded row so date-range tests can
  // reference exact boundaries instead of guessing from "now".
  let seededAt: { day1: Date; day2: Date; day3: Date };

  beforeEach(async () => {
    await ctx.db.delete(auditLogs);

    // Three distinct days, ordered oldest → newest. Pre-format as UTC
    // midnights so each row sits cleanly inside the day's window.
    seededAt = {
      day1: new Date("2026-04-10T10:00:00.000Z"),
      day2: new Date("2026-04-15T12:00:00.000Z"),
      day3: new Date("2026-04-20T14:00:00.000Z"),
    };

    await ctx.db.insert(auditLogs).values([
      {
        actorId: "user-alice",
        actorName: "Alice Admin",
        entityType: "location",
        entityId: "loc-1",
        entityName: "Hilton Mayfair",
        action: "set_location_type",
        field: "location_type",
        oldValue: null,
        newValue: "hotel",
        createdAt: seededAt.day1,
      },
      {
        actorId: "user-alice",
        actorName: "Alice Admin",
        entityType: "location",
        entityId: "loc-2",
        entityName: "Heathrow T5",
        action: "set_location_type",
        field: "location_type",
        oldValue: null,
        newValue: "airport",
        createdAt: seededAt.day2,
      },
      {
        actorId: "etl-actor",
        actorName: null,
        entityType: "system",
        entityId: "monday-import",
        entityName: null,
        action: "monday_import_triggered",
        field: null,
        oldValue: null,
        newValue: null,
        metadata: { hotelsCreated: 3, source: "monday-cron" },
        createdAt: seededAt.day2,
      },
      {
        actorId: "etl-actor",
        actorName: null,
        entityType: "system",
        entityId: "monday-import",
        entityName: null,
        action: "monday_import_triggered",
        field: null,
        oldValue: null,
        newValue: null,
        metadata: { hotelsCreated: 0, source: "manual" },
        createdAt: seededAt.day3,
      },
      {
        actorId: "user-bob",
        actorName: "Bob Member",
        entityType: "user",
        entityId: "user-charlie",
        entityName: "Charlie",
        action: "create",
        field: null,
        oldValue: null,
        newValue: null,
        createdAt: seededAt.day3,
      },
    ]);
  });

  test("with no filters returns all 5 rows ordered by createdAt desc", async () => {
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {});
    expect(totalCount).toBe(5);
    expect(rows).toHaveLength(5);

    // Newest → oldest: day3 (×2) ↓, day2 (×2) ↓, day1.
    const ts = rows.map((r) => r.createdAt.getTime());
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
    }
  });

  test("filter by entityType='location' returns 2 rows", async () => {
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      entityType: "location",
    });
    expect(totalCount).toBe(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.entityType).toBe("location");
    }
  });

  test("filter by actorId restricts to that actor's rows", async () => {
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      actorId: "etl-actor",
    });
    expect(totalCount).toBe(2);
    for (const row of rows) {
      expect(row.actorId).toBe("etl-actor");
      expect(row.action).toBe("monday_import_triggered");
    }
  });

  test("filter by action='set_location_type' returns 2 rows", async () => {
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      action: "set_location_type",
    });
    expect(totalCount).toBe(2);
    for (const row of rows) {
      expect(row.action).toBe("set_location_type");
    }
  });

  test("filter by date range returns the right subset", async () => {
    // Window: 2026-04-14 → 2026-04-16 (UTC). Spec uses next-day-exclusive
    // for `dateTo`, but the helper accepts inclusive timestamps directly,
    // so we set lte to 2026-04-16T23:59:59 to capture the full day-2 set.
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      dateFrom: new Date("2026-04-14T00:00:00.000Z"),
      dateTo: new Date("2026-04-16T00:00:00.000Z"),
    });
    expect(totalCount).toBe(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBe(seededAt.day2.getTime());
    }
  });

  test("filter by date range with single-day window picks up the rows on that day", async () => {
    // Just day3 — 2026-04-20 inclusive on both ends.
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      dateFrom: new Date("2026-04-20T00:00:00.000Z"),
      dateTo: new Date("2026-04-20T23:59:59.999Z"),
    });
    expect(totalCount).toBe(2);
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBe(seededAt.day3.getTime());
    }
  });

  test("combined filters narrow the result set further", async () => {
    // Alice's location/set_location_type rows on day2 → exactly 1.
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      entityType: "location",
      actorId: "user-alice",
      action: "set_location_type",
      dateFrom: new Date("2026-04-15T00:00:00.000Z"),
      dateTo: new Date("2026-04-15T23:59:59.999Z"),
    });
    expect(totalCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe("loc-2");
    expect(rows[0].entityName).toBe("Heathrow T5");
  });

  test("totalCount is independent of the page slice", async () => {
    // PAGE_SIZE is 100; 5 rows fit on one page, but totalCount should
    // still report 5 even when paging deeper would return zero.
    const { rows, totalCount } = await _listAuditLogsForActor(ctx.db, {
      page: 1,
    });
    expect(totalCount).toBe(5);
    expect(rows).toHaveLength(0);
    // Sanity: pageSize constant is exported and matches the on-the-wire
    // contract the client uses for pagination math.
    expect(AUDIT_LOG_PAGE_SIZE).toBe(100);
  });

  test("listFilterValues returns distinct entityTypes, actions, and actors", async () => {
    const opts = await _listAuditLogFilterValuesForActor(ctx.db);

    expect(opts.entityTypes).toEqual(["location", "system", "user"]);
    expect(opts.actions).toEqual([
      "create",
      "monday_import_triggered",
      "set_location_type",
    ]);

    // 3 distinct actorIds: alice, bob, etl-actor. etl-actor has null name —
    // pipeline.ts falls back to using the id as display name.
    const actorIds = opts.actors.map((a) => a.id).sort();
    expect(actorIds).toEqual(["etl-actor", "user-alice", "user-bob"]);
    const etl = opts.actors.find((a) => a.id === "etl-actor");
    expect(etl?.name).toBe("etl-actor");
    const alice = opts.actors.find((a) => a.id === "user-alice");
    expect(alice?.name).toBe("Alice Admin");
  });

  test("metadata round-trips through the row reader", async () => {
    const { rows } = await _listAuditLogsForActor(ctx.db, {
      action: "monday_import_triggered",
    });
    const withMeta = rows.find(
      (r) =>
        (r.metadata as { source?: string } | null)?.source === "monday-cron",
    );
    expect(withMeta).toBeDefined();
    expect((withMeta!.metadata as { hotelsCreated: number }).hotelsCreated).toBe(3);
  });
});
