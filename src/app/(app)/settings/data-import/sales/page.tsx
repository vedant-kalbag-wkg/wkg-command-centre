import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/rbac";
import { SalesImportClient } from "./sales-import-client";

export default async function SalesImportPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <AppShell title="Sales Import">
      <SalesImportClient />
    </AppShell>
  );
}
