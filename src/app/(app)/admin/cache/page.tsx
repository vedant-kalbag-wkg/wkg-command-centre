import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/layout/page-header";
import { CachePurgePanel } from "./cache-purge-panel";

export default async function AdminCachePage() {
  await requireRole("admin");

  const recentPurges = await db
    .select({
      id: auditLogs.id,
      actorName: auditLogs.actorName,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "cache"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Cache management"
        description="Invalidate cached analytics data. Emergency use — caches expire automatically every 24h."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <CachePurgePanel recentPurges={recentPurges} />
      </div>
    </div>
  );
}
