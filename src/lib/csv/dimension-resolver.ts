import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  kioskAssignments,
  kiosks,
  locations,
  products,
  providers as providersTable,
} from "@/db/schema";
import type { RowValidationError } from "./sales-csv";

// Drizzle DB shape — kept loose so both the prod postgres-js-backed singleton
// and testcontainers' node-postgres-backed instance (with a slightly different
// schema type parameter) satisfy it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export type DimensionInput = {
  rowNumber: number;
  outletCode: string;
  productName: string;
  /** Preferred key for product resolution. Parser guarantees non-empty. */
  netsuiteCode: string;
  categoryCode: string | null;
  categoryName: string | null;
  // Denormalised onto salesRecords by the caller; the resolver does not
  // read this field and does not write it to the products dimension.
  apiProductName: string | null;
  providerName: string | null;
};

export type ResolveOptions = {
  regionId: string;
  /**
   * Phase 7 (D-06 / DATA-04): when set, unknown outlet codes resolve to this
   * sentinel `locations.id` instead of producing a validation error. The
   * caller is responsible for ensuring the sentinel exists and for tracking
   * which outlet codes hit the fallback (so they can be surfaced via the
   * Plan C merge UI). Omitted/undefined keeps the existing strict behaviour.
   */
  sentinelLocationId?: string;
};

export type ResolvedRow =
  | {
      rowNumber: number;
      locationId: string;
      productId: string;
      providerId: string | null;
    }
  | {
      rowNumber: number;
      errors: RowValidationError[];
    };

/**
 * Resolve outletCode / netsuiteCode+productName / providerName to FK ids,
 * scoped to a single region.
 *
 * Contract:
 *   - Outlets are looked up by `(primary_region_id, outlet_code)` — the same
 *     code in a different region is a distinct location.
 *   - Products are resolved in three passes:
 *       1. match on `products.netsuite_code` (unique, region-agnostic);
 *       2. match on `products.name` where `netsuite_code IS NULL`, then
 *          back-fill the code (and any null category/api columns) so
 *          subsequent runs match by the strong key;
 *       3. auto-create with all NetSuite columns populated.
 *   - Providers are resolved by name; unknown names are auto-created.
 *   - Unknown outlet codes for the region produce a row-level validation
 *     error whose message names both the code and the region id.
 *
 * Concurrency precondition: the caller must serialise invocation (the ETL
 * entrypoint holds a Postgres advisory lock; see design doc §"concurrency").
 * Without that, two parallel runs can race on the Pass 2 back-fill / Pass 3
 * auto-create and surface `duplicate key` errors on `products.netsuite_code`
 * / `products.name`. The resolver does not attempt its own locking.
 */
