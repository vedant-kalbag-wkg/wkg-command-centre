import { AppShell } from "@/components/layout/app-shell";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getSessionOrThrow, canAccessSensitiveFields } from "@/lib/rbac";

export default async function NewLocationPage() {
  const session = await getSessionOrThrow();
  const role = session.user.role ?? "viewer";

  return (
    <AppShell title="New Location">
      <div className="mx-auto max-w-3xl">
        <LocationDetailForm canSeeSensitive={canAccessSensitiveFields(role)} />
      </div>
    </AppShell>
  );
}
