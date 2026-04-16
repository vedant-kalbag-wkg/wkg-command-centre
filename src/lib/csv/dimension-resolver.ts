import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { locations, products, providers as providersTable } from "@/db/schema";
import type { RowValidationError } from "./sales-csv";

export type DimensionInput = {
  rowNumber: number;
  outletCode: string;
  productName: string;
  providerName: string | null;
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
 * Batch-resolve outletCode / productName / providerName to FK ids.
 *
 * Exactly three SELECT queries regardless of input size:
 *   - locations WHERE outlet_code IN (...)
 *   - products  WHERE LOWER(name) IN (...)
 *   - providers WHERE LOWER(name) IN (...)
 *
 * Case rules:
 *   - outletCode  : exact match (stable identifier)
 *   - productName : case-insensitive
 *   - providerName: case-insensitive; null input → null providerId (valid)
 *
 * Unknown values produce row-level errors pinned to the offending field;
 * multiple unknowns on one row accumulate into that row's errors array.
 */
export async function resolveDimensions(
  db: NodePgDatabase,
  rows: DimensionInput[],
): Promise<ResolvedRow[]> {
  if (rows.length === 0) return [];

  const outletCodes = Array.from(new Set(rows.map((r) => r.outletCode)));
  const productNames = Array.from(new Set(rows.map((r) => r.productName.toLowerCase())));
  const providerNames = Array.from(
    new Set(
      rows
        .map((r) => r.providerName?.toLowerCase())
        .filter((v): v is string => v !== null && v !== undefined),
    ),
  );

  const [locRows, prodRows, provRows] = await Promise.all([
    db
      .select({ id: locations.id, outletCode: locations.outletCode })
      .from(locations)
      .where(inArray(locations.outletCode, outletCodes)),
    db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(sql`LOWER(${products.name})`, productNames)),
    providerNames.length
      ? db
          .select({ id: providersTable.id, name: providersTable.name })
          .from(providersTable)
          .where(inArray(sql`LOWER(${providersTable.name})`, providerNames))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const locByCode = new Map<string, string>();
  for (const r of locRows) {
    if (r.outletCode) locByCode.set(r.outletCode, r.id);
  }
  const prodByLower = new Map<string, string>();
  for (const r of prodRows) prodByLower.set(r.name.toLowerCase(), r.id);
  const provByLower = new Map<string, string>();
  for (const r of provRows) provByLower.set(r.name.toLowerCase(), r.id);

  return rows.map((r) => {
    const errors: RowValidationError[] = [];

    const locationId = locByCode.get(r.outletCode);
    if (!locationId) {
      errors.push({
        field: "outletCode",
        message: `Unknown outletCode: ${r.outletCode}`,
      });
    }

    const productId = prodByLower.get(r.productName.toLowerCase());
    if (!productId) {
      errors.push({
        field: "productName",
        message: `Unknown productName: ${r.productName}`,
      });
    }

    let providerId: string | null = null;
    if (r.providerName !== null) {
      const match = provByLower.get(r.providerName.toLowerCase());
      if (!match) {
        errors.push({
          field: "providerName",
          message: `Unknown providerName: ${r.providerName}`,
        });
      } else {
        providerId = match;
      }
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
