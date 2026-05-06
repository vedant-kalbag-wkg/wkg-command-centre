/**
 * Monday.com GraphQL client.
 *
 * A thin wrapper around `fetch` that handles the things every Monday-side
 * caller in this repo gets wrong on its own: env-var lookup, error
 * propagation, rate-limit retry, and cursor pagination over `items_page` /
 * `next_items_page`. Extracted from the inline GraphQL traffic that used to
 * live in `src/lib/monday/import-location-products.ts` (Phase 6 plan 06-02).
 *
 * Public surface:
 *   - {@link mondayQuery}            single GraphQL request, no retry
 *   - {@link mondayQueryWithRetry}   single GraphQL request with rate-limit retry
 *   - {@link iterateBoardItems}      cursor pagination over a board's items
 *   - {@link mapColumnValues}        column_values → Drizzle field shape
 *   - {@link extractStatusLabel}     pull the label out of a Monday StatusValue
 *
 * No external dependencies — `fetch` is the only side-effecting call. Tests
 * stub `fetch` via `vi.stubGlobal("fetch", ...)`.
 */

const MONDAY_GRAPHQL_URL = "https://api.monday.com/v2";
const DEFAULT_API_VERSION = "2024-10";

export type MondayColumnValue = {
  id: string;
  title?: string;
  text?: string | null;
  type?: string;
  value?: string | null;
  display_value?: string | null;
};

export type MondayItem = {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
  subitems?: MondayItem[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

/**
 * Returns the Monday API token, or throws a clear error if it's missing.
 * Keeping the lookup centralised means callers don't all have to remember
 * the `process.env.MONDAY_API_TOKEN!` non-null assertion (and the resulting
 * confusing TypeError when it's missing in dev).
 */
function getApiToken(): string {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error(
      "MONDAY_API_TOKEN environment variable is not set. " +
        "Set it before calling Monday API helpers.",
    );
  }
  return token;
}

/**
 * Heuristic for "this error is worth retrying". Monday's GraphQL surface
 * doesn't give us a structured rate-limit code — it embeds the cue in the
 * error message text. Includes:
 *   - rate-limit / complexity / budget exhausted (the legacy cases the
 *     existing `import-location-products` code already detects)
 *   - HTTP 502 / 503 / 504 from the GraphQL gateway (transient infra hiccups
 *     observed during long Phase 7 runbook fetches)
 *   - generic "timeout" / "gateway" hints in the error message
 */
function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("complexity") ||
    lower.includes("budget exhausted") ||
    lower.includes("http 502") ||
    lower.includes("http 503") ||
    lower.includes("http 504") ||
    lower.includes("gateway timeout") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable")
  );
}

/**
 * Issue a single GraphQL request. No retry. Throws on:
 *   - missing API token
 *   - HTTP error (non-2xx)
 *   - GraphQL `errors` array populated in the response body
 *
 * The signature accepts a `variables` map for parity with the public Monday
 * API, but the GraphQL body inlines the query string verbatim. Variables are
 * serialised into the body as `{ query, variables }`.
 */
export async function mondayQuery<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = getApiToken();

  const res = await fetch(MONDAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": DEFAULT_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `Monday API HTTP ${res.status}: ${res.statusText || "request failed"}`,
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((e) => e.message).join("; ");
    throw new Error(`Monday API errors: ${message}`);
  }

  if (!json.data) {
    throw new Error("Monday API: response missing `data`");
  }

  return json.data;
}

/**
 * Same as {@link mondayQuery} but retries on rate-limit / complexity errors
 * with exponential backoff. Non-rate-limit errors propagate immediately so we
 * don't hammer the API with bad queries.
 *
 * Default behaviour matches the legacy inline retry loop in
 * `import-location-products.ts`: 5 attempts, 1s → 2s → 4s → 8s → 16s.
 */
export async function mondayQueryWithRetry<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  options: { maxRetries?: number; initialBackoffMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const initialBackoffMs = options.initialBackoffMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await mondayQuery<T>(query, variables);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isRateLimitError(message)) {
        // Bad query / wrong shape / network error — no point retrying.
        throw err;
      }
      // Final attempt — give up.
      if (attempt === maxRetries - 1) break;
      // Otherwise sleep and retry. Exponential backoff (doubling).
      const delayMs = initialBackoffMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Monday API: max retries exceeded");
}

/**
 * Default item fragment used by {@link iterateBoardItems}. Includes subitems
 * so callers that want product/provider/commission data don't need a second
 * round-trip per hotel. Callers that want a leaner payload can pass their
 * own fragment via the `itemFragment` option.
 */
