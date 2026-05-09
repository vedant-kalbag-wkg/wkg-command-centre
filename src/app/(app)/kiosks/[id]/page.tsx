import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { KioskDetailForm } from "@/components/kiosks/kiosk-detail-form";
import { KioskDetailActions } from "@/components/kiosks/kiosk-detail-actions";
import {
  getKiosk,
  listPipelineStages,
  listLocationsForSelect,
} from "@/app/(app)/kiosks/actions";
import { getSessionOrThrow } from "@/lib/rbac";
import { KioskAdminPanel } from "./kiosk-admin-panel";

interface KioskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function KioskDetailPage({ params }: KioskDetailPageProps) {
  const { id } = await params;

  const [kioskResult, stages, locations, session] = await Promise.all([
    getKiosk(id),
    listPipelineStages(),
    listLocationsForSelect(),
    getSessionOrThrow(),
  ]);

  if ("error" in kioskResult) {
    notFound();
  }

  const { kiosk } = kioskResult;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={kiosk.kioskId}
        description="Kiosk details, deployment, and audit trail"
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <Link
                  href="/kiosks"
                  className="transition-colors hover:text-foreground"
                >
                  Kiosks
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{kiosk.kioskId}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={<KioskDetailActions kioskId={kiosk.id} />}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <KioskDetailForm
            kiosk={kiosk}
            pipelineStages={stages}
            locations={locations}
          />
          {session.user.role === "admin" && (
            <KioskAdminPanel
              kioskId={kiosk.id}
              isSilenced={kiosk.alertSilencedAt !== null}
              currentReason={kiosk.alertSilencedReason ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
