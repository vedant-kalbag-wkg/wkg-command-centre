import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { SalesImportClient } from "./sales-import-client";

export default async function SalesImportPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Sales Import"
        description="Upload a CSV of sales rows. Preview validates before committing."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <SalesImportClient />
      </div>
    </div>
  );
}
