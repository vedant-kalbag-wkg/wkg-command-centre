import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getLocation } from "@/app/(app)/locations/actions";
import { getSessionOrThrow, canAccessSensitiveFields } from "@/lib/rbac";

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
  const role = session.user.role ?? "viewer";

  return (
    <AppShell title={location.name}>
      <div className="mx-auto max-w-3xl">
        <LocationDetailForm
          location={location}
          canSeeSensitive={canAccessSensitiveFields(role)}
        />
      </div>
    </AppShell>
  );
}
