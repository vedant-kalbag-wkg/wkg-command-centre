import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getLocation } from "@/app/(app)/locations/actions";
import { getSessionOrThrow, canAccessSensitiveFields, type Role } from "@/lib/rbac";

interface LocationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LocationDetailPage({ params }: LocationDetailPageProps) {
  const { id } = await params;

  const [locationResult, session] = await Promise.all([
    getLocation(id),
    getSessionOrThrow(),
  ]);

  if ("error" in locationResult) {
    notFound();
  }

  const { location } = locationResult;
  const userType =
    (session.user as { userType?: "internal" | "external" }).userType ?? "internal";
  const role = (session.user.role as Role | null) ?? "viewer";

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={location.name}
        description={location.address ?? undefined}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <LocationDetailForm
            location={location}
            canSeeSensitive={canAccessSensitiveFields({ userType, role })}
          />
        </div>
      </div>
    </div>
  );
}
