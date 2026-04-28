import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { GeocodingClient } from "./geocoding-client";

export const dynamic = "force-dynamic";

export default async function GeocodingPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Location Geocoding"
        description="Populate latitude/longitude on locations via the Google Maps Geocoding API. Dry-run shows every candidate with proposed coordinates and confidence; Apply writes them with one audit-log row per location. Skip-existing is the default; tick 'Re-geocode all' to overwrite already-populated rows."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <GeocodingClient />
      </div>
    </div>
  );
}
