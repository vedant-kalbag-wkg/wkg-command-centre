import { createHash } from 'node:crypto';
import { requireRole } from '@/lib/rbac';
import { getActiveLocationIds } from '@/lib/analytics/active-locations';
import { INTERNAL_SCOPE_KEY, type CachedQueryScope } from '@/lib/analytics/cached-query';

/**
 * Cache-scope key: collapses all internal users to a single shared entry,
 * separates external users by the hash of their accessible location IDs.
 *
 * Used as one component of the cache key in `unstable_cache` wrappers so that
 * the cache honours RBAC without fragmenting entries per-internal-user.
 */
export async function getCacheScopeKey(): Promise<CachedQueryScope> {
  const session = await requireRole('admin', 'member', 'viewer');
  if (session.user.userType === 'external') {
    const ids = await getActiveLocationIds();
    const hash = createHash('sha1').update([...ids].sort().join(',')).digest('hex').slice(0, 16);
    return `ext:${hash}`;
  }
  return INTERNAL_SCOPE_KEY;
}
