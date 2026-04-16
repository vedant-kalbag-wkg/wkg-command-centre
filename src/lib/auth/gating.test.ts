import { describe, it, expect } from 'vitest';
import { shouldGateExternalUser } from './gating';

describe('shouldGateExternalUser', () => {
  it('returns false for internal user regardless of path', () => {
    expect(shouldGateExternalUser('internal', '/kiosks')).toBe(false);
    expect(shouldGateExternalUser('internal', '/portal/coming-soon')).toBe(false);
  });

  it('returns true for external user on internal routes', () => {
    expect(shouldGateExternalUser('external', '/kiosks')).toBe(true);
    expect(shouldGateExternalUser('external', '/locations/abc')).toBe(true);
    expect(shouldGateExternalUser('external', '/installations')).toBe(true);
    expect(shouldGateExternalUser('external', '/products')).toBe(true);
    expect(shouldGateExternalUser('external', '/settings/users')).toBe(true);
    expect(shouldGateExternalUser('external', '/analytics/portfolio')).toBe(true);
  });

  it('returns false for external user on portal routes', () => {
    expect(shouldGateExternalUser('external', '/portal/coming-soon')).toBe(false);
    expect(shouldGateExternalUser('external', '/portal/analytics')).toBe(false);
  });

  it('returns false for external user on auth routes', () => {
    expect(shouldGateExternalUser('external', '/login')).toBe(false);
    expect(shouldGateExternalUser('external', '/reset-password')).toBe(false);
    expect(shouldGateExternalUser('external', '/set-password')).toBe(false);
    expect(shouldGateExternalUser('external', '/api/auth/callback')).toBe(false);
  });

  it('returns false for root path (lets auth redirect handle it)', () => {
    expect(shouldGateExternalUser('external', '/')).toBe(false);
  });

  it('treats undefined userType as internal (backwards compatible)', () => {
    expect(shouldGateExternalUser(undefined, '/kiosks')).toBe(false);
  });
});
