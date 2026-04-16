import { AppShell } from "@/components/layout/app-shell";
import { listProducts } from "./actions";
import { ProductsTable } from "@/components/products/products-table";

export default async function ProductsPage() {
  const products = await listProducts();
  return (
    <AppShell title="Products">
      <ProductsTable data={products} />
    </AppShell>
  );
}
