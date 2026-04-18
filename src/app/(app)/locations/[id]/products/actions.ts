"use server";

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  providers,
  locationProducts,
  locations,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommissionTier = {
  minRevenue: number;
  maxRevenue: number | null;
  rate: number;
};

export type VersionedTierConfig = {
  effectiveFrom: string;
  tiers: CommissionTier[];
};

export type LocationProductItem = {
  id: string;
  productId: string;
  productName: string;
  providerId: string | null;
  providerName: string | null;
  availability: string;
  commissionTiers: VersionedTierConfig[];
};

export type ProductSelectItem = {
  id: string;
  name: string;
};

export type ProviderSelectItem = {
  id: string;
  name: string;
};

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const availabilitySchema = z.enum(["yes", "no", "unavailable"]);

const commissionTierSchema = z.object({
  minRevenue: z.number(),
  maxRevenue: z.number().nullable(),
  rate: z.number(),
});

const versionedTierConfigSchema = z.object({
  effectiveFrom: z.string(),
  tiers: z.array(commissionTierSchema),
});

const updateLocationProductSchema = z.object({
  availability: availabilitySchema.optional(),
  providerId: z.string().nullable().optional(),
  commissionTiers: z.array(versionedTierConfigSchema).optional(),
});

// ---------------------------------------------------------------------------
// listLocationProducts
// ---------------------------------------------------------------------------

export async function listLocationProducts(
  locationId: string
): Promise<LocationProductItem[]> {
  const rows = await db
    .select({
      id: locationProducts.id,
      productId: locationProducts.productId,
      productName: products.name,
      providerId: locationProducts.providerId,
      providerName: providers.name,
      availability: locationProducts.availability,
      commissionTiers: locationProducts.commissionTiers,
    })
    .from(locationProducts)
    .innerJoin(products, eq(locationProducts.productId, products.id))
    .leftJoin(providers, eq(locationProducts.providerId, providers.id))
    .where(eq(locationProducts.locationId, locationId))
    .orderBy(products.name);

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    providerId: row.providerId ?? null,
    providerName: row.providerName ?? null,
    availability: row.availability,
    commissionTiers: (row.commissionTiers as VersionedTierConfig[]) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// listAllProducts
// ---------------------------------------------------------------------------

export async function listAllProducts(): Promise<ProductSelectItem[]> {
  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .orderBy(products.name);
  return rows;
}

// ---------------------------------------------------------------------------
// listAllProviders
// ---------------------------------------------------------------------------

export async function listAllProviders(): Promise<ProviderSelectItem[]> {
  const rows = await db
    .select({ id: providers.id, name: providers.name })
    .from(providers)
    .orderBy(providers.name);
  return rows;
}

// ---------------------------------------------------------------------------
// updateLocationProduct
// ---------------------------------------------------------------------------

export async function updateLocationProduct(
  id: string,
  data: {
    availability?: string;
    providerId?: string | null;
    commissionTiers?: VersionedTierConfig[];
  }
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");

    const parsed = updateLocationProductSchema.parse(data);

    await db
      .update(locationProducts)
      .set({
        ...(parsed.availability !== undefined && {
          availability: parsed.availability,
        }),
        ...(parsed.providerId !== undefined && {
          providerId: parsed.providerId,
        }),
        ...(parsed.commissionTiers !== undefined && {
          commissionTiers: parsed.commissionTiers,
        }),
        updatedAt: new Date(),
      })
      .where(eq(locationProducts.id, id));

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update product";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// addProduct (D-15: new product propagates to ALL locations as "unavailable")
// ---------------------------------------------------------------------------

export async function addProduct(
  name: string
): Promise<{ success: true; productId: string } | { error: string }> {
  try {
    await requireRole("admin");

    const trimmedName = name.trim();
    if (!trimmedName) {
      return { error: "Product name is required" };
    }

    // Insert product (or ignore if already exists)
    await db
      .insert(products)
      .values({ name: trimmedName })
      .onConflictDoNothing();

    // Get the product ID (either newly created or existing)
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, trimmedName))
      .limit(1);

    if (!product) {
      return { error: "Failed to create or find product" };
    }

    // Fetch ALL location IDs
    const allLocations = await db
      .select({ id: locations.id })
      .from(locations);

    // Insert a locationProducts row for every location (ignore duplicates)
    if (allLocations.length > 0) {
      await db
        .insert(locationProducts)
        .values(
          allLocations.map((loc) => ({
            locationId: loc.id,
            productId: product.id,
            availability: "unavailable",
            commissionTiers: [],
          }))
        )
        .onConflictDoNothing();
    }

    return { success: true, productId: product.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add product";
    return { error: message };
  }
}
