import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importing the helper FIRST runs its top-level `vi.mock("resend", ...)`
// before the unit-under-test (./email) is imported, so the unit picks up
// the mocked Resend class. Order matters here.
import {
  getResendSendMock,
  mockResendFailure,
  mockResendSuccess,
  resetResendMock,
} from "./__tests__/helpers/mock-resend";

// Mock the db before importing the unit under test (which imports db
// at module scope). `vi.mock` is hoisted above all imports by Vitest,
// so the factory must not reference outer-scope variables — use
// `vi.hoisted` to declare the shared mock before the hoisted vi.mock.
//
// Each insert() call returns a FRESH `values` mock so per-test calls
// don't bleed into mock.calls[] of subsequent tests (insertMock.mockClear()
// would not clear the inner values mock if it were shared).
const { insertMock } = vi.hoisted(() => {
  const insertMock = vi.fn();
  insertMock.mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  return { insertMock };
});
vi.mock("@/db", () => ({
  db: { insert: insertMock },
}));
vi.mock("@/db/schema", () => ({ emailLog: { __table: "email_log" } }));

import {
  sendExternalInviteEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "./email";

describe("email transport (EMAIL-01)", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@command.weknowgroup.com";
    resetResendMock();
    insertMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sendPasswordResetEmail success: calls Resend with correct args + logs sent row", async () => {
    mockResendSuccess({ id: "msg-1" });
    await sendPasswordResetEmail({
      to: "user@example.com",
      resetUrl: "https://app/reset?t=abc",
    });
    const sendMock = getResendSendMock();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe("noreply@command.weknowgroup.com");
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toBe("Reset your password — WeKnow");
    expect(typeof call.html).toBe("string");
    expect(call.html).toContain("Reset your password");
    expect(typeof call.text).toBe("string");
    expect(call.react).toBeUndefined();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.results[0].value.values.mock.calls[0][0];
    expect(inserted.kind).toBe("password_reset");
    expect(inserted.recipient).toBe("user@example.com");
    expect(inserted.resendMessageId).toBe("msg-1");
    expect(inserted.status).toBe("sent");
    expect(inserted.payloadHash).toBeNull();
    expect(inserted.inngestRunId).toBeNull();
  });

  it("sendPasswordResetEmail failure: logs failed row + throws Error with rate_limited message", async () => {
    mockResendFailure({ message: "rate_limited" });
    await expect(
      sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app/reset?t=abc",
      }),
    ).rejects.toThrow("Email send failed: rate_limited");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.results[0].value.values.mock.calls[0][0];
    expect(inserted.status).toBe("failed");
    expect(inserted.lastError).toBe("rate_limited");
    expect(inserted.resendMessageId).toBeNull();
  });

  it("sendInviteEmail uses internal invite subject + kind", async () => {
    mockResendSuccess();
    await sendInviteEmail({
      to: "new@example.com",
      resetUrl: "https://app/set?invite=1&t=xyz",
    });
    const call = getResendSendMock().mock.calls[0][0];
    expect(call.subject).toBe("You're invited to WeKnow — Set your password");
    const inserted = insertMock.mock.results[0].value.values.mock.calls[0][0];
    expect(inserted.kind).toBe("invite");
  });

  it("sendExternalInviteEmail uses analytics-portal subject + kind", async () => {
    mockResendSuccess();
    await sendExternalInviteEmail({
      to: "ext@example.com",
      setPasswordUrl: "https://app/set?invite=1&t=xyz",
    });
    const call = getResendSendMock().mock.calls[0][0];
    expect(call.subject).toBe(
      "Welcome to WeKnow Analytics — Set your password",
    );
    const inserted = insertMock.mock.results[0].value.values.mock.calls[0][0];
    expect(inserted.kind).toBe("external_invite");
  });
});
