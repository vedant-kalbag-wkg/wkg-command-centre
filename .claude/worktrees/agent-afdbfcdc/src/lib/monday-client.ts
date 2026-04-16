// Monday.com GraphQL API client
// All Monday.com API calls go through this module.

const MONDAY_API_URL = "https://api.monday.com/v2";

// =============================================================================
// Types
// =============================================================================

export interface MondayColumnValue {
  id: string;
  type: string;
  text: string;
  value: string | null;
  label?: string;         // StatusValue fragment
  date?: string;          // DateValue fragment
  display_value?: string; // MirrorValue fragment
}

export interface MondaySubitem {
  id: string;
  name: string; // Product name (e.g., "Transfers", "Airport Shuttle")
  column_values: MondayColumnValue[];
}

export interface MondayItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: MondayColumnValue[];
  subitems: MondaySubitem[];
}

export interface BoardColumn {
  id: string;
  title: string;
  type: string;
}

// =============================================================================
// Core GraphQL client
// =============================================================================

/**
 * Execute a Monday.com GraphQL query.
 * Throws if MONDAY_API_TOKEN is not set, on HTTP errors, or on GraphQL errors.
 */
export async function mondayQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN not set");

  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const isRateLimit = res.status === 429;
    throw new Error(isRateLimit ? "rate limit exceeded" : `HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(
      data.errors.map((e: { message: string }) => e.message).join("; ")
    );
  }
  return data.data as T;
}

// =============================================================================
// Retry wrapper with exponential backoff (D-10)
// =============================================================================

/**
 * Wraps mondayQuery with exponential backoff for rate-limit errors.
 * - Initial delay: 1000ms, doubles each retry, capped at 32000ms
 * - Max 5 retries
 * - Only retries on rate-limit errors (message includes "rate" or HTTP 429)
 * - Non-rate-limit errors thrown immediately
 */
export async function mondayQueryWithRetry<T>(
  query: string,
  variables?: Record<string, unknown>,
  options?: {
    maxRetries?: number;
    onRetry?: (attempt: number, delayMs: number) => void;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 5;
  const onRetry = options?.onRetry;
  let delayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await mondayQuery<T>(query, variables);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const isRateLimit =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rate") ||
          err.message.includes("429"));
      if (!isRateLimit) throw err;
      onRetry?.(attempt + 1, delayMs);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 32000);
    }
  }
  throw new Error("Max retries exceeded");
}

// =============================================================================
// Board columns fetcher
// =============================================================================

/**
 * Fetch all column metadata for a Monday.com board.
 * Returns the column id, title, and type for admin mapping review.
 */
export async function fetchBoardColumns(boardId: string): Promise<BoardColumn[]> {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns {
          id
          title
          type
        }
      }
    }
  `;

  const data = await mondayQueryWithRetry<{
    boards: Array<{ id: string; name: string; columns: BoardColumn[] }>;
  }>(query, { boardId: [boardId] });

  return data.boards[0]?.columns ?? [];
}

// =============================================================================
// Paginated items fetcher (async generator)
// =============================================================================

// GraphQL for initial page — fetches items_page with subitems nested inline (D-17)
const ITEMS_PAGE_QUERY = `
  query ($boardId: [ID!], $limit: Int!) {
    boards(ids: $boardId) {
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
          group { id title }
          column_values {
            id
            type
            text
            value
            ... on StatusValue { label }
            ... on DateValue { date }
            ... on MirrorValue { display_value }
          }
          subitems {
            id
            name
            column_values { id type text value }
          }
        }
      }
    }
  }
`;

// GraphQL for continuation pages
const NEXT_ITEMS_PAGE_QUERY = `
  query ($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        name
        group { id title }
        column_values {
          id
          type
          text
          value
          ... on StatusValue { label }
          ... on DateValue { date }
          ... on MirrorValue { display_value }
        }
        subitems {
          id
          name
          column_values { id type text value }
        }
      }
    }
  }
`;

type InitialPageResult = {
  boards: Array<{
    items_page: {
      cursor: string | null;
      items: MondayItem[];
    };
  }>;
};

type NextPageResult = {
  next_items_page: {
    cursor: string | null;
    items: MondayItem[];
  };
};

/**
 * Async generator that yields pages of MondayItems.
 * Cursor-paginates through the entire board (500 items/page per API-Version 2024-01).
 *
 * Per D-17: subitems are fetched nested inline in the main items query — NOT via a
 * separate API call. The subitems { ... } field on each item fetches from subboard 1413119149.
 *
 * Per Pitfall 1: Fetch ALL items before any DB writes — cursors expire after 60 minutes.
 */
export async function* fetchAllItems(
  boardId: string,
  onProgress?: (progress: { page: number; itemCount: number }) => void
): AsyncGenerator<MondayItem[]> {
  const LIMIT = 500;
  let page = 1;

  // Initial page
  const firstPage = await mondayQueryWithRetry<InitialPageResult>(
    ITEMS_PAGE_QUERY,
    { boardId: [boardId], limit: LIMIT }
  );

  const initialData = firstPage.boards[0]?.items_page;
  if (!initialData) return;

  const firstItems = initialData.items;
  let cursor = initialData.cursor;

  onProgress?.({ page, itemCount: firstItems.length });
  yield firstItems;

  // Continuation pages
  while (cursor) {
    page++;
    const nextPage = await mondayQueryWithRetry<NextPageResult>(
      NEXT_ITEMS_PAGE_QUERY,
      { cursor, limit: LIMIT }
    );

    const nextData = nextPage.next_items_page;
    cursor = nextData.cursor;

    onProgress?.({ page, itemCount: nextData.items.length });
    yield nextData.items;
  }
}
