import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell
      title={installation.name}
      action={<InstallationDetailActions installationId={installation.id} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Installation details (editable form) */}
        <div>
          <h2 className="text-base font-semibold text-wk-graphite tracking-[-0.01em] mb-4">
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
          <div className="rounded-lg border border-wk-mid-grey p-4">
            <h2 className="text-base font-semibold text-wk-graphite tracking-[-0.01em] mb-3">
              Milestones
            </h2>
            <MilestoneList
              milestones={installation.milestones}
              installationId={installation.id}
            />
          </div>

          {/* Team card */}
          <div className="rounded-lg border border-wk-mid-grey p-4">
            <h2 className="text-base font-semibold text-wk-graphite tracking-[-0.01em] mb-3">
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
    </AppShell>
  );
}
