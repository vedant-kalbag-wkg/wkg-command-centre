/**
 * Phase 9.1 Plan 09 — Gap 1 closure: send-email plain-text dispatch.
 *
 * Drives `_handleSendEmail` directly with a step-shim, asserts:
 *   - kind=fx_rate_fetch_failed → resolves via the new `template === "plain-text"`
 *     sentinel branch, body contains the kind-specific subject keywords +
 *     templateProps values, Resend.emails.send is invoked once.
 *   - kind=fx_rate_stale → same shape with the stale templateProps shape.
 *   - kind=<unknown> with template=plain-text → throws with a kind-naming error.
 *
 * Mirrors tests/inngest/fx-rates-fetch-daily.integration.test.ts for the
 * vi.hoisted + vi.mock("@/db") + Testcontainers shape, plus a vi.mock("resend")
 * for the outbound transport (we don't want to hit a real Resend endpoint).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// vi.hoisted — must run before SUT imports `@/db` / `resend` at module scope.
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(async () => ({ data: { id: "msg_test" }, error: null })),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: mockSend } };
  }),
}));

let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { sql } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";

import { _handleSendEmail } from "@/inngest/functions/send-email";

type SendEmailEvent = Parameters<typeof _handleSendEmail>[0]["event"];
type SendEmailStep = Parameters<typeof _handleSendEmail>[0]["step"];

// Minimal step-shim: real Inngest memoises across retries; for unit-of-handler
// drive once.
const step: SendEmailStep = {
  run: async <T,>(_name: string, fn: () => Promise<T>) => fn(),
};

describe("send-email plain-text dispatch (Phase 9.1 Gap 1 fix)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    // RESEND_API_KEY is required by the lazy Resend constructor; the resend
    // mock above intercepts before any HTTP call.
    process.env.RESEND_API_KEY ??= "re_test_key";
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    mockSend.mockClear();
    mockSend.mockImplementation(async () => ({
      data: { id: "msg_test" },
      error: null,
    }));
    // Clear email_log between specs so payload_hash uniqueness assertions
    // start fresh (the partial unique idx swallows duplicates by design).
    await ctx.db.execute(sql`TRUNCATE TABLE email_log`);
  });

  it("dispatches kind=fx_rate_fetch_failed via plain-text and invokes Resend with a real text body", async () => {
    const event: SendEmailEvent = {
      data: {
        kind: "fx_rate_fetch_failed",
        to: "test@example.com",
        subject: "FX rates daily fetch failed (2026-05-09)",
        template: "plain-text",
        templateProps: {
          reason: "BoE 503 Service Unavailable",
          isoDate: "2026-05-09",
          runId: "test-run",
        },
        payloadHash: "fx_rate_fetch_failed:2026-05-09:test-run",
      },
    };

    await _handleSendEmail({ event, step, runId: "test-run" });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = (
      mockSend.mock.calls[0] as unknown as Array<{
        text: string;
        html: string;
        subject: string;
        to: string;
      }>
    )[0];
    expect(callArg.text).toContain("FX rates daily fetch failed");
    expect(callArg.text).toContain("BoE 503 Service Unavailable");
    expect(callArg.text).toContain("2026-05-09");
    expect(callArg.text).toContain("test-run");
    // HTML pre-wrap fallback for HTML-only clients.
    expect(callArg.html).toContain("<pre");
    expect(callArg.html).toContain("FX rates daily fetch failed");
    expect(callArg.subject).toBe("FX rates daily fetch failed (2026-05-09)");
    expect(callArg.to).toBe("test@example.com");
  });

  it("dispatches kind=fx_rate_stale via plain-text and invokes Resend", async () => {
    const event: SendEmailEvent = {
      data: {
        kind: "fx_rate_stale",
        to: "test@example.com",
        subject: "Sales ETL halted: stale FX rate for USD",
        template: "plain-text",
        templateProps: {
          currency: "USD",
          transactionDate: "2026-05-09",
          staleDays: 8,
          blobPath: "uk/2026/05/09/sales.csv",
          importId: "import-123",
        },
        payloadHash: "fx_rate_stale:USD:2026-05-09:uk/2026/05/09/sales.csv",
      },
    };

    await _handleSendEmail({ event, step, runId: "test-run-2" });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = (
      mockSend.mock.calls[0] as unknown as Array<{ text: string }>
    )[0];
    expect(callArg.text).toContain("stale FX rate for USD");
    expect(callArg.text).toContain("USD");
    expect(callArg.text).toContain("8");
    expect(callArg.text).toContain("uk/2026/05/09/sales.csv");
    expect(callArg.text).toContain("import-123");
  });

  it("throws on plain-text with unknown kind, naming the kind in the error", async () => {
    const event: SendEmailEvent = {
      data: {
        kind: "totally_unknown_kind",
        to: "test@example.com",
        subject: "x",
        template: "plain-text",
        templateProps: {},
      },
    };

    await expect(
      _handleSendEmail({ event, step, runId: "test-run-3" }),
    ).rejects.toThrow(/Unknown plain-text email kind: totally_unknown_kind/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
