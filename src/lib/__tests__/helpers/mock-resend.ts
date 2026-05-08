import { vi, type Mock } from "vitest";

// Phase 8 Plan 08-01 — Resend mock helper for unit tests.
//
// Pattern mirrors src/lib/__tests__/monday-client.test.ts (mockFetchOnce /
// mockFetchSequence) — single shared mock callable, configurable per-test
// via mockResendSuccess / mockResendFailure. Each test calls one of those
// helpers to queue the next return; getResendSendMock() exposes the bare
// vitest Mock for assertions.
//
// `vi.hoisted` is mandatory because `vi.mock("resend", ...)` is hoisted to
// the top of THIS file by Vitest, before plain top-level `const sendMock = ...`
// would otherwise initialise. Hoisted vars are evaluated at the same hoist
// step so the factory can reference them. The factory uses a regular
// `function (...) {}` (NOT an arrow) so `new Resend(...)` can construct.
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn() as Mock,
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

export function mockResendSuccess({
  id = "mock-id-123",
}: { id?: string } = {}): Mock {
  sendMock.mockResolvedValueOnce({ data: { id }, error: null });
  return sendMock;
}

export function mockResendFailure({
  message = "send_failed",
}: { message?: string } = {}): Mock {
  sendMock.mockResolvedValueOnce({ data: null, error: { message } });
  return sendMock;
}

export function getResendSendMock(): Mock {
  return sendMock;
}

export function resetResendMock(): void {
  sendMock.mockReset();
}
