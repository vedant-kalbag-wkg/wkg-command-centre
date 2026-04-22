'use server';
import { revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';

export type AnalyticsPurgeScope =
  | 'all'
  | 'portfolio' | 'regions' | 'maturity' | 'heat-map'
  | 'location-groups' | 'hotel-groups' | 'compare'
  | 'pivot-table' | 'trend-builder'
  | 'flags' | 'thresholds';

export async function purgeAnalyticsCache(scope: AnalyticsPurgeScope) {
  const session = await requireRole('admin');
  const tag = scope === 'all' ? 'analytics' : `analytics:${scope}`;
  revalidateTag(tag, 'max');
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: 'cache',
    entityId: tag,
    entityName: tag,
    action: 'purge',
  });
  return { success: true as const, tag };
}
