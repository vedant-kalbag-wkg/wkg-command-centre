import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { InstallationForm } from "@/components/installations/installation-form";

export default function NewInstallationPage() {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="New installation"
        description="Create a new installation to plan kiosk deployment"
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <Link
                  href="/installations"
                  className="transition-colors hover:text-foreground"
                >
                  Installations
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-lg">
          <InstallationForm />
        </div>
      </div>
    </div>
  );
}
