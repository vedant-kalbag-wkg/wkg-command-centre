import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { InstallationForm } from "@/components/installations/installation-form";
import { MilestoneList } from "@/components/installations/milestone-list";
import { ResourceMemberList } from "@/components/installations/resource-member-list";
import { InstallationDetailActions } from "@/components/installations/installation-detail-actions";
import {
  getInstallation,
  listUsersForSelect,
} from "@/app/(app)/installations/actions";

interface InstallationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InstallationDetailPage({
  params,
}: InstallationDetailPageProps) {
  const { id } = await params;

  const [installationResult, usersResult] = await Promise.all([
    getInstallation(id),
    listUsersForSelect(),
  ]);

  if ("error" in installationResult) {
    redirect("/installations");
  }

  const installation = installationResult;
  const availableUsers = "error" in usersResult ? [] : usersResult;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={installation.name}
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
                <BreadcrumbPage>{installation.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        actions={
          <InstallationDetailActions installationId={installation.id} />
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Installation details (editable form) */}
          <div>
            <h2 className="text-base font-semibold text-foreground tracking-[-0.01em] mb-4">
              Details
            </h2>
            <InstallationForm
              installation={installation}
              installationId={installation.id}
            />
          </div>

          {/* Right: Milestones + Team */}
          <div className="flex flex-col gap-6">
            {/* Milestones card */}
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-base font-semibold text-foreground tracking-[-0.01em] mb-3">
                Milestones
              </h2>
              <MilestoneList
                milestones={installation.milestones}
                installationId={installation.id}
              />
            </div>

            {/* Team card */}
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-base font-semibold text-foreground tracking-[-0.01em] mb-3">
                Team
              </h2>
              <ResourceMemberList
                members={installation.members}
                installationId={installation.id}
                availableUsers={availableUsers}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
