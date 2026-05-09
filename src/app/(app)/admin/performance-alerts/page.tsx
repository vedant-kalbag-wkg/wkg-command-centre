import { sql, eq, desc, isNotNull, and } from "drizzle-orm";
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import {
  auditLogs,
  emailLog,
  exchangeRates,
  locationPerformanceAlertState,
  locations,
} from "@/db/schema";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunNowButton } from "./run-now-button";

// Phase 9.1 / D-16 — stale-rate threshold. The BoE daily fetch Inngest
// function runs once a day; if MAX(exchange_rates.fetched_at) is older than
// 24h the cron has either failed or been disabled. Sales ETL hard-fails
// blobs whose currencies have rates older than 7 days (per CONTEXT.md D-07),
// so a 24h-old fetch is the early-warning threshold.
const FX_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export default async function AdminPerformanceAlertsPage() {
  await requireRole("admin");

  // Latest run timestamp = MAX(created_at) on the performance_alert_run audit
  // log row. Reading from `location_performance_alert_state.last_run_at` would
  // miss zero-hotel runs (empty fleet, all-silenced fleet) — those still
  // write an audit_logs row but no state rows, so the dashboard would render
  // "—" for "Last run" while the recent-runs list below contradicted it.
  const [latestRow] = await db
    .select({ ts: sql<Date | null>`MAX(${auditLogs.createdAt})` })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "performance_alert_run"));
  const latestRunAt = latestRow?.ts ?? null;

  // Phase 9.1 / D-16 — FX stale-rate signal. The BoE daily fetch Inngest
  // function writes a row per (currency, rate_date) tuple; the canonical
  // freshness signal is MAX(fetched_at) across the whole table. When this
  // is null (table empty — first cron has not yet run on this branch) or
  // > 24h old (cron failed or disabled), the page renders an inline banner
  // above the latest-run Card so an admin notices before the 7-day hard-fail
  // threshold fires in sales ETL.
  const [latestFxRow] = await db
    .select({ ts: sql<Date | null>`MAX(${exchangeRates.fetchedAt})` })
    .from(exchangeRates);
  const latestFxFetchAt = latestFxRow?.ts ?? null;
  const fxStale =
    !latestFxFetchAt ||
    Date.now() - latestFxFetchAt.getTime() > FX_STALE_THRESHOLD_MS;

  // Counts grouped by tier (for the latest run — tier reflects most-recent classification).
  const tierCountsRows = await db
    .select({
      tier: locationPerformanceAlertState.tier,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(locationPerformanceAlertState)
    .groupBy(locationPerformanceAlertState.tier);
  const tierCounts: Record<string, number> = Object.fromEntries(
    tierCountsRows.map((r) => [r.tier, r.count]),
  );
  const classifiedCount = tierCountsRows.reduce((sum, r) => sum + r.count, 0);
  const bottomCount = tierCounts["Emerging"] ?? 0;

  // Sent/skipped counts in the most recent run window (last 24h to capture both manual + cron).
  const [sentRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, "underperforming_poc"),
        eq(emailLog.status, "sent"),
        sql`${emailLog.createdAt} >= NOW() - INTERVAL '24 hours'`,
      ),
    );
  const [skippedRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, "underperforming_poc"),
        eq(emailLog.status, "skipped"),
        sql`${emailLog.createdAt} >= NOW() - INTERVAL '24 hours'`,
      ),
    );
  const sentCount = sentRow?.count ?? 0;
  const skippedCount = skippedRow?.count ?? 0;

  // Silenced count (per-hotel since Phase 9 hotel-level rewrite).
  const [silencedRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(locations)
    .where(isNotNull(locations.alertSilencedAt));
  const silencedCount = silencedRow?.count ?? 0;

  // Recent runs (last 10).
  const recentRuns = await db
    .select({
      id: auditLogs.id,
      actorName: auditLogs.actorName,
      entityName: auditLogs.entityName,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "performance_alert_run"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Performance alerts"
        description="Weekly POC underperformance alert — last-run metadata + manual trigger."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {fxStale && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">
                FX rates are stale
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>
                Last successful FX rate fetch:{" "}
                <strong>
                  {latestFxFetchAt
                    ? `${latestFxFetchAt.toLocaleString("en-GB")} (${humaniseAge(latestFxFetchAt)} ago)`
                    : "never"}
                </strong>
                .
              </p>
              <p className="mt-2">
                Sales ETL will hard-fail blobs whose currencies have rates
                older than 7 days (per CONTEXT.md D-07). Investigate the{" "}
                <strong>FX rates daily fetch (BoE)</strong> Inngest function
                — its last successful run is the source of truth here.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Latest run</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
            <Stat
              label="Last run"
              value={latestRunAt ? latestRunAt.toLocaleString("en-GB") : "—"}
            />
            <Stat label="Classified" value={String(classifiedCount)} />
            <Stat label="Bottom tier" value={String(bottomCount)} />
            <Stat label="Emails sent (24h)" value={String(sentCount)} />
            <Stat label="Skipped — no POC (24h)" value={String(skippedCount)} />
            <Stat label="Silenced hotels" value={String(silencedCount)} />
          </CardContent>
        </Card>

        <RunNowButton />

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span>
                      {r.entityName} — {r.actorName}
                    </span>
                    <span className="text-muted-foreground">
                      {r.createdAt.toLocaleString("en-GB")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold">{value}</span>
    </div>
  );
}

/**
 * Phase 9.1 / D-16 — humanise the age of the last FX fetch for the stale
 * banner copy. Plain "X hours ago" / "Y days ago" — admin-readable on
 * sight, no need for a heavyweight i18n library here.
 */
function humaniseAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
