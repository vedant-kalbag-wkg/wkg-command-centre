import { AppShell } from "@/components/layout/app-shell";
import { listConfigGroups } from "./actions";
import { ConfigGroupsTable } from "@/components/kiosk-config-groups/config-groups-table";

export default async function KioskConfigGroupsPage() {
  const groups = await listConfigGroups();
  return (
    <AppShell title="Kiosk Config Groups">
      <ConfigGroupsTable data={groups} />
    </AppShell>
  );
}
