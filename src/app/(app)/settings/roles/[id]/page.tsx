import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getRole } from "../actions";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RoleEditorClient } from "./role-editor-client";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getUserCtx();
  if (
    !(ctx.ability.can("manage", "Role") || ctx.ability.can("manage", "all"))
  ) {
    redirect("/settings");
  }
  const result = await getRole(id);
  if ("error" in result) {
    if (result.error === "Role not found") notFound();
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <PageHeader title="Role" description={result.error} />
      </div>
    );
  }
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={result.role.displayName}
        description={`Kind: ${result.role.kind}`}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <RoleEditorClient role={result.role} />
      </div>
    </div>
  );
}
