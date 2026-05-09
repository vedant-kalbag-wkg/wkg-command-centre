import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 Plan 08-02 — Unit tests for POST /api/account/password-changed
// (EMAIL-02 + EMAIL-04 substrate exercise).
//
// Mocks must run before importing ./route — vitest hoists vi.mock above
// imports automatically; vi.hoisted gives us a shared ref to the inner mocks.
const { sendMock, getSessionMock, dbLimitMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ ids: ["mock-evt-1"] }),
  getSessionMock: vi.fn(),
  dbLimitMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: sendMock },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: dbLimitMock }),
        }),
      }),
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { POST } from "./route";

describe("POST /api/account/password-changed (EMAIL-02 + EMAIL-04)", () => {
  beforeEach(() => {
    sendMock.mockClear();
    getSessionMock.mockReset();
    dbLimitMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorised" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fires inngest.send with the locked password_changed event shape", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "user@example.com", id: "u1", name: "User" },
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.name).toBe("email/send.requested");
    expect(arg.data.kind).toBe("password_changed");
    expect(arg.data.to).toBe("user@example.com");
    expect(arg.data.subject).toBe("Your WeKnow password was changed");
    expect(arg.data.template).toBe("password-changed");
    expect(arg.data.templateProps.contactAdminUrl).toBe(
      "mailto:vedant.kalbag@weknowgroup.com",
    );
    expect(typeof arg.data.templateProps.changedAt).toBe("string");
    expect(arg.data.templateProps.changedAt.length).toBeGreaterThan(0);
  });

  it("returns 429 when a password_changed email was sent within the cooldown window (T-08.02-01)", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "user@example.com", id: "u1", name: "User" },
    });
    // Recent send 5s ago — well inside the 30s cooldown.
    dbLimitMock.mockResolvedValueOnce([
      { createdAt: new Date(Date.now() - 5_000) },
    ]);

    const res = await POST();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("proceeds when the most recent send is older than the cooldown window", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "user@example.com", id: "u1", name: "User" },
    });
    // 60s ago — outside the 30s cooldown.
    dbLimitMock.mockResolvedValueOnce([
      { createdAt: new Date(Date.now() - 60_000) },
    ]);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("templateProps contains ONLY changedAt + contactAdminUrl (D-11 + Pitfall 7)", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "user@example.com", id: "u1", name: "User" },
    });
    await POST();
    const props = sendMock.mock.calls[0][0].data.templateProps;
    expect(Object.keys(props).sort()).toEqual(["changedAt", "contactAdminUrl"]);
    // explicitly verify forbidden PII keys are absent (Threat T-08.02-04)
    for (const forbidden of [
      "ipAddress",
      "userAgent",
      "browserFingerprint",
      "ip",
      "ua",
    ]) {
      expect(props).not.toHaveProperty(forbidden);
    }
  });
});
