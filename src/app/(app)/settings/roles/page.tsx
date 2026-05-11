import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { listRoles } from "./actions";
import type { RoleListItem } from "./editor-internal";
import { PageHeader } from "@/components/layout/page-header";
import { RoleListClient } from "./role-list-client";

export default async function RolesPage() {
  let canManage = false;
  try {
    const ctx = await getUserCtx();
    canManage =
      ctx.ability.can("manage", "Role") || ctx.ability.can("manage", "all");
  } catch {
    // layout has already validated; fall through to non-admin view
  }

  let initialRoles: RoleListItem[] = [];
  if (canManage) {
    const result = await listRoles();
    if ("roles" in result) {
      initialRoles = result.roles;
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Roles"
        description="Manage RBAC roles, permissions, and tier defaults. Changes apply on the next request."
        count={initialRoles.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <RoleListClient initialRoles={initialRoles} canManage={canManage} />
      </div>
    </div>
  );
}
