import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listKiosks, listPipelineStages } from "@/app/(app)/kiosks/actions";
import { ViewTabsClient } from "./view-tabs-client";

export default async function KiosksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "kanban", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  const [kiosks, stages] = await Promise.all([
    listKiosks(),
    listPipelineStages(),
  ]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Kiosks"
        description="Manage, track, and configure deployed kiosks"
        count={kiosks.length}
        actions={
          <Link href="/kiosks/new">
            <Button size="sm">
              <Plus className="size-4" />
              Add kiosk
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <ViewTabsClient
          activeView={activeView}
          kiosks={kiosks}
          stages={stages}
        />
      </div>
    </div>
  );
}
