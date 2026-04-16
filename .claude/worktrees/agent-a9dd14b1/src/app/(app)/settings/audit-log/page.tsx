import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell title="Audit Log">
      <AuditTable />
    </AppShell>
  );
}
