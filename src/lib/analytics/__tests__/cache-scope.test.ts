import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rbac', () => ({
  requireRole: vi.fn(),
}));
vi.mock('@/lib/analytics/active-locations', () => ({
  getActiveLocationIds: vi.fn(),
}));

import { getCacheScopeKey } from '../cache-scope';
import { requireRole } from '@/lib/rbac';
import { getActiveLocationIds } from '@/lib/analytics/active-locations';

afterEach(() => vi.resetAllMocks());

function mockSession(userType: 'internal' | 'external', role: 'admin' | 'member' | 'viewer' = 'admin') {
  return { user: { id: 'u1', name: 'A', role, userType } } as any;
}

describe('getCacheScopeKey', () => {
  it('returns __internal__ literal for admin sessions', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockSession('internal', 'admin'));
    expect(await getCacheScopeKey()).toBe('__internal__');
  });

  it('returns __internal__ literal for member sessions', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockSession('internal', 'member'));
    expect(await getCacheScopeKey()).toBe('__internal__');
  });

  it('returns ext:<16-hex> for external sessions', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockSession('external', 'viewer'));
    vi.mocked(getActiveLocationIds).mockResolvedValue(['loc-c', 'loc-a', 'loc-b']);
    const key = await getCacheScopeKey();
    expect(key).toMatch(/^ext:[0-9a-f]{16}$/);
  });

  it('produces identical hashes for external users with the same accessible locations regardless of order', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockSession('external', 'viewer'));

    vi.mocked(getActiveLocationIds).mockResolvedValueOnce(['loc-a', 'loc-b', 'loc-c']);
    const k1 = await getCacheScopeKey();

    vi.mocked(getActiveLocationIds).mockResolvedValueOnce(['loc-c', 'loc-a', 'loc-b']);
    const k2 = await getCacheScopeKey();

    expect(k1).toBe(k2);
  });

  it('produces different hashes for different external user scopes', async () => {
    vi.mocked(requireRole).mockResolvedValue(mockSession('external', 'viewer'));

    vi.mocked(getActiveLocationIds).mockResolvedValueOnce(['loc-a']);
    const k1 = await getCacheScopeKey();

    vi.mocked(getActiveLocationIds).mockResolvedValueOnce(['loc-b']);
    const k2 = await getCacheScopeKey();

    expect(k1).not.toBe(k2);
  });
});
