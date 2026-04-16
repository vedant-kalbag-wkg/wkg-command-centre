import { describe, it } from "vitest";

describe("monday-client", () => {
  describe("mondayQuery", () => {
    it.todo("sends GraphQL POST to api.monday.com/v2 with auth header");
    it.todo("throws if MONDAY_API_TOKEN is not set");
    it.todo("throws on GraphQL errors in response");
  });

  describe("fetchAllItems (cursor pagination)", () => {
    it.todo("yields first page of items from items_page");
    it.todo("follows cursor through next_items_page until cursor is null");
    it.todo("handles empty board with zero items");
  });

  describe("mondayQueryWithRetry (rate limit)", () => {
    it.todo("retries on rate limit error with exponential backoff");
    it.todo("throws after max retries exceeded");
    it.todo("does not retry on non-rate-limit errors");
  });

  describe("fetchSubitems", () => {
    it.todo("fetches subitems nested inside items query");
    it.todo("maps subitem column values to product/provider/commission data");
  });

  describe("field mapping", () => {
    it.todo("maps known Monday.com column titles to Drizzle field names");
    it.todo("returns unmapped columns for unknown column titles");
    it.todo("handles StatusValue label extraction via typed fragment");
  });
});
