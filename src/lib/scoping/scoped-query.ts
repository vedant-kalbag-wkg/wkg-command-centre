/**
 * Scoping primitives for analytics queries.
 *
 * buildScopeFilter is the pure/stateless core — in, out, no DB. Task 2.2
 * adds scopedQuery() which uses this result to inject WHERE conditions
 * into Drizzle queries.
 *
 * INVARIANTS (enforced here):
 *   - userType='internal' && role='admin' → no filter (unrestricted).
 *   - userType='internal' (member/viewer) with 0 scopes → no filter.
 *   - userType='external' with 0 scopes → THROW. External users must be scoped.
 *   - Multiple scopes of the same dimension = UNION (IN (…)).
 *   - Multiple scopes across dimensions = UNION across dimensions
 *     (OR in SQL).
 *   - Impersonation is opt-in via options: when honorImpersonation=true
 *     and a session carries an impersonatedUser, that user's context
 *     is used for scope decisions.
 */

const VALID_DIMENSION_TYPES = [
  'hotel_group',
  'location',
  'region',
  'product',
  'provider',
  'location_group',
] as const;

export type DimensionType = (typeof VALID_DIMENSION_TYPES)[number];

export type Scope = {
  dimensionType: DimensionType;
  dimensionId: string;
};

export type UserCtx = {
  id: string;
  userType: 'internal' | 'external';
  role: 'admin' | 'member' | 'viewer' | null;
};

export type Session = {
  user: UserCtx;
  impersonatedUser?: UserCtx;
};

export type ScopeFilterSingle = { kind: DimensionType; ids: string[] };
export type ScopeFilterUnion = { kind: 'union'; parts: ScopeFilterSingle[] };
export type ScopeFilter = null | ScopeFilterSingle | ScopeFilterUnion;

export type BuildScopeFilterOptions = { honorImpersonation?: boolean };

function resolveUser(input: UserCtx | Session, opts?: BuildScopeFilterOptions): UserCtx {
  if ('user' in input) {
    if (opts?.honorImpersonation && input.impersonatedUser) return input.impersonatedUser;
    return input.user;
  }
  return input;
}

export function buildScopeFilter(
  input: UserCtx | Session,
  scopes: Scope[],
  options?: BuildScopeFilterOptions,
): ScopeFilter {
  for (const s of scopes) {
    if (!VALID_DIMENSION_TYPES.includes(s.dimensionType)) {
      throw new Error(`Unknown dimension type: ${s.dimensionType}`);
    }
  }

  const user = resolveUser(input, options);

  if (user.userType === 'internal' && user.role === 'admin') {
    return null;
  }

  if (user.userType === 'external' && scopes.length === 0) {
    throw new Error('External user must have at least one scope row');
  }

  if (scopes.length === 0) return null;

  const byDim = new Map<DimensionType, Set<string>>();
  for (const s of scopes) {
    if (!byDim.has(s.dimensionType)) byDim.set(s.dimensionType, new Set());
    byDim.get(s.dimensionType)!.add(s.dimensionId);
  }

  const parts: ScopeFilterSingle[] = Array.from(byDim.entries()).map(([kind, idSet]) => ({
    kind,
    ids: Array.from(idSet),
  }));

  if (parts.length === 1) return parts[0];
  return { kind: 'union', parts };
}
