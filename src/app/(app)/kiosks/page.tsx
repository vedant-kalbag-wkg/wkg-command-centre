import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listKiosks, listPipelineStages } from "@/app/(app)/kiosks/actions";
import { getTrialsEndingSoon } from "@/app/(app)/locations/actions";
import { TrialEndingBanner } from "@/components/kiosks/trial-ending-banner";
import { ViewTabsClient } from "./view-tabs-client";

export default async function KiosksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "kanban", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  // Phase 7.10 / D11 — banner only renders when at least one location has a
  // freeTrialEndDate ≤ 30 days out. Fetched in the same Promise.all so the
  // page paints in one round trip.
  const [kiosks, stages, trialsEndingSoon] = await Promise.all([
    listKiosks(),
    listPipelineStages(),
    getTrialsEndingSoon(30),
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
        <TrialEndingBanner items={trialsEndingSoon} />
        <ViewTabsClient
          activeView={activeView}
          kiosks={kiosks}
          stages={stages}
        />
      </div>
    </div>
  );
}
