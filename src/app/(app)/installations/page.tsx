import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listInstallations } from "@/app/(app)/installations/actions";
import { listKiosks } from "@/app/(app)/kiosks/actions";
import { InstallationViewTabsClient } from "./view-tabs-client";

export default async function InstallationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  const [installationsResult, kiosks] = await Promise.all([
    listInstallations(),
    listKiosks(),
  ]);

  const installations = Array.isArray(installationsResult)
    ? installationsResult
    : [];

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Installations"
        description="Plan deployment timelines, milestones, and teams"
        count={installations.length}
        actions={
          <Link href="/installations/new">
            <Button size="sm">
              <Plus className="size-4" />
              Add installation
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <InstallationViewTabsClient
          activeView={activeView}
          installations={installations}
          kiosks={kiosks}
        />
      </div>
    </div>
  );
}
