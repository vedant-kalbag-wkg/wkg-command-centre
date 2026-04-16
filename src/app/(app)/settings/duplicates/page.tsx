import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/rbac";
import { DuplicatesClient } from "./duplicates-client";

export default async function DuplicatesPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }

  return (
    <AppShell title="Duplicate Locations">
      <DuplicatesClient />
    </AppShell>
  );
}