const DEFAULT_ITEM_FRAGMENT = `
  id
  name
  column_values { id text type value }
  subitems {
    id
    name
    column_values { id text type value }
  }
`;

/**
 * Async generator that yields every item on a Monday board, transparently
 * following the `cursor` chain across `items_page` (page 1) and
 * `next_items_page` (page 2+). Caller iterates with `for await`.
 *
 * Uses retry-aware {@link mondayQueryWithRetry} so a single board pull is
 * resilient to transient rate-limit hits.
 */
export async function* iterateBoardItems(
  boardId: number,
  options: { itemFragment?: string; pageLimit?: number } = {},
): AsyncGenerator<MondayItem> {
  const itemFragment = options.itemFragment ?? DEFAULT_ITEM_FRAGMENT;
  const limit = options.pageLimit ?? 100;

  type PageShape = { cursor: string | null; items: MondayItem[] };

  // First page — boards(ids) → items_page.
  const firstQuery = `{ boards(ids: [${boardId}]) { items_page(limit: ${limit}) { cursor items { ${itemFragment} } } } }`;
  const firstResp = await mondayQueryWithRetry<{
    boards: Array<{ items_page: PageShape }>;
  }>(firstQuery, {});

  let page: PageShape = firstResp.boards[0]?.items_page ?? {
    cursor: null,
    items: [],
  };
  for (const item of page.items) {
    yield item;
  }

  // Subsequent pages — next_items_page(cursor).
  while (page.cursor && page.items.length > 0) {
    const cursor: string = page.cursor;
    const nextQuery = `{ next_items_page(limit: ${limit}, cursor: "${cursor}") { cursor items { ${itemFragment} } } }`;
    const nextResp = await mondayQueryWithRetry<{
      next_items_page: PageShape;
    }>(nextQuery, {});
    page = nextResp.next_items_page ?? { cursor: null, items: [] };
    for (const item of page.items) {
      yield item;
    }
  }
}

/**
 * Map a Monday item's `column_values` into a target shape, plus a
 * residual `unmapped` bag for any column the caller didn't ask for.
 *
 * `keyBy` controls which property of `MondayColumnValue` is used to look up
 * the field-map entry: most call sites in this repo key by Monday's stable
 * column id (`id`), but the existing test surface and Monday's docs both
 * also describe a "title" mapping. Pass `"title"` to match column_values
 * by their human-readable header instead of the opaque id.
 *
 * The returned `mapped` is `Partial<...>` because not every column on the
 * field map is guaranteed to be present on every item.
 */
export function mapColumnValues<TFieldMap extends Record<string, string>>(
  item: MondayItem,
  fieldMap: TFieldMap,
  keyBy: "id" | "title" = "id",
): {
  mapped: Partial<Record<TFieldMap[keyof TFieldMap], string | null>>;
  unmapped: Record<string, string | null>;
} {
  const mapped: Record<string, string | null> = {};
  const unmapped: Record<string, string | null> = {};

  for (const cv of item.column_values) {
    const key = (keyBy === "id" ? cv.id : cv.title) ?? "";
    const targetField = fieldMap[key];
    if (targetField) {
      mapped[targetField] = cv.text ?? null;
    } else if (key) {
      unmapped[key] = cv.text ?? null;
    }
  }

  return {
    mapped: mapped as Partial<
      Record<TFieldMap[keyof TFieldMap], string | null>
    >,
    unmapped,
  };
}

/**
 * Extract the human-readable label from a Monday StatusValue. Monday returns
 * status columns in two shapes depending on the query path:
 *   1. `{ text: "Active" }` — when the column type is fetched as plain text.
 *   2. `{ value: "{\"label\":{\"text\":\"Active\"}}", type: "color" }` —
 *      when fetched via the typed-fragment path that exposes the structured
 *      `StatusValue.label`.
 *
 * Some legacy Monday boards also serialise `label` as a bare string instead
 * of an object — handle that too for forward compatibility.
 *
 * Returns `null` when no label can be extracted.
 */
export function extractStatusLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  // Shape 1: plain text path.
  if (typeof obj.text === "string" && obj.text.length > 0) {
    return obj.text;
  }

  // Shape 2: structured value JSON.
  if (typeof obj.value === "string" && obj.value.length > 0) {
    try {
      const parsed = JSON.parse(obj.value) as { label?: unknown };
      const label = parsed?.label;
      if (typeof label === "string") return label;
      if (
        label &&
        typeof label === "object" &&
        typeof (label as { text?: unknown }).text === "string"
      ) {
        return (label as { text: string }).text;
      }
    } catch {
      // Non-JSON value — fall through to null.
    }
  }

  return null;
}
