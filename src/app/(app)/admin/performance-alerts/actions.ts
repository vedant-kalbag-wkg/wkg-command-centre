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
  //
  // We read trigger-request rows (`performance_alert_run_request`), NOT
  // the cron's own `performance_alert_run` rows. Those two entity types
  // are intentionally distinct so a) the recent-runs list on the admin
  // dashboard shows ONE entry per actual cron firing (not button-press +
  // run completion), and b) admins can still manually fire immediately
  // after the weekly cron completes — the rate-limit window only counts
  // manual clicks against each other.
  const lastTrigger = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "performance_alert_run_request"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  if (lastTrigger[0]) {
    const elapsedMs = Date.now() - lastTrigger[0].createdAt.getTime();
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
    entityType: "performance_alert_run_request",
    entityId: `manual-${Date.now()}`,
    entityName: "Manual run trigger",
    action: "trigger",
  });

  return { ok: true };
}
