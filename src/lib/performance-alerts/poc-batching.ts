/**
 * Groups classified rows by their assigned POC (Point of Contact).
 *
 * Rows with `internalPocId: null` are grouped into a sentinel bucket
 * (pocUserId: null) that the cron job skips when dispatching emails (D-07).
 *
 * Phase 9 follow-up: the constraint only requires `internalPocId`. Both
 * `ClassifiedKioskRow` (legacy kiosk-level) and `ClassifiedLocationRow`
 * (current hotel-level) satisfy it. The grouped field is still named
 * `kiosks` for backwards-compat with the existing tests + cron callsite —
 * read it as "items batched per POC".
 */

export type ClassifiedKiosk = {
  internalPocId: string | null;
  [k: string]: unknown;
};

export type PocGroup<T extends ClassifiedKiosk = ClassifiedKiosk> = {
  pocUserId: string | null;
  kiosks: T[];
};

/**
 * Returns one PocGroup per distinct internalPocId (including null).
 * Insertion order of first-seen POC IDs is preserved.
 */
export function groupByPoc<T extends ClassifiedKiosk>(rows: T[]): PocGroup<T>[] {
  const map = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.internalPocId ?? null;
    const arr = map.get(key);
    if (arr) {
      arr.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return Array.from(map.entries()).map(([pocUserId, kiosks]) => ({
    pocUserId,
    kiosks,
  }));
}
