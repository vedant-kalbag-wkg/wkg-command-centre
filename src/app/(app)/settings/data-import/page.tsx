import { AppShell } from "@/components/layout/app-shell";
import { DataImportClient } from "./data-import-client";
import { requireRole } from "@/lib/rbac";

export default async function DataImportPage() {
  await requireRole("admin");
  const boardId = process.env.MONDAY_BOARD_ID ?? "";
  return (
    <AppShell title="Data Import">
      <DataImportClient defaultBoardId={boardId} />
    </AppShell>
  );
}
