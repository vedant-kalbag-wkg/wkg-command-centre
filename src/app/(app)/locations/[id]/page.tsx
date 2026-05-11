import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { Button } from "@/components/ui/button";
import { getLocation } from "@/app/(app)/locations/actions";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { Can } from "@/lib/casl/ability-context";
import { readableFields } from "@/lib/casl/fields";
import { LocationAdminPanel } from "./location-admin-panel";

interface LocationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LocationDetailPage({ params }: LocationDetailPageProps) {
  const { id } = await params;

  const [locationResult, ctx] = await Promise.all([
    getLocation(id),
    getUserCtx(),
  ]);

  if ("error" in locationResult) {
    notFound();
  }

  const { location: rawLocation } = locationResult;
  const allowed = new Set(readableFields(ctx.ability, "Location"));
  const canSeeSensitive = allowed.has("bankingDetails");

  // Plan 10-14 / Cluster A — readableFields(ability, "Location") returns
  // the Drizzle column set for the `locations` table. Three derived join
  // fields on LocationWithRelations are NOT columns (hotelGroupMemberships,
  // assignedKiosks, internalPocName) and get nulled out by the redaction
  // loop in getLocation (src/app/(app)/locations/actions.ts:283-289).
  // Downstream consumer LocationDetailForm calls .map() on these (lines
  // 373/385/389/940), crashing the page with `Cannot read properties of
  // null (reading 'map')`. Backfill safe defaults here at the RSC boundary
  // so the consumer's signature (LocationWithRelations) is honoured
  // without changing getLocation's contract or the field-redaction
  // semantics.
  const location = {
    ...rawLocation,
    hotelGroupMemberships: rawLocation.hotelGroupMemberships ?? [],
    assignedKiosks: rawLocation.assignedKiosks ?? [],
    internalPocName: rawLocation.internalPocName ?? null,
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={location.name}
        description={location.address ?? undefined}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <LocationDetailForm
            location={location}
            canSeeSensitive={canSeeSensitive}
          />
          <Can I="merge" a="Location">
            <div className="flex items-center justify-end">
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/locations?merge=${location.id}`} />}
              >
                Merge
              </Button>
            </div>
          </Can>
          {ctx.role === "admin" && (
            <LocationAdminPanel
              locationId={location.id}
              isSilenced={location.alertSilencedAt !== null}
              currentReason={location.alertSilencedReason ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
