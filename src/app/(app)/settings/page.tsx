import Link from "next/link";
import { Users, GitBranch, ScrollText, Copy, FileUp, SlidersHorizontal, Ban, CalendarDays, ClipboardCheck, Gauge } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
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
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Settings"
        description="Workspace configuration, data management, and administration."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-2xl">
          <Link href="/settings/users" className="group">
            <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <CardTitle className="text-base font-medium">Users</CardTitle>
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                  Manage team members, roles, and access permissions.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/settings/pipeline-stages" className="group">
            <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <GitBranch className="w-5 h-5 text-primary" />
                  </div>
                  <CardTitle className="text-base font-medium">
                    Pipeline Stages
                  </CardTitle>
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                  Add, rename, reorder, and delete pipeline stages for kiosk
                  tracking.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          {isAdmin && (
            <Link href="/settings/audit-log" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ScrollText className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">
                      Audit Log
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    View all changes made across kiosks and locations with actor,
                    field, and timestamp details.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/data-import/sales" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileUp className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Sales Import</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Upload a sales CSV, validate rows, and commit into the sales fact table.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/duplicates" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Copy className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Duplicates</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Detect and merge duplicate hotel locations.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/analytics-presets" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <SlidersHorizontal className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Analytics Presets</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Manage saved filter configurations for analytics views.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/outlet-exclusions" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Ban className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Outlet Exclusions</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Exclude outlet codes from analytics using exact or regex patterns.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/business-events" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <CalendarDays className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Business Events</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Annotate trend charts with business events and manage event categories.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/data-quality" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ClipboardCheck className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Data Quality</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    View which locations are missing region, hotel group, operating group, or market metadata.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {isAdmin && (
            <Link href="/settings/thresholds" className="group">
              <Card className="h-full cursor-pointer border-border/40 transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Gauge className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base font-medium">Performance Thresholds</CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground">
                    Configure traffic-light revenue thresholds (Red / Amber / Green) for analytics views.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
