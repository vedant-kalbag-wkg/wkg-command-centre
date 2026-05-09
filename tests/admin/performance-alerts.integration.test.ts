import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: inngest mock must be hoisted before SUT imports `inngest` at module scope.
const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSendMock },
}));

// requireRole mock — default resolves to admin session; override per-test for Forbidden case.
const { requireRoleMock } = vi.hoisted(() => ({ requireRoleMock: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  requireRole: requireRoleMock,
}));

// db is REAL (Testcontainers) — swap via getter so beforeAll can wire ctx.db.
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { eq, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { triggerRunNow } from "@/app/(app)/admin/performance-alerts/actions";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

const ADMIN_SESSION = {
  user: {
    id: "usr-admin-001",
    name: "Test Admin",
    email: "admin@weknow.co",
    role: "admin",
  },
  session: { id: "sess-001", userId: "usr-admin-001", expiresAt: new Date() },
};

describe("performance-alerts admin action (09-05)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    inngestSendMock.mockReset();
    inngestSendMock.mockResolvedValue({ ids: [] });
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue(ADMIN_SESSION);
    // Clear audit_logs between tests so rate-limit checks start clean.
    await ctx.db
      .delete(auditLogs)
      .where(eq(auditLogs.entityType, "performance_alert_run"));
  });

  it("triggerRunNow throws Forbidden for non-admin sessions", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(triggerRunNow()).rejects.toThrow("Forbidden");
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("triggerRunNow emits inngest event + writes audit row for admin sessions", async () => {
    const result = await triggerRunNow();

    expect(result).toEqual({ ok: true });

    // Inngest called once with correct event name + idempotency key shape.
    expect(inngestSendMock).toHaveBeenCalledOnce();
    const sentEvent = inngestSendMock.mock.calls[0][0];
    expect(sentEvent.name).toBe("performance-alerts/run.requested");
    expect(sentEvent.id).toMatch(/^performance-alerts-manual-usr-admin-001-\d+$/);
    expect(sentEvent.data.actorId).toBe("usr-admin-001");
    expect(sentEvent.data.actorName).toBe("Test Admin");

    // Audit row written to real DB.
    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "performance_alert_run"));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("trigger");
    expect(rows[0].actorId).toBe("usr-admin-001");
    expect(rows[0].actorName).toBe("Test Admin");
    expect(rows[0].entityName).toBe("Manual run trigger");
  });

  it("triggerRunNow rate-limits a second call within 5 minutes", async () => {
    // Seed an audit row with createdAt = NOW() (simulates a very recent run).
    await ctx.db.insert(auditLogs).values({
      actorId: "usr-admin-001",
      actorName: "Test Admin",
      entityType: "performance_alert_run",
      entityId: "manual-seed",
      entityName: "Manual run trigger",
      action: "trigger",
      createdAt: new Date(),
    });

    const result = await triggerRunNow();

    expect(result).toMatchObject({ ok: false, error: "Rate limited" });
    expect((result as { minutesRemaining?: number }).minutesRemaining).toBeGreaterThan(0);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("triggerRunNow proceeds when the most recent audit row is older than 5 minutes", async () => {
    // Seed an audit row with createdAt = 10 minutes ago.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await ctx.db.insert(auditLogs).values({
      actorId: "usr-admin-001",
      actorName: "Test Admin",
      entityType: "performance_alert_run",
      entityId: "manual-old",
      entityName: "Manual run trigger",
      action: "trigger",
      createdAt: tenMinAgo,
    });

    const result = await triggerRunNow();

    expect(result).toEqual({ ok: true });
    expect(inngestSendMock).toHaveBeenCalledOnce();
  });
});
