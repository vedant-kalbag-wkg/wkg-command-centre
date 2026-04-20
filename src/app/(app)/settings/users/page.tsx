import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isAdmin } from "@/lib/rbac";
import { listUsers } from "@/app/(app)/settings/users/actions";
import { PageHeader } from "@/components/layout/page-header";
import { UsersPageClient } from "@/app/(app)/settings/users/users-page-client";
import type { UserListItem } from "@/app/(app)/settings/users/actions";

export default async function UsersPage() {
  let userRole = "member";
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    userRole = (session?.user?.role as string) || "member";
  } catch {
    // Session already validated by layout — fallback to non-admin view
  }
  const admin = isAdmin(userRole);

  let initialUsers: UserListItem[] = [];
  if (admin) {
    const result = await listUsers();
    if ("users" in result) {
      initialUsers = result.users;
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Users"
        description="Manage team members, roles, and access to the kiosk tool."
        count={initialUsers.length}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <UsersPageClient initialUsers={initialUsers} isAdmin={admin} />
      </div>
    </div>
  );
}
