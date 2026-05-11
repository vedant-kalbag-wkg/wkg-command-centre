import { PageHeader } from "@/components/layout/page-header";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { readableFields } from "@/lib/casl/fields";

export default async function NewLocationPage() {
  const ctx = await getUserCtx();
  const allowed = new Set(readableFields(ctx.ability, "Location"));
  const canSeeSensitive = allowed.has("bankingDetails");

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="New Location"
        description="Create a venue to assign kiosks to"
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <LocationDetailForm
            canSeeSensitive={canSeeSensitive}
          />
        </div>
      </div>
    </div>
  );
}
