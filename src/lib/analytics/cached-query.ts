import { unstable_cache } from 'next/cache';
import { withStats } from '@/lib/analytics/cache-stats';
import type { CanonicalFilters } from '@/lib/analytics/canonicalise-filters';
import type { AnalyticsFilters } from '@/lib/analytics/types';
import type { UserCtx } from '@/lib/scoping/scoped-query';

export const INTERNAL_SCOPE_KEY = '__internal__' as const;
export type CachedQueryScope = typeof INTERNAL_SCOPE_KEY | `ext:${string}`;

// Sentinel userCtx for the shared-internal cache entry. Role=admin so
// buildScopeFilter() returns null (unrestricted) — correctness for the
// shared cache depends on every cached call resolving to the same WHERE
// clause regardless of which internal user made the request.
const INTERNAL_USER_CTX: UserCtx = {
  id: '__internal__',
  userType: 'internal',
  role: 'admin',
};

function denormaliseCanonical(f: CanonicalFilters): AnalyticsFilters {
  if (f.dateFrom === null || f.dateTo === null) {
    throw new Error('Cached analytics queries require concrete dateFrom/dateTo — got null');
  }
  const orUndefined = (xs: string[]): string[] | undefined =>
    xs.length > 0 ? xs : undefined;
  return {
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    hotelIds: orUndefined(f.hotelIds),
    regionIds: orUndefined(f.regionIds),
    productIds: orUndefined(f.productIds),
    hotelGroupIds: orUndefined(f.hotelGroupIds),
    locationGroupIds: orUndefined(f.locationGroupIds),
    maturityBuckets: orUndefined(f.maturityBuckets),
  };
}

interface WrapOptions {
  /** Unique per query — becomes part of the cache keyParts. */
  name: string;
  /** Cache tags, e.g. ['analytics', 'analytics:portfolio']. */
  tags: string[];
  /** Defaults to 86400s (24h) — aligned with overnight UK ETL. */
  revalidateSeconds?: number;
  /** Bump to force invalidation without waiting for TTL. Defaults to 'v1'. */
  versionSentinel?: string;
}

/**
 * Wraps an existing uncached analytics query (`(filters, userCtx, ...rest)`)
 * with `unstable_cache` + `withStats`, producing a cached variant whose
 * signature is `(canonicalFilters, scopeKey, ...rest)`.
 *
 * The cache key is derived from `keyParts` + JSON-serialised args, so:
 *   - canonical filters (stable shape) → stable key
 *   - scopeKey (`__internal__` or `ext:<hash>`) → scope-isolated entries
 *   - ...rest (e.g. limit, comparisonMode) → participates in key
 *
 * Scope contract (current):
 *   - Only `__internal__` is supported. External scopes throw.
 *   - Internal users with userScope rows (scoped members/viewers) would leak
 *     the shared `__internal__` entry — not an issue today (no such users
 *     in prod) but the current hash input doesn't encode scope membership.
 */
export function wrapAnalyticsQuery<TArgs extends unknown[], TResult>(
  uncached: (filters: AnalyticsFilters, userCtx: UserCtx, ...rest: TArgs) => Promise<TResult>,
  options: WrapOptions,
): (canonicalFilters: CanonicalFilters, scopeKey: CachedQueryScope, ...rest: TArgs) => Promise<TResult> {
  const { name, tags, revalidateSeconds = 86400, versionSentinel = 'v1' } = options;

  const instrumented = withStats(
    name,
    async (canonicalFilters: CanonicalFilters, scopeKey: CachedQueryScope, ...rest: TArgs): Promise<TResult> => {
      if (scopeKey !== INTERNAL_SCOPE_KEY) {
        throw new Error(`${name}: external scope not yet supported (got ${scopeKey})`);
      }
      const filters = denormaliseCanonical(canonicalFilters);
      return uncached(filters, INTERNAL_USER_CTX, ...rest);
    },
  );

  return unstable_cache(
    instrumented,
    ['analytics', name, versionSentinel],
    { revalidate: revalidateSeconds, tags },
  );
}
