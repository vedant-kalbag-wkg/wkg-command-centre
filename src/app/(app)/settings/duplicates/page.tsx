import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { DuplicatesClient } from "./duplicates-client";

export default async function DuplicatesPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Duplicate Locations"
        description="Scan for near-duplicate locations and merge or dismiss pairs."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DuplicatesClient />
      </div>
    </div>
  );
}
