import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getConfigGroupDetail } from "../actions";
import { ConfigGroupMembersClient } from "@/components/kiosk-config-groups/config-group-members-client";

// Phase 7.6b — member-management view. Shows the locations currently
// assigned to this config group plus a picker for unassigned candidates.
// Editor-level access (the underlying setConfigGroupMembers requires
// admin OR member role).
export default async function KioskConfigGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getConfigGroupDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={detail.name}
        description="Locations assigned to this kiosk config group"
        count={detail.members.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <ConfigGroupMembersClient
          groupId={detail.id}
          groupName={detail.name}
          initialMembers={detail.members}
          candidates={detail.candidates}
        />
      </div>
    </div>
  );
}
