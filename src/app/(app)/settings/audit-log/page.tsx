import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AuditTable } from "@/components/audit/audit-table";
import { requireRole } from "@/lib/rbac";

export default async function AuditLogPage() {
  // Admin-only page
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Audit Log"
        description="All entity changes across kiosks and locations."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <AuditTable />
      </div>
    </div>
  );
}
