import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listLocations } from "@/app/(app)/locations/actions";
import { LocationTable } from "@/components/locations/location-table";
import { ShowArchivedToggle } from "@/components/locations/show-archived-toggle";
import { detectSameNameGroups } from "@/lib/locations/same-name-detection";

// Phase 7.8 — `?archived=1` query param flips the list to include archived
// rows. Default view is unchanged. RSC reads the param, the toggle on the
// client navigates with the new param.
//
// Phase 7 Plan 07-04 (DATA-03 / D-09) — `?filter=same-name` constrains the
// list to active rows that participate in a same-name group. The banner
// above the table renders unconditionally when groups exist (independent of
// the filter), and the "View duplicates" CTA flips the URL into the filter
// state. Filter wiring happens client-side in LocationTable via the prop
// below; the page-level RSC computes the group set once per route load.
export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; filter?: string }>;
}) {
  const { archived, filter } = await searchParams;
  const includeArchived = archived === "1";
  const [allLocations, sameNameGroups] = await Promise.all([
    listLocations({ includeArchived }),
    detectSameNameGroups(),
  ]);

  const dupeCount = sameNameGroups.length;
  const sameNameFilter = filter === "same-name";
  const sameNameLocationIds = sameNameFilter
    ? new Set(sameNameGroups.flatMap((g) => g.locationIds))
    : null;
  const visibleLocations = sameNameLocationIds
    ? allLocations.filter((l) => sameNameLocationIds.has(l.id))
    : allLocations;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Locations"
        description="Venues where kiosks are deployed"
        count={visibleLocations.length}
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
        {dupeCount > 0 && (
          <Alert variant="warning" className="mb-4">
            <AlertTriangle className="size-4" />
            <AlertTitle className="font-bold tracking-[-0.01em]">
              Duplicate location names detected
            </AlertTitle>
            <AlertDescription>
              {dupeCount} location group{dupeCount === 1 ? "" : "s"} share the
              same name. Select affected rows and use Merge to consolidate
              them.{" "}
              <Link href="/locations?filter=same-name" className="underline">
                View duplicates
              </Link>
            </AlertDescription>
          </Alert>
        )}
        <LocationTable data={visibleLocations} />
      </div>
    </div>
  );
}
