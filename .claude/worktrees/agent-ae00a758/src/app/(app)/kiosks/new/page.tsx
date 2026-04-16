import { AppShell } from "@/components/layout/app-shell";
import { KioskDetailForm } from "@/components/kiosks/kiosk-detail-form";
import { listPipelineStages, listLocationsForSelect } from "@/app/(app)/kiosks/actions";

export default async function NewKioskPage() {
  const [stages, locations] = await Promise.all([
    listPipelineStages(),
    listLocationsForSelect(),
  ]);

  return (
    <AppShell title="New Kiosk">
      <div className="mx-auto max-w-3xl">
        <KioskDetailForm
          pipelineStages={stages}
          locations={locations}
        />
      </div>
    </AppShell>
  );
}
