import { PageHeader } from "@/components/layout/page-header";
import { listProducts } from "./actions";
import { ProductsTable } from "@/components/products/products-table";

export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Products"
        description="Catalog imported from Kiosk Config Groups"
        count={products.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <ProductsTable data={products} />
      </div>
    </div>
  );
}
