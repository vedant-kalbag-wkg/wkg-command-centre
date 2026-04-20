import { PageHeader } from "@/components/layout/page-header";
import { listConfigGroups } from "./actions";
import { ConfigGroupsTable } from "@/components/kiosk-config-groups/config-groups-table";

export default async function KioskConfigGroupsPage() {
  const groups = await listConfigGroups();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Kiosk Config Groups"
        description="Product availability groupings imported from Monday.com"
        count={groups.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <ConfigGroupsTable data={groups} />
      </div>
    </div>
  );
}
