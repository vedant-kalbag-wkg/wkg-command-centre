import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KioskDetailForm } from "@/components/kiosks/kiosk-detail-form";
import { getKiosk, listPipelineStages, listLocationsForSelect } from "@/app/(app)/kiosks/actions";

interface KioskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function KioskDetailPage({ params }: KioskDetailPageProps) {
  const { id } = await params;

  const [kioskResult, stages, locations] = await Promise.all([
    getKiosk(id),
    listPipelineStages(),
    listLocationsForSelect(),
  ]);

  if ("error" in kioskResult) {
    notFound();
  }

  const { kiosk } = kioskResult;

  return (
    <AppShell title={kiosk.kioskId}>
      <div className="mx-auto max-w-3xl">
        <KioskDetailForm
          kiosk={kiosk}
          pipelineStages={stages}
          locations={locations}
        />
      </div>
    </AppShell>
  );
}
