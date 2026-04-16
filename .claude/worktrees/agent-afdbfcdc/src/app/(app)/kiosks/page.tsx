import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { listKiosks, listPipelineStages } from "@/app/(app)/kiosks/actions";
import { listInstallations } from "@/app/(app)/installations/actions";
import { ViewTabsClient } from "./view-tabs-client";

export default async function KiosksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "kanban", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  const [kiosks, stages, installationsResult] = await Promise.all([
    listKiosks(),
    listPipelineStages(),
    listInstallations(),
  ]);

  // listInstallations can return { error: string } if auth fails — fall back to empty array
  const installations = Array.isArray(installationsResult)
    ? installationsResult
    : [];

  return (
    <AppShell
      title="Kiosks"
      action={
        <Link href="/kiosks/new">
          <Button className="bg-wk-azure text-white hover:bg-wk-azure/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Add kiosk
          </Button>
        </Link>
      }
    >
      <ViewTabsClient
        activeView={activeView}
        kiosks={kiosks}
        stages={stages}
        installations={installations}
      />
    </AppShell>
  );
}
