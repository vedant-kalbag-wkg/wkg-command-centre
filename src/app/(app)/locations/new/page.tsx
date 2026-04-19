import { PageHeader } from "@/components/layout/page-header";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getSessionOrThrow, canAccessSensitiveFields, type Role } from "@/lib/rbac";

export default async function NewLocationPage() {
  const session = await getSessionOrThrow();
  const userType =
    (session.user as { userType?: "internal" | "external" }).userType ?? "internal";
  const role = (session.user.role as Role | null) ?? "viewer";

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="New Location"
        description="Create a venue to assign kiosks to"
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <LocationDetailForm
            canSeeSensitive={canAccessSensitiveFields({ userType, role })}
          />
        </div>
      </div>
    </div>
  );
}
