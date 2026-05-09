"use server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export async function triggerRunNow(): Promise<
  | { ok: true }
  | { ok: false; error: string; minutesRemaining?: number }
> {
  const session = await requireRole("admin");

  // 5-min server-side rate limit (defence against bypass of the
  // 60s Inngest dedupe key; protects against admin double-click after
  // a manual refresh resets the client state).
  const lastRun = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "performance_alert_run"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  if (lastRun[0]) {
    const elapsedMs = Date.now() - lastRun[0].createdAt.getTime();
    if (elapsedMs < RATE_LIMIT_MS) {
      const minutesRemaining = Math.ceil((RATE_LIMIT_MS - elapsedMs) / 60_000);
      return { ok: false, error: "Rate limited", minutesRemaining };
    }
  }

  const minuteBucket = Math.floor(Date.now() / 60_000);
  await inngest.send({
    id: `performance-alerts-manual-${session.user.id}-${minuteBucket}`,
    name: "performance-alerts/run.requested",
    data: {
      actorId: session.user.id,
      actorName: session.user.name ?? "unknown admin",
    },
  });

  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name ?? "unknown admin",
    entityType: "performance_alert_run",
    entityId: `manual-${Date.now()}`,
    entityName: "Manual run trigger",
    action: "trigger",
  });

  return { ok: true };
}
