"use server";

import { db } from "@/db";
import { products, providers, locationProducts, locations } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";

export type ProductListItem = {
  id: string;
  name: string;
  providerName: string | null;
  hotelsOffering: number;
  hotelsUnavailable: number;
};

export async function listProducts(): Promise<ProductListItem[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
    })
    .from(products)
    .orderBy(products.name);

  const result: ProductListItem[] = [];
  for (const row of rows) {
    const counts = await db
      .select({
        availability: locationProducts.availability,
        count: sql<number>`count(*)::int`,
      })
      .from(locationProducts)
      .where(eq(locationProducts.productId, row.id))
      .groupBy(locationProducts.availability);

    const countMap = new Map(counts.map((c) => [c.availability, c.count]));

    const providerRow = await db
      .select({ name: providers.name })
      .from(locationProducts)
      .innerJoin(providers, eq(locationProducts.providerId, providers.id))
      .where(eq(locationProducts.productId, row.id))
      .limit(1);

    result.push({
      id: row.id,
      name: row.name,
      providerName: providerRow[0]?.name ?? null,
      hotelsOffering: countMap.get("yes") ?? 0,
      hotelsUnavailable: (countMap.get("no") ?? 0) + (countMap.get("unavailable") ?? 0),
    });
  }
  return result;
}

export type ProductDetailItem = {
  locationId: string;
  locationName: string;
  availability: string;
  providerName: string | null;
};

export async function getProductDetail(productId: string): Promise<{
  product: { id: string; name: string } | null;
  hotels: ProductDetailItem[];
}> {
  const [product] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) return { product: null, hotels: [] };

  const rows = await db
    .select({
      locationId: locationProducts.locationId,
      locationName: locations.name,
      availability: locationProducts.availability,
      providerName: providers.name,
    })
    .from(locationProducts)
    .innerJoin(locations, eq(locationProducts.locationId, locations.id))
    .leftJoin(providers, eq(locationProducts.providerId, providers.id))
    .where(eq(locationProducts.productId, productId))
    .orderBy(locations.name);

  return {
    product,
    hotels: rows.map((r) => ({
      locationId: r.locationId,
      locationName: r.locationName,
      availability: r.availability,
      providerName: r.providerName,
    })),
  };
}

export async function createProduct(
  data: { name: string }
): Promise<{ id: string } | { error: string }> {
  try {
    await requireRole("admin");
    const validated = z.object({ name: z.string().min(1).max(200) }).parse(data);
    const [newProduct] = await db
      .insert(products)
      .values({ name: validated.name })
      .returning({ id: products.id });
    return { id: newProduct.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create product" };
  }
}

export async function deleteProduct(
  productId: string
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    await db.delete(locationProducts).where(eq(locationProducts.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete product" };
  }
}
