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

  const { location } = locationResult;
  const allowed = new Set(readableFields(ctx.ability, "Location"));
  const canSeeSensitive = allowed.has("bankingDetails");

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
