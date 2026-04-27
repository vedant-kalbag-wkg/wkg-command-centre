/**
 * Scoping primitives for analytics queries.
 *
 * buildScopeFilter is the pure/stateless core — in, out, no DB. Task 2.2
 * adds scopedSalesCondition() which uses this result to produce a Drizzle
 * SQL WHERE condition for sales_records queries.
 *
 * INVARIANTS (enforced here):
 *   - userType='internal' && role IN ('admin', 'system') → no filter
 *     (unrestricted). 'system' covers automation actors (e.g. ETL) which
 *     legitimately operate outside any scope assignment.
 *   - Any other user with 0 scopes → THROW. This includes internal
 *     member/viewer (previously silently unrestricted — security bug) and
 *     all external users.
 *   - Multiple scopes of the same dimension = UNION (IN (…)).
 *   - Multiple scopes across dimensions = UNION across dimensions
 *     (OR in SQL).
 *   - Impersonation is opt-in via options: when honorImpersonation=true
 *     and a session carries an impersonatedUser, that user's context
 *     is used for scope decisions.
 */

import { cache } from 'react';
import { eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  locations,
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
  role: 'admin' | 'system' | 'member' | 'viewer' | null;
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

  if (
    user.userType === 'internal' &&
    (user.role === 'admin' || user.role === 'system')
  ) {
    return null;
  }

  if (scopes.length === 0) {
    throw new Error(
      "User has no analytics scopes assigned. Either assign scopes via /settings/users, or change the user's role to 'admin' or 'system' if unrestricted access is intended.",
    );
  }

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
 *
 * Wrapped in React.cache so a request that runs N analytics queries in
 * parallel only fires the user_scopes SELECT once (was N round-trips).
 * Cache key is the (db, input, options) tuple by reference. In non-React
 * contexts (tests, scripts) cache() is a no-op, so this is safe to wrap
 * unconditionally.
 */
export const scopedSalesCondition = cache(async (
  db: DrizzleDb,
  input: UserCtx | Session,
  options?: BuildScopeFilterOptions,
): Promise<SQL | undefined> => {
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
});

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

// =============================================================================
// Locations-side binding (Task 3.6)
// =============================================================================

/**
 * Sibling of `scopedSalesCondition` for queries that select FROM `locations`
 * directly (e.g. cohort/location pickers). Emits a `locations.id`-relative
 * scope predicate instead of a `sales_records.location_id`-relative one.
 *
 * `product` and `provider` scopes have no clean projection onto
 * `locations.id` (they constrain rows in `sales_records`, not the location
 * universe) and are not valid inputs to a locations-only query — callers must
 * either restrict the picker upstream or rely on a sales-side filter.
 */
export const scopedLocationsCondition = cache(async (
  db: DrizzleDb,
  input: UserCtx | Session,
  options?: BuildScopeFilterOptions,
): Promise<SQL | undefined> => {
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

  return translateFilterToLocationsSql(filter);
});

function translateFilterToLocationsSql(filter: ScopeFilter): SQL {
  if (filter === null) {
    throw new Error('translateFilterToLocationsSql called with null filter');
  }

  if (filter.kind === 'union') {
    const sqls = filter.parts.map((p) => translateSingleDimensionLocations(p));
    const combined = or(...sqls);
    if (!combined) {
      throw new Error('translateFilterToLocationsSql: empty union parts');
    }
    return combined;
  }

  return translateSingleDimensionLocations(filter);
}

function translateSingleDimensionLocations(single: ScopeFilterSingle): SQL {
  const { kind, ids } = single;
  switch (kind) {
    case 'location':
      return inArray(locations.id, ids);
    case 'hotel_group':
      return sql`${locations.id} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, ids)}
      )`;
    case 'region':
      return sql`${locations.id} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, ids)}
      )`;
    case 'location_group':
      return sql`${locations.id} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, ids)}
      )`;
    case 'product':
    case 'provider':
      throw new Error(
        'product/provider scope not applicable to locations-only queries',
      );
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled dimension: ${exhaustive as string}`);
    }
  }
}
