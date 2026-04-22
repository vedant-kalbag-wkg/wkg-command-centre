import { db } from "./index";

type Row = Record<string, unknown>;

/**
 * Drizzle's `db.execute()` return type differs by driver:
 *   - postgres-js → array-like RowList<T[]>
 *   - neon-serverless → QueryResult<T> with .rows
 *
 * This helper normalizes both into a plain T[] so callers don't have to
 * branch on driver shape.
 */
export function executeRowsFromResult<T extends Row = Row>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function executeRows<T extends Row = Row>(
  query: Parameters<typeof db.execute>[0],
): Promise<T[]> {
  const result = await db.execute(query);
  return executeRowsFromResult<T>(result);
}
