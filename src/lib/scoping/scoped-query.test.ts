import { describe, it, expect } from 'vitest';
import { buildScopeFilter } from './scoped-query';

const admin = { id: 'a1', userType: 'internal' as const, role: 'admin' as const };
const member = { id: 'm1', userType: 'internal' as const, role: 'member' as const };
const viewer = { id: 'v1', userType: 'internal' as const, role: 'viewer' as const };
const external = { id: 'e1', userType: 'external' as const, role: null };

describe('buildScopeFilter', () => {
  it('returns null (unrestricted) for internal admin with no scopes', () => {
    expect(buildScopeFilter(admin, [])).toBeNull();
  });

  it('returns null (unrestricted) for internal member with no scopes', () => {
    expect(buildScopeFilter(member, [])).toBeNull();
  });

  it('returns null (unrestricted) for internal viewer with no scopes', () => {
    expect(buildScopeFilter(viewer, [])).toBeNull();
  });

  it('THROWS for external user with no scopes', () => {
    expect(() => buildScopeFilter(external, [])).toThrow(/external.*scope/i);
  });

  it('builds a hotel_group filter from a single scope', () => {
    const filter = buildScopeFilter(external, [{ dimensionType: 'hotel_group', dimensionId: '42' }]);
    expect(filter).toEqual({ kind: 'hotel_group', ids: ['42'] });
  });

  it('unions multiple scopes of the same dimension', () => {
    const filter = buildScopeFilter(external, [
      { dimensionType: 'provider', dimensionId: '1' },
      { dimensionType: 'provider', dimensionId: '2' },
    ]);
    expect(filter).toEqual({ kind: 'provider', ids: ['1', '2'] });
  });

  it('unions across dimensions (hotel_group OR provider)', () => {
    const filter = buildScopeFilter(external, [
      { dimensionType: 'hotel_group', dimensionId: '42' },
      { dimensionType: 'provider', dimensionId: '7' },
    ]);
    expect(filter).toEqual({
      kind: 'union',
      parts: expect.arrayContaining([
        { kind: 'hotel_group', ids: ['42'] },
        { kind: 'provider', ids: ['7'] },
      ]),
    });
    expect(filter && 'parts' in filter ? filter.parts.length : 0).toBe(2);
  });

  it('internal admin with scopes: scopes ignored (unrestricted) — admins bypass', () => {
    const filter = buildScopeFilter(admin, [{ dimensionType: 'provider', dimensionId: '1' }]);
    expect(filter).toBeNull();
  });

  it('internal member with scopes: scopes ARE applied (scoped internal user)', () => {
    const filter = buildScopeFilter(member, [{ dimensionType: 'region', dimensionId: 'UK' }]);
    expect(filter).toEqual({ kind: 'region', ids: ['UK'] });
  });

  it('impersonation: uses impersonated user scopes when honorImpersonation=true', () => {
    const session = {
      user: admin,
      impersonatedUser: external,
    };
    const filter = buildScopeFilter(
      session,
      [{ dimensionType: 'provider', dimensionId: '1' }],
      { honorImpersonation: true },
    );
    expect(filter).toEqual({ kind: 'provider', ids: ['1'] });
  });

  it('impersonation ignored when honorImpersonation=false (default)', () => {
    const session = { user: admin, impersonatedUser: external };
    const filter = buildScopeFilter(session, [{ dimensionType: 'provider', dimensionId: '1' }]);
    // admin, so null (unrestricted)
    expect(filter).toBeNull();
  });

  it('deduplicates identical scopes', () => {
    const filter = buildScopeFilter(external, [
      { dimensionType: 'provider', dimensionId: '1' },
      { dimensionType: 'provider', dimensionId: '1' },
    ]);
    expect(filter).toEqual({ kind: 'provider', ids: ['1'] });
  });

  it('rejects unknown dimensionType', () => {
    expect(() =>
      buildScopeFilter(external, [{ dimensionType: 'galaxy' as any, dimensionId: '1' }]),
    ).toThrow(/dimension.*type/i);
  });
});
