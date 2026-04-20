import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listLocations } from "@/app/(app)/locations/actions";
import { LocationTable } from "@/components/locations/location-table";

export default async function LocationsPage() {
  const locations = await listLocations();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Locations"
        description="Venues where kiosks are deployed"
        count={locations.length}
        actions={
          <Link href="/locations/new">
            <Button size="sm">
              <Plus className="size-4" />
              Add location
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <LocationTable data={locations} />
      </div>
    </div>
  );
}
