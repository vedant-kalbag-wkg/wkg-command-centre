import Link from "next/link";
import { notFound } from "next/navigation";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { getProductDetail } from "../actions";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface ProductDetailPageProps {
  params: Promise<{ productId: string }>;
}

function availabilityBadge(availability: string) {
  if (availability === "yes") {
    return <Badge variant="subtle-success">Offering</Badge>;
  }
  if (availability === "no") {
    return <Badge variant="subtle-destructive">Unavailable</Badge>;
  }
  return <Badge variant="secondary">{availability}</Badge>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { productId } = await params;
  const { product, hotels } = await getProductDetail(productId);

  if (!product) {
    notFound();
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={product.name}
        count={hotels.length}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <Link
                  href="/products"
                  className="transition-colors hover:text-foreground"
                >
                  Products
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{product.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {hotels.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No hotels configured"
            description="This product isn't assigned to any hotels yet."
          />
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted border-b border-border">
                  <TableHead>Location</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Provider</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hotels.map((hotel) => (
                  <TableRow
                    key={hotel.locationId}
                    className="transition-colors min-h-[44px] hover:bg-primary/10"
                  >
                    <TableCell className="py-2.5">
                      <Link
                        href={`/locations/${hotel.locationId}`}
                        className="text-primary hover:underline"
                      >
                        {hotel.locationName}
                      </Link>
                    </TableCell>
                    <TableCell className="py-2.5">
                      {availabilityBadge(hotel.availability)}
                    </TableCell>
                    <TableCell className="py-2.5 text-muted-foreground">
                      {hotel.providerName ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
