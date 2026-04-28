import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import {
  mondayQuery,
  mondayQueryWithRetry,
  iterateBoardItems,
  mapColumnValues,
  extractStatusLabel,
  type MondayItem,
} from "@/lib/monday/client";

/**
 * Unit tests for the extracted Monday GraphQL client. Covers:
 *   - mondayQuery: auth, error handling
 *   - mondayQueryWithRetry: rate-limit retry semantics
 *   - iterateBoardItems: cursor pagination
 *   - mapColumnValues / extractStatusLabel: response → Drizzle field shape
 *
 * All HTTP traffic is stubbed via `vi.stubGlobal("fetch", ...)`. No real
 * network calls. Timer-driven backoff sleeps in retry tests are advanced
 * via fake timers.
 */

const TEST_TOKEN = "test-token";

beforeEach(() => {
  process.env.MONDAY_API_TOKEN = TEST_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mockFetchOnce(body: unknown): Mock {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchSequence(bodies: unknown[]): Mock {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("monday-client", () => {
  describe("mondayQuery", () => {
    it("sends GraphQL POST to api.monday.com/v2 with auth header", async () => {
      const fetchMock = mockFetchOnce({ data: { boards: [] } });

      await mondayQuery("query Q { test }", {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.monday.com/v2");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(TEST_TOKEN);
      expect(headers["Content-Type"]).toBe("application/json");
      expect(typeof init.body).toBe("string");
      expect(init.body as string).toContain("query Q { test }");
    });

    it("throws if MONDAY_API_TOKEN is not set", async () => {
      delete process.env.MONDAY_API_TOKEN;
      // No fetch needed — must throw before issuing the request.
      await expect(mondayQuery("query Q { test }", {})).rejects.toThrow(
        /MONDAY_API_TOKEN/,
      );
    });

    it("throws on GraphQL errors in response", async () => {
      mockFetchOnce({ errors: [{ message: "bad request" }] });

      await expect(mondayQuery("query Q { test }", {})).rejects.toThrow(
        /errors.*bad request|bad request.*errors/i,
      );
    });
  });

  describe("iterateBoardItems (cursor pagination)", () => {
    it("yields first page of items from items_page", async () => {
      mockFetchOnce({
        data: {
          boards: [
            {
              items_page: {
                cursor: null,
                items: [
                  { id: "1", name: "Item 1", column_values: [] },
                  { id: "2", name: "Item 2", column_values: [] },
                  { id: "3", name: "Item 3", column_values: [] },
                ],
              },
            },
          ],
        },
      });

      const collected: MondayItem[] = [];
      for await (const item of iterateBoardItems(123)) {
        collected.push(item);
      }

      expect(collected).toHaveLength(3);
      expect(collected[0].name).toBe("Item 1");
    });

    it("follows cursor through next_items_page until cursor is null", async () => {
      const fetchMock = mockFetchSequence([
        {
          data: {
            boards: [
              {
                items_page: {
                  cursor: "c1",
                  items: [
                    { id: "1", name: "P1-1", column_values: [] },
                    { id: "2", name: "P1-2", column_values: [] },
                    { id: "3", name: "P1-3", column_values: [] },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            next_items_page: {
              cursor: "c2",
              items: [
                { id: "4", name: "P2-1", column_values: [] },
                { id: "5", name: "P2-2", column_values: [] },
                { id: "6", name: "P2-3", column_values: [] },
              ],
            },
          },
        },
        {
          data: {
            next_items_page: {
              cursor: null,
              items: [
                { id: "7", name: "P3-1", column_values: [] },
                { id: "8", name: "P3-2", column_values: [] },
              ],
            },
          },
        },
      ]);

      const collected: MondayItem[] = [];
      for await (const item of iterateBoardItems(123)) {
        collected.push(item);
      }

      expect(collected).toHaveLength(8);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Second call should include the cursor "c1" in the GraphQL body.
      const secondBody = (fetchMock.mock.calls[1][1] as RequestInit).body as string;
      expect(secondBody).toContain("c1");
      // Third call should include "c2".
      const thirdBody = (fetchMock.mock.calls[2][1] as RequestInit).body as string;
      expect(thirdBody).toContain("c2");
    });

    it("handles empty board with zero items", async () => {
      mockFetchOnce({
        data: {
          boards: [
            {
              items_page: {
                cursor: null,
                items: [],
              },
            },
          ],
        },
      });

      const collected: MondayItem[] = [];
      for await (const item of iterateBoardItems(123)) {
        collected.push(item);
      }

      expect(collected).toHaveLength(0);
    });
  });

  describe("mondayQueryWithRetry (rate limit)", () => {
    it("retries on rate limit error with exponential backoff", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn();
      // Two rate-limit responses, then success.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: "Rate limit exceeded" }] }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: "complexity budget" }] }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ok: true } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const promise = mondayQueryWithRetry("query Q { test }", {});
      // Drain microtasks + advance timers through the two backoff sleeps
      // (1000ms, 2000ms — exponential).
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ ok: true });
    });

    it("throws after max retries exceeded", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: "Rate limit hit" }] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const promise = mondayQueryWithRetry("query Q { test }", {}, {
        maxRetries: 3,
        initialBackoffMs: 1,
      });
      // Catch-the-throw pattern with fake timers: attach the rejection
      // expectation BEFORE advancing timers so the unhandled rejection
      // doesn't escape the test.
      const expectation = expect(promise).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(100);
      await expectation;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry on non-rate-limit errors", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: "Invalid query syntax" }] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        mondayQueryWithRetry("query Q { test }", {}),
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchSubitems", () => {
    it("fetches subitems nested inside items query", async () => {
      mockFetchOnce({
        data: {
          boards: [
            {
              items_page: {
                cursor: null,
                items: [
                  {
                    id: "1",
                    name: "Hotel A",
                    column_values: [],
                    subitems: [
                      { id: "s1", name: "Sub 1", column_values: [] },
                      { id: "s2", name: "Sub 2", column_values: [] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      });

      const collected: MondayItem[] = [];
      for await (const item of iterateBoardItems(123)) {
        collected.push(item);
      }

      expect(collected).toHaveLength(1);
      expect(collected[0].subitems).toHaveLength(2);
      expect(collected[0].subitems?.[0].name).toBe("Sub 1");
    });

    it("maps subitem column values to product/provider/commission data", () => {
      const subitem: MondayItem = {
        id: "s1",
        name: "  Tour Booking  ",
        column_values: [
          { id: "label2__1", title: "Provider", text: "Uber", type: "text" },
          { id: "color5__1", title: "Available", text: "Yes", type: "color" },
          {
            id: "dup__of_commission9__1",
            title: "Commission",
            text: "12.5",
            type: "numeric",
          },
        ],
      };

      const fieldMap = {
        label2__1: "providerName",
        color5__1: "available",
        dup__of_commission9__1: "commissionRate",
      } as const;
      const { mapped } = mapColumnValues(subitem, fieldMap, "id");

      expect(mapped.providerName).toBe("Uber");
      expect(mapped.available).toBe("Yes");
      expect(mapped.commissionRate).toBe("12.5");
    });
  });

  describe("field mapping", () => {
    it("maps known Monday.com column titles to Drizzle field names", () => {
      const item: MondayItem = {
        id: "1",
        name: "Hotel X",
        column_values: [
          { id: "name", title: "Hotel Name", text: "X", type: "text" },
          { id: "addr", title: "Address", text: "1 High St", type: "text" },
        ],
      };

      const fieldMap = {
        "Hotel Name": "name",
        Address: "address",
      } as const;
      const { mapped } = mapColumnValues(item, fieldMap, "title");

      expect(mapped.name).toBe("X");
      expect(mapped.address).toBe("1 High St");
    });

    it("returns unmapped columns for unknown column titles", () => {
      const item: MondayItem = {
        id: "1",
        name: "Hotel X",
        column_values: [
          { id: "name", title: "Hotel Name", text: "X", type: "text" },
          { id: "weird", title: "WeirdColumn", text: "Y", type: "text" },
        ],
      };

      const fieldMap = { "Hotel Name": "name" } as const;
      const { mapped, unmapped } = mapColumnValues(item, fieldMap, "title");

      expect(mapped.name).toBe("X");
      expect(unmapped.WeirdColumn).toBe("Y");
    });

    it("handles StatusValue label extraction via typed fragment", () => {
      // Monday's StatusValue can come in two shapes — `text` populated, or
      // a structured `value` JSON containing { label: { text } } or
      // { label: "..." }. The extractor handles both.
      expect(extractStatusLabel({ text: "Active" })).toBe("Active");
      expect(
        extractStatusLabel({
          type: "color",
          value: JSON.stringify({ label: { text: "Live" } }),
        }),
      ).toBe("Live");
      expect(
        extractStatusLabel({
          type: "color",
          value: JSON.stringify({ label: "Pending" }),
        }),
      ).toBe("Pending");
      expect(extractStatusLabel({ text: null, value: null })).toBeNull();
    });
  });
});
