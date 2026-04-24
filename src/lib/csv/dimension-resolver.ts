import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { locations, products, providers as providersTable } from "@/db/schema";
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
  apiProductName: string | null;
  providerName: string | null;
};

export type ResolveOptions = { regionId: string };

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
  for (const input of toCreate.values()) {
    // `apiProductName` is denormalised on salesRecords, not on products.
    const [created] = await db
      .insert(products)
      .values({
        name: input.productName,
        netsuiteCode: input.netsuiteCode,
        categoryCode: input.categoryCode,
        categoryName: input.categoryName,
      })
      .returning({ id: products.id });
    prodByCode.set(input.netsuiteCode, created.id);
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
    for (const name of missing) {
      const [created] = await db
        .insert(providersTable)
        .values({ name })
        .returning({ id: providersTable.id });
      provByName.set(name, created.id);
    }
  }

  // ---- Assemble results ------------------------------------------------------
  return rows.map<ResolvedRow>((r) => {
    const errors: RowValidationError[] = [];

    const locationId = locByCode.get(r.outletCode);
    if (!locationId) {
      errors.push({
        field: "outletCode",
        message: `Unknown outletCode '${r.outletCode}' for region ${regionId}`,
      });
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

// Re-export sql so that any caller constructing dynamic predicates elsewhere
// can share the same drizzle instance without a separate import. (Kept for
// parity with the previous resolver surface.)
export { sql };
