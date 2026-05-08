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
  /**
   * Phase 07-06 — `customer_code` from the sales CSV (`Cust_cd`). When
   * populated, the dimension resolver consults it FIRST (Pass 0) to resolve
   * the location via `locations.customer_code` — the new canonical
   * hotel-level identifier. Empty string / null falls through to the
   * kiosk-side outlet_code fallback (Pass 1).
   */
  customerCode: string | null;
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
 * Resolve outletCode / customerCode / netsuiteCode+productName / providerName
 * to FK ids, scoped to a single region.
 *
 * Location resolution passes (Phase 07-06):
 *
 *   - **Pass 0 (top priority — new):** if the sales row has a non-empty
 *     `customerCode`, look up `locations.customer_code = customerCode AND
 *     primary_region_id = regionId`. This is the canonical hotel-level
 *     identifier and matches the way the sales CSV's `Cust_cd` column maps
 *     to the location row.
 *   - **Pass 1 (fallback):** for rows that didn't resolve in Pass 0, look
 *     up `kiosks.outlet_code = outletCode` and follow the active
 *     `kiosk_assignments.location_id` to get the location. This handles
 *     the v2 model where outlet codes are per-kiosk attributes — a sales
 *     row with no `customerCode` (legacy data, or a Heathrow row with no
 *     RPS account) still resolves through the kiosk's own outlet code.
 *   - **Pass 2 (sentinel):** anything still unresolved falls to
 *     `opts.sentinelLocationId` if set, otherwise produces a validation
 *     error. The Plan C merge UI surfaces the sentinel orphans for triage.
 *
 * Pre-07-06 the first pass keyed off `locations.outlet_code` directly. That
 * column is gone (migration 0040); this resolver was the LAST consumer of
 * the conflated kiosk-vs-hotel outlet_code semantic, so removing it
 * completes the Phase 7 schema correction.
 *
 * Products are resolved in three passes (unchanged):
 *   1. match on `products.netsuite_code` (unique, region-agnostic);
 *   2. match on `products.name` where `netsuite_code IS NULL`, then
 *      back-fill the code (and any null category/api columns) so
 *      subsequent runs match by the strong key;
 *   3. auto-create with all NetSuite columns populated.
 *
 * Providers are resolved by name; unknown names are auto-created.
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

  // ---- Location resolution ---------------------------------------------------
  //
  // Two maps drive the per-row resolution at the bottom of the function:
  //   - `locByCustomerCode` — populated by Pass 0 when the row has a
  //     non-empty customerCode that matches a row on locations.
  //   - `locByOutletCode` — populated by Pass 1 (kiosk → assignment → location)
  //     for any outletCode that didn't resolve via Pass 0.
  // The per-row assembly checks them in that order.

  // ---- Pass 0 — customer_code lookup (region-scoped) -------------------------
  const customerCodes = Array.from(
    new Set(
      rows
        .map((r) => r.customerCode)
        .filter((c): c is string => c !== null && c.length > 0),
    ),
  );
  const locByCustomerCode = new Map<string, string>();
  if (customerCodes.length > 0) {
    const ccRows = await db
      .select({ id: locations.id, customerCode: locations.customerCode })
      .from(locations)
      .where(
        and(
          eq(locations.primaryRegionId, regionId),
          inArray(locations.customerCode, customerCodes),
        ),
      );
    for (const r of ccRows as Array<{ id: string; customerCode: string | null }>) {
      if (r.customerCode) locByCustomerCode.set(r.customerCode, r.id);
    }
  }

  // ---- Pass 1 — kiosks.outlet_code → kiosk_assignments.location_id ----------
  // Only consult this for outlet codes whose row didn't already resolve via
  // Pass 0 (avoid touching the kiosk_assignments table when the answer is
  // already in hand). Active-assignment scoped + region-scoped through the
  // location.
  const outletCodesNeedingPass1 = Array.from(
    new Set(
      rows
        .filter((r) => {
          if (r.customerCode && locByCustomerCode.has(r.customerCode)) {
            return false; // resolved by Pass 0
          }
          return true;
        })
        .map((r) => r.outletCode),
    ),
  );
  const locByOutletCode = new Map<string, string>();
  if (outletCodesNeedingPass1.length > 0) {
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
          inArray(kiosks.outletCode, outletCodesNeedingPass1),
          isNull(kioskAssignments.unassignedAt),
          eq(locations.primaryRegionId, regionId),
        ),
      );
    for (const r of kioskRows as Array<{
      outletCode: string | null;
      locationId: string;
    }>) {
      if (r.outletCode && !locByOutletCode.has(r.outletCode)) {
        locByOutletCode.set(r.outletCode, r.locationId);
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

    // Phase 07-06 — Pass 0 (customer_code) → Pass 1 (kiosk outlet_code) →
    // sentinel fallback. The first non-undefined map hit wins.
    let locationId: string | undefined;
    if (r.customerCode) {
      locationId = locByCustomerCode.get(r.customerCode);
    }
    if (!locationId) {
      locationId = locByOutletCode.get(r.outletCode);
    }
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
