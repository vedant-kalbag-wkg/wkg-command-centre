import { and, eq } from "drizzle-orm";
import { products, productCodeFallbacks, salesRecords } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";

// Drizzle DB shape — kept loose so callers can inject a test-container
// `node-postgres`-backed instance OR rely on the prod `postgres-js` default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { transaction: (...args: any[]) => any };

/**
 * Propagate a `product_code_fallbacks` edit to all downstream denormalised
 * copies (`products.netsuiteCode`, `salesRecords.netsuiteCode`) in one
 * transaction, and write a single audit log entry capturing the affected row
 * counts.
 *
 * Returns `{ updatedProducts: 0, updatedSalesRecords: 0 }` with no audit log
 * when the new code matches the existing one (idempotent no-op).
 */
export async function updateFeeCodeFallback(
  db: AnyDb,
  actor: { id: string; name: string },
  productName: string,
  newCode: string,
): Promise<{ updatedProducts: number; updatedSalesRecords: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (db as any).transaction(async (tx: any) => {
    const [existing] = await tx
      .select({
        id: productCodeFallbacks.id,
        netsuiteCode: productCodeFallbacks.netsuiteCode,
      })
      .from(productCodeFallbacks)
      .where(eq(productCodeFallbacks.productName, productName))
      .limit(1);

    if (!existing) {
      throw new Error(`No fallback configured for productName '${productName}'`);
    }

    if (existing.netsuiteCode === newCode) {
      return { updatedProducts: 0, updatedSalesRecords: 0 };
    }

    await tx
      .update(productCodeFallbacks)
      .set({ netsuiteCode: newCode, updatedAt: new Date() })
      .where(eq(productCodeFallbacks.id, existing.id));

    const updatedProductRows = await tx
      .update(products)
      .set({ netsuiteCode: newCode })
      .where(
        and(
          eq(products.name, productName),
          eq(products.netsuiteCode, existing.netsuiteCode),
        ),
      )
      .returning({ id: products.id });

    // `products.netsuiteCode` is globally unique, so any salesRecord with
    // `netsuiteCode = existing.netsuiteCode` necessarily points at the single
    // product we just updated — no productId scoping needed.
    const updatedSalesRows = await tx
      .update(salesRecords)
      .set({ netsuiteCode: newCode })
      .where(eq(salesRecords.netsuiteCode, existing.netsuiteCode))
      .returning({ id: salesRecords.id });

    const updatedProducts = updatedProductRows.length;
    const updatedSalesRecords = updatedSalesRows.length;

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "product_code_fallback",
        entityId: existing.id,
        entityName: productName,
        action: "update",
        field: "netsuite_code",
        oldValue: existing.netsuiteCode,
        newValue: newCode,
        metadata: {
          affectedProducts: updatedProducts,
          affectedSalesRecords: updatedSalesRecords,
        },
      },
      tx,
    );

    return { updatedProducts, updatedSalesRecords };
  });
}
