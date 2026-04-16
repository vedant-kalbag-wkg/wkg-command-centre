import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isAdmin } from "@/lib/rbac";
import { listUsers } from "@/app/(app)/settings/users/actions";
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell title="Users">
      <UsersPageClient initialUsers={initialUsers} isAdmin={admin} />
    </AppShell>
  );
}
