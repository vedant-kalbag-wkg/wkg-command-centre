import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell title={location.name}>
      <div className="mx-auto max-w-3xl">
        <LocationDetailForm
          location={location}
          canSeeSensitive={canAccessSensitiveFields({ userType, role })}
        />
      </div>
    </AppShell>
  );
}
