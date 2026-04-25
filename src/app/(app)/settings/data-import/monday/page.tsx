import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { MondayImportButton } from "./monday-import-button";

// Vercel serverless function max duration — Monday import is ~30-60s; give
// ourselves 5min margin for slow Monday GraphQL pages + DB writes. The server
// action invoked from this page inherits the page's function timeout.
// (Next 15 rejects this export inside "use server" files — must live here.)
export const maxDuration = 300;

export default async function MondayImportPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  // Only read at render time — env vars are available in server components.
  const hasToken = Boolean(process.env.MONDAY_API_TOKEN);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Monday Import"
        description="Re-import location products and commission tiers from Monday.com. Runs the same logic as scripts/import-location-products-from-monday.ts — TRUNCATEs location_products then rebuilds. Placeholders for hotels missing outlet codes on Monday are created automatically and appear under Outlet Types for review."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <MondayImportButton hasToken={hasToken} />
      </div>
    </div>
  );
}
