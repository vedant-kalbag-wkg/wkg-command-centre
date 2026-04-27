import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listLocations } from "@/app/(app)/locations/actions";
import { LocationTable } from "@/components/locations/location-table";
import { ShowArchivedToggle } from "@/components/locations/show-archived-toggle";

// Phase 7.8 — `?archived=1` query param flips the list to include archived
// rows. Default view is unchanged. RSC reads the param, the toggle on the
// client navigates with the new param.
export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const includeArchived = archived === "1";
  const locations = await listLocations({ includeArchived });

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Locations"
        description="Venues where kiosks are deployed"
        count={locations.length}
        actions={
          <div className="flex items-center gap-3">
            <ShowArchivedToggle includeArchived={includeArchived} />
            <Link href="/locations/new">
              <Button size="sm">
                <Plus className="size-4" />
                Add location
              </Button>
            </Link>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <LocationTable data={locations} />
      </div>
    </div>
  );
}
