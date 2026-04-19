import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { listInstallations } from "@/app/(app)/installations/actions";
import { listKiosks } from "@/app/(app)/kiosks/actions";
import { InstallationViewTabsClient } from "./view-tabs-client";

export default async function InstallationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  const [installationsResult, kiosks] = await Promise.all([
    listInstallations(),
    listKiosks(),
  ]);

  const installations = Array.isArray(installationsResult)
    ? installationsResult
    : [];

  return (
    <AppShell
      title="Installations"
      action={
        <Link href="/installations/new">
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Add installation
          </Button>
        </Link>
      }
    >
      <InstallationViewTabsClient
        activeView={activeView}
        installations={installations}
        kiosks={kiosks}
      />
    </AppShell>
  );
}
