import Link from "next/link";
import { Users, GitBranch, ScrollText, Database } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { requireRole } from "@/lib/rbac";

export default async function SettingsPage() {
  // Determine if current user is admin (for conditional Audit Log card)
  let isAdmin = false;
  try {
    await requireRole("admin");
    isAdmin = true;
  } catch {
    // Non-admin users see the page without Audit Log card
  }

  return (
    <AppShell title="Settings">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-2xl">
        <Link href="/settings/users" className="group">
          <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
                  <Users className="w-5 h-5 text-wk-azure" />
                </div>
                <CardTitle className="text-base font-medium">Users</CardTitle>
              </div>
              <CardDescription className="text-sm text-wk-night-grey">
                Manage team members, roles, and access permissions.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/settings/pipeline-stages" className="group">
          <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
                  <GitBranch className="w-5 h-5 text-wk-azure" />
                </div>
                <CardTitle className="text-base font-medium">
                  Pipeline Stages
                </CardTitle>
              </div>
              <CardDescription className="text-sm text-wk-night-grey">
                Add, rename, reorder, and delete pipeline stages for kiosk
                tracking.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        {isAdmin && (
          <Link href="/settings/audit-log" className="group">
            <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
                    <ScrollText className="w-5 h-5 text-wk-azure" />
                  </div>
                  <CardTitle className="text-base font-medium">
                    Audit Log
                  </CardTitle>
                </div>
                <CardDescription className="text-sm text-wk-night-grey">
                  View all changes made across kiosks and locations with actor,
                  field, and timestamp details.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}

        {isAdmin && (
          <Link href="/settings/data-import" className="group">
            <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
                    <Database className="w-5 h-5 text-wk-azure" />
                  </div>
                  <CardTitle className="text-base font-medium">Data Import</CardTitle>
                </div>
                <CardDescription className="text-sm text-wk-night-grey">
                  Import kiosk and location records from Monday.com.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </AppShell>
  );
}
