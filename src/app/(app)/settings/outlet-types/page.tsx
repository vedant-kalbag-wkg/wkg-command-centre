import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import {
  _listRegionsForActor,
  _listUnclassifiedOutletsForActor,
} from "./pipeline";
import { OutletTypesTable } from "./outlet-types-table";

function readParam(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (!v) return undefined;
  return v;
}

export default async function OutletTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  const sp = await searchParams;
  // `?showClassified=1` = include already-classified rows so operators can
  // re-edit them in place. Default behaviour (param absent) is the original
  // backlog-only listing.
  const showClassified = readParam(sp.showClassified) === "1";

  const [initialRows, regions] = await Promise.all([
    _listUnclassifiedOutletsForActor(db, { includeClassified: showClassified }),
    _listRegionsForActor(db),
  ]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Outlet Types"
        description="Classify new outlets so they flow into analytics dimensions. Suggestions come from name/metadata heuristics — review and save."
        count={initialRows.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <OutletTypesTable
          initialRows={initialRows}
          regions={regions}
          showClassified={showClassified}
        />
      </div>
    </div>
  );
}
