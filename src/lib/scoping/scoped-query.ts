/**
 * Scoping primitives for analytics queries.
 *
 * buildScopeFilter is the pure/stateless core — in, out, no DB. Task 2.2
 * adds scopedSalesCondition() which uses this result to produce a Drizzle
 * SQL WHERE condition for sales_records queries.
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

import { eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  salesRecords,
  userScopes,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
} from '@/db/schema';

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

// =============================================================================
// Drizzle binding (Task 2.2)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = NodePgDatabase<any>;

/**
 * Returns a Drizzle SQL condition that, when ANDed into a sales_records
 * query, restricts rows to those the user is allowed to see.
 *
 * Returns `undefined` when no restriction applies (admin or unscoped
 * internal user). Callers should pass the result straight to `.where(…)`;
 * Drizzle interprets `undefined` as "no WHERE clause", which matches the
 * unrestricted semantics.
 *
 * Looks up userScopes rows for the resolved user, computes the filter via
 * buildScopeFilter, then translates each dimension into the appropriate SQL:
 *   - hotel_group    → sales_records.location_id IN (
 *                          SELECT location_id FROM
 *                          location_hotel_group_memberships
 *                          WHERE hotel_group_id IN (…)
 *                      )
 *   - region         → via location_region_memberships
 *   - location_group → via location_group_memberships
 *   - location       → sales_records.location_id IN (…)
 *   - product        → sales_records.product_id IN (…)
 *   - provider       → sales_records.provider_id IN (…)
 *   - union          → OR of the above
 */
export async function scopedSalesCondition(
  db: DrizzleDb,
  input: UserCtx | Session,
  options?: BuildScopeFilterOptions,
): Promise<SQL | undefined> {
  const user = resolveUser(input, options);

  const rows = await db
    .select({
      dimensionType: userScopes.dimensionType,
      dimensionId: userScopes.dimensionId,
    })
    .from(userScopes)
    .where(eq(userScopes.userId, user.id));

  const scopes = rows as Scope[];
  const filter = buildScopeFilter(input, scopes, options);
  if (filter === null) return undefined;

  return translateFilterToSalesSql(filter);
}

function translateFilterToSalesSql(filter: ScopeFilter): SQL {
  if (filter === null) {
    throw new Error('translateFilterToSalesSql called with null filter');
  }

  if (filter.kind === 'union') {
    const sqls = filter.parts.map((p) => translateSingleDimension(p));
    // or() can return undefined if given 0 args; buildScopeFilter guarantees
    // union parts ≥ 2, so this is defined in practice.
    const combined = or(...sqls);
    if (!combined) {
      throw new Error('translateFilterToSalesSql: empty union parts');
    }
    return combined;
  }

  return translateSingleDimension(filter);
}

function translateSingleDimension(single: ScopeFilterSingle): SQL {
  const { kind, ids } = single;
  switch (kind) {
    case 'location':
      return inArray(salesRecords.locationId, ids);
    case 'product':
      return inArray(salesRecords.productId, ids);
    case 'provider':
      return inArray(salesRecords.providerId, ids);
    case 'hotel_group':
      return sql`${salesRecords.locationId} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, ids)}
      )`;
    case 'region':
      return sql`${salesRecords.locationId} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, ids)}
      )`;
    case 'location_group':
      return sql`${salesRecords.locationId} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, ids)}
      )`;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled dimension: ${exhaustive as string}`);
    }
  }
}
