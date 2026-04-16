import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { listInstallations } from "@/app/(app)/installations/actions";
import { InstallationTable } from "@/components/installations/installation-table";

export default async function InstallationsPage() {
  const result = await listInstallations();
  const installations = "error" in result ? [] : result;

  return (
    <AppShell
      title="Installations"
      action={
        <Link href="/installations/new">
          <Button className="bg-wk-azure text-white hover:bg-wk-azure/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Add installation
          </Button>
        </Link>
      }
    >
      <InstallationTable data={installations} />
    </AppShell>
  );
}
