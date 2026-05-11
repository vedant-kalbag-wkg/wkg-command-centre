import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listRoles } from "@/app/(app)/settings/roles/actions";
import { listUserRoles } from "./role-actions";
import { listScopes } from "./scopes-actions";
import { PageHeader } from "@/components/layout/page-header";
import { RoleAssignmentClient } from "./role-assignment-client";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getUserCtx();
  if (!(ctx.ability.can("manage", "User") || ctx.ability.can("manage", "all"))) {
    redirect("/settings");
  }

  const [target] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  if (!target) notFound();

  const [assignmentsResult, rolesResult, scopesResult] = await Promise.all([
    listUserRoles(id).catch(() => []),
    listRoles().catch(() => ({ error: "Failed to load roles" })),
    listScopes(id).catch(() => []),
  ]);

  const allRoles = "roles" in rolesResult ? rolesResult.roles : [];

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title={target.name ?? target.email ?? "User"}
        description={target.email ?? "User details"}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <RoleAssignmentClient
          userId={id}
          initialAssignments={assignmentsResult}
          allRoles={allRoles}
          initialScopes={scopesResult}
        />
      </div>
    </div>
  );
}
