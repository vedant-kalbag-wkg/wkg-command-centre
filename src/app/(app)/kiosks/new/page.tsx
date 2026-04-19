import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { KioskDetailForm } from "@/components/kiosks/kiosk-detail-form";
import {
  listPipelineStages,
  listLocationsForSelect,
} from "@/app/(app)/kiosks/actions";

export default async function NewKioskPage() {
  const [stages, locations] = await Promise.all([
    listPipelineStages(),
    listLocationsForSelect(),
  ]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="New kiosk"
        description="Register a new kiosk and configure its deployment details"
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
                <BreadcrumbPage>New kiosk</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <KioskDetailForm pipelineStages={stages} locations={locations} />
        </div>
      </div>
    </div>
  );
}
