import { AppShell } from "@/components/layout/app-shell";
import { LocationDetailForm } from "@/components/locations/location-detail-form";
import { getSessionOrThrow, canAccessSensitiveFields, type Role } from "@/lib/rbac";

export default async function NewLocationPage() {
  const session = await getSessionOrThrow();
  const userType =
    (session.user as { userType?: "internal" | "external" }).userType ?? "internal";
  const role = (session.user.role as Role | null) ?? "viewer";

  return (
    <AppShell title="New Location">
      <div className="mx-auto max-w-3xl">
        <LocationDetailForm
          canSeeSensitive={canAccessSensitiveFields({ userType, role })}
        />
      </div>
    </AppShell>
  );
}
