import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import { _listUnclassifiedOutletsForActor } from "./pipeline";
import { OutletTypesTable } from "./outlet-types-table";

export default async function OutletTypesPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  const initialRows = await _listUnclassifiedOutletsForActor(db);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Outlet Types"
        description="Classify new outlets so they flow into analytics dimensions. Suggestions come from name/metadata heuristics — review and save."
        count={initialRows.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <OutletTypesTable initialRows={initialRows} />
      </div>
    </div>
  );
}
