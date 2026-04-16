import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getProductDetail } from "../actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ProductDetailPageProps {
  params: Promise<{ productId: string }>;
}

function availabilityBadge(availability: string) {
  if (availability === "yes") {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Offering</Badge>;
  }
  if (availability === "no") {
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Unavailable</Badge>;
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
    <AppShell title={product.name}>
      {hotels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-wk-graphite/60 text-sm">
            No hotels configured for this product yet.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hotels.map((hotel) => (
              <TableRow key={hotel.locationId}>
                <TableCell>
                  <Link
                    href={`/locations/${hotel.locationId}`}
                    className="text-wk-azure hover:underline"
                  >
                    {hotel.locationName}
                  </Link>
                </TableCell>
                <TableCell>{availabilityBadge(hotel.availability)}</TableCell>
                <TableCell className="text-wk-graphite/70">
                  {hotel.providerName ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
