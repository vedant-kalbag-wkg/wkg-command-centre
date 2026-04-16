import { AppShell } from "@/components/layout/app-shell";
import { InstallationForm } from "@/components/installations/installation-form";

export default function NewInstallationPage() {
  return (
    <AppShell title="New Installation">
      <div className="mx-auto max-w-lg">
        <InstallationForm />
      </div>
    </AppShell>
  );
}
