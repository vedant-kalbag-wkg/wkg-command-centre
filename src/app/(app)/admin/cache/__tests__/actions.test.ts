import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  requireRole: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn(),
}));

import { purgeAnalyticsCache } from '../actions';
import { revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';

describe('purgeAnalyticsCache', () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({
      user: { id: 'u1', name: 'Admin Name', role: 'admin', userType: 'internal' },
    } as any);
  });

  it('rejects non-admin sessions', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error('Forbidden'));
    await expect(purgeAnalyticsCache('all')).rejects.toThrow(/forbidden/i);
  });

  it('purges the analytics umbrella tag for "all" scope', async () => {
    const result = await purgeAnalyticsCache('all');
    expect(revalidateTag).toHaveBeenCalledWith('analytics', 'max');
    expect(result).toEqual({ success: true, tag: 'analytics' });
  });

  it('purges the portfolio-specific tag', async () => {
    const result = await purgeAnalyticsCache('portfolio');
    expect(revalidateTag).toHaveBeenCalledWith('analytics:portfolio', 'max');
    expect(result).toEqual({ success: true, tag: 'analytics:portfolio' });
  });

  it.each([
    ['regions', 'analytics:regions'],
    ['maturity', 'analytics:maturity'],
    ['heat-map', 'analytics:heat-map'],
    ['location-groups', 'analytics:location-groups'],
    ['hotel-groups', 'analytics:hotel-groups'],
    ['compare', 'analytics:compare'],
    ['pivot-table', 'analytics:pivot-table'],
    ['trend-builder', 'analytics:trend-builder'],
    ['flags', 'analytics:flags'],
    ['thresholds', 'analytics:thresholds'],
  ])('purges the %s scope tag', async (scope, expectedTag) => {
    await purgeAnalyticsCache(scope as Parameters<typeof purgeAnalyticsCache>[0]);
    expect(revalidateTag).toHaveBeenCalledWith(expectedTag, 'max');
  });

  it('writes an audit log entry', async () => {
    await purgeAnalyticsCache('portfolio');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u1',
      actorName: 'Admin Name',
      entityType: 'cache',
      action: 'purge',
      entityId: 'analytics:portfolio',
      entityName: 'analytics:portfolio',
    }));
  });
});
