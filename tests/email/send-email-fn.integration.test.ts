import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: Resend mock must be available before the SUT module imports
// `Resend` at module scope. Factory uses a regular function so `new Resend()`
// can construct.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

// db is REAL (Testcontainers) — point @/db at our test ctx.db once setup
// completes. We swap the binding via vi.mock with a getter so the real
// ctx is wired in beforeAll.
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { emailLog } from "@/db/schema";
import { _handleSendEmail } from "@/inngest/functions/send-email";

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// In-process step shim — runs each step.run callback immediately. We don't
// exercise Inngest's retry/memoisation in this test (those are SDK-level
// behaviours covered by Inngest's own test suite); we exercise the
// handler's three boundaries against a real Postgres + a mocked Resend.
function makeStepShim() {
  return {
    run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
  };
}

describe("send-email Inngest function (EMAIL-04)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@command.weknowgroup.com";
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    sendMock.mockReset();
    await ctx.db.delete(emailLog);
  });

  it("password_changed event with valid template -> writes one sent row to email_log", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "msg-abc" }, error: null });

    await _handleSendEmail({
      event: {
        data: {
          kind: "password_changed",
          to: "user@example.com",
          subject: "Your WeKnow password was changed",
          template: "password-changed",
          templateProps: {
            changedAt: "2026-05-09 11:42 BST",
            contactAdminUrl: "mailto:admin@weknow.co",
          },
        },
      },
      step: makeStepShim(),
      runId: "run-001",
    });

    const rows = await ctx.db.select().from(emailLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("password_changed");
    expect(rows[0].recipient).toBe("user@example.com");
    expect(rows[0].resendMessageId).toBe("msg-abc");
    expect(rows[0].inngestRunId).toBe("run-001");
    expect(rows[0].status).toBe("sent");
  });

  it("simulated Resend 5xx -> writes one failed row + handler throws", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "internal_server_error" },
    });

    await expect(
      _handleSendEmail({
        event: {
          data: {
            kind: "password_changed",
            to: "user@example.com",
            subject: "Your WeKnow password was changed",
            template: "password-changed",
            templateProps: {
              changedAt: "2026-05-09 11:42 BST",
              contactAdminUrl: "mailto:admin@weknow.co",
            },
          },
        },
        step: makeStepShim(),
        runId: "run-002",
      }),
    ).rejects.toThrow("internal_server_error");

    const rows = await ctx.db.select().from(emailLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].lastError).toBe("internal_server_error");
    expect(rows[0].resendMessageId).toBeNull();
    expect(rows[0].inngestRunId).toBe("run-002");
  });

  it("two events with same (kind, payloadHash) -> only one row inserted (idempotency)", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "msg-1" }, error: null });
    sendMock.mockResolvedValueOnce({ data: { id: "msg-2" }, error: null });

    const event = {
      data: {
        kind: "digest_daily",
        to: "ops@weknow.co",
        subject: "Daily digest",
        template: "password-changed", // reuse the only registered template
        templateProps: {
          changedAt: "n/a",
          contactAdminUrl: "mailto:admin@weknow.co",
        },
        payloadHash: "sha256-digest-2026-05-09",
      },
    };

    await _handleSendEmail({
      event,
      step: makeStepShim(),
      runId: "run-101",
    });
    await _handleSendEmail({
      event,
      step: makeStepShim(),
      runId: "run-102",
    });

    const rows = await ctx.db.select().from(emailLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].payloadHash).toBe("sha256-digest-2026-05-09");
  });
});