export async function resolveDimensions(
  db: AnyDb,
  rows: DimensionInput[],
  opts: ResolveOptions,
): Promise<ResolvedRow[]> {
  if (rows.length === 0) return [];

  const { regionId } = opts;

  // ---- Outlet lookup (region-scoped, batched) --------------------------------
  const outletCodes = Array.from(new Set(rows.map((r) => r.outletCode)));
  const locRows = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations)
    .where(
      and(
        eq(locations.primaryRegionId, regionId),
        inArray(locations.outletCode, outletCodes),
      ),
    );
  const locByCode = new Map<string, string>();
  for (const r of locRows as Array<{ id: string; outletCode: string }>) {
    locByCode.set(r.outletCode, r.id);
  }

  // Fallback path: per the v2 data-model rule "outlet_code is per-kiosk", a
  // sales row's outlet code may match a kiosk rather than a location. Resolve
  // those via kiosks.outlet_code → kiosk_assignments.location_id (currently
  // active assignment, scoped to the active region).
  const stillMissing = outletCodes.filter((c) => !locByCode.has(c));
  if (stillMissing.length > 0) {
    const kioskRows = await db
      .select({
        outletCode: kiosks.outletCode,
        locationId: kioskAssignments.locationId,
      })
      .from(kiosks)
      .innerJoin(kioskAssignments, eq(kioskAssignments.kioskId, kiosks.id))
      .innerJoin(locations, eq(locations.id, kioskAssignments.locationId))
      .where(
        and(
          inArray(kiosks.outletCode, stillMissing),
          isNull(kioskAssignments.unassignedAt),
          eq(locations.primaryRegionId, regionId),
        ),
      );
    for (const r of kioskRows as Array<{
      outletCode: string | null;
      locationId: string;
    }>) {
      if (r.outletCode && !locByCode.has(r.outletCode)) {
        locByCode.set(r.outletCode, r.locationId);
      }
    }
  }

  // ---- Product resolution ----------------------------------------------------
  // Pass 1: match by netsuiteCode.
  const netsuiteCodes = Array.from(new Set(rows.map((r) => r.netsuiteCode)));
  const byCodeRows = netsuiteCodes.length
    ? await db
        .select({ id: products.id, netsuiteCode: products.netsuiteCode })
        .from(products)
        .where(inArray(products.netsuiteCode, netsuiteCodes))
    : [];
  const prodByCode = new Map<string, string>();
  for (const r of byCodeRows as Array<{ id: string; netsuiteCode: string | null }>) {
    if (r.netsuiteCode) prodByCode.set(r.netsuiteCode, r.id);
  }

  // Pass 2: for inputs not matched by code, try name match where the existing
  //         product row has no netsuiteCode yet. Back-fill on success.
  const unresolvedByName = new Map<string, DimensionInput>(); // key: productName
  for (const row of rows) {
    if (prodByCode.has(row.netsuiteCode)) continue;
    if (!unresolvedByName.has(row.productName)) {
      unresolvedByName.set(row.productName, row);
    }
  }

  const prodByName = new Map<string, string>(); // key: productName → id
  if (unresolvedByName.size > 0) {
    const names = Array.from(unresolvedByName.keys());
    const nameRows = await db
      .select({
        id: products.id,
        name: products.name,
        categoryCode: products.categoryCode,
        categoryName: products.categoryName,
      })
      .from(products)
      .where(and(inArray(products.name, names), isNull(products.netsuiteCode)));

    type NameRow = {
      id: string;
      name: string;
      categoryCode: string | null;
      categoryName: string | null;
    };
    for (const r of nameRows as NameRow[]) {
      const input = unresolvedByName.get(r.name);
      if (!input) continue;
      // Back-fill netsuiteCode and any null metadata columns. `apiProductName`
      // lives on salesRecords (denormalised), not on products — so it is not
      // part of the product back-fill.
      await db
        .update(products)
        .set({
          netsuiteCode: input.netsuiteCode,
          categoryCode: r.categoryCode ?? input.categoryCode,
          categoryName: r.categoryName ?? input.categoryName,
          updatedAt: new Date(),
        })
        .where(eq(products.id, r.id));
      prodByCode.set(input.netsuiteCode, r.id);
      prodByName.set(r.name, r.id);
    }
  }

  // Pass 3: auto-create anything still unresolved. Dedup by netsuiteCode so
  //         we only create one row per unique code in this batch.
  const toCreate = new Map<string, DimensionInput>(); // key: netsuiteCode
  for (const row of rows) {
    if (prodByCode.has(row.netsuiteCode)) continue;
    if (prodByName.has(row.productName)) continue;
    if (!toCreate.has(row.netsuiteCode)) toCreate.set(row.netsuiteCode, row);
  }
  // `apiProductName` is denormalised on salesRecords, not on products.
  const toCreateArr = Array.from(toCreate.values());
  if (toCreateArr.length) {
    const created = await db
      .insert(products)
      .values(
        toCreateArr.map((i) => ({
          name: i.productName,
          netsuiteCode: i.netsuiteCode,
          categoryCode: i.categoryCode,
          categoryName: i.categoryName,
        })),
      )
      .returning({ id: products.id, netsuiteCode: products.netsuiteCode });
    for (const c of created as Array<{ id: string; netsuiteCode: string | null }>) {
      if (c.netsuiteCode) prodByCode.set(c.netsuiteCode, c.id);
    }
  }

  // ---- Provider resolution ---------------------------------------------------
  const providerNames = Array.from(
    new Set(
      rows
        .map((r) => r.providerName)
        .filter((v): v is string => v !== null && v !== undefined && v.length > 0),
    ),
  );
  const provByName = new Map<string, string>();
  if (providerNames.length) {
    const provRows = await db
      .select({ id: providersTable.id, name: providersTable.name })
      .from(providersTable)
      .where(inArray(providersTable.name, providerNames));
    for (const r of provRows as Array<{ id: string; name: string }>) {
      provByName.set(r.name, r.id);
    }
    // Auto-create any missing providers.
    const missing = providerNames.filter((n) => !provByName.has(n));
    if (missing.length) {
      const created = await db
        .insert(providersTable)
        .values(missing.map((name) => ({ name })))
        .returning({ id: providersTable.id, name: providersTable.name });
      for (const c of created as Array<{ id: string; name: string }>) {
        provByName.set(c.name, c.id);
      }
    }
  }

  // ---- Assemble results ------------------------------------------------------
  return rows.map<ResolvedRow>((r) => {
    const errors: RowValidationError[] = [];

    let locationId = locByCode.get(r.outletCode);
    if (!locationId) {
      if (opts.sentinelLocationId) {
        // Phase 7 fallback — unmatched outlet code is routed to the
        // LOCATION_NEEDED sentinel for operator triage via Plan C.
        locationId = opts.sentinelLocationId;
      } else {
        errors.push({
          field: "outletCode",
          message: `Unknown outletCode '${r.outletCode}' for region ${regionId}`,
        });
      }
    }

    const productId = prodByCode.get(r.netsuiteCode) ?? prodByName.get(r.productName);
    // productId should always be resolved (pass 3 auto-creates), but guard.
    if (!productId) {
      errors.push({
        field: "productName",
        message: `Unable to resolve product '${r.productName}' (code ${r.netsuiteCode})`,
      });
    }

    let providerId: string | null = null;
    if (r.providerName !== null && r.providerName !== undefined && r.providerName.length > 0) {
      providerId = provByName.get(r.providerName) ?? null;
    }

    if (errors.length > 0) {
      return { rowNumber: r.rowNumber, errors };
    }
    return {
      rowNumber: r.rowNumber,
      locationId: locationId!,
      productId: productId!,
      providerId,
    };
  });
}
