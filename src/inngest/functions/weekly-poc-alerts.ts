/**
 * Weekly POC underperformance alert job.
 *
 * Fires every Monday at 09:00 Europe/London, or on demand via the
 * "performance-alerts/run.requested" event. Classifies all eligible mature
 * hotels by composite-score percentile, computes tier changes, and emails each
 * POC whose hotels are in the bottom tier.
 *
 * Steps:
 *   1. load-config       — classify hotels via SQL (5 sub-metrics → composite)
 *   2. diff-state        — compare against location_performance_alert_state
 *   3. (inline)          — detect first-run; suppress all alerts on cold start
 *   4. write-state       — upsert location_performance_alert_state rows
 *   5. emit-poc-emails   — fan-out email/send.requested events per POC
 *   6. emit-skip-rows    — write email_log skip rows for hotels with no POC
 *   7. write-run-audit   — append performance_alert_run audit log row
 */

import { sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { locationPerformanceAlertState, emailLog, user } from "@/db/schema";
import { inngest } from "../client";
import { classifyEligibleLocations } from "@/lib/performance-alerts/classify-locations";
import {
  decideAlert,
  type Decision,
  type Tier,
} from "@/lib/performance-alerts/classify-dispatch";
import { groupByPoc } from "@/lib/performance-alerts/poc-batching";
import { isoWeekKey } from "@/lib/performance-alerts/iso-week";
import { sha256 } from "@/lib/performance-alerts/hash";
import { formatRevenueForKiosk } from "@/lib/performance-alerts/format-currency";
import { writeAuditLog } from "@/lib/audit";
import { BRAND } from "@/emails/brand";

// ─── Constants ────────────────────────────────────────────────────────────────

const HOTEL_TRUNCATION_CAP = 25;

// ─── Inline event type (D-03: do not add to events.ts) ───────────────────────

type PerformanceAlertsRunRequested = {
  name: "performance-alerts/run.requested";
  data: {
    actorId?: string;
    actorName?: string;
  };
};

// ─── Step / event shims for testability ──────────────────────────────────────

export type StepShim = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (id: string, events: unknown[]) => Promise<unknown>;
};

type EventShim = {
  name?: string;
  data?: { actorId?: string; actorName?: string };
};

// ─── Core handler (exported for integration tests) ───────────────────────────

export async function _handleWeeklyPocAlerts({
  step,
  runId,
  event,
}: {
  step: StepShim;
  runId: string;
  event?: EventShim;
}): Promise<{
  alerted: number;
  skipped: number;
  classified: number;
  firstRun: boolean;
}> {
  // ── Step 1: classify ────────────────────────────────────────────────────────
  const classification = await step.run("load-config", async () => {
    return await classifyEligibleLocations();
  });

  const locationIds = classification.rows.map((r) => r.locationId);

  // ── Step 2: diff-state ──────────────────────────────────────────────────────
  const decisions = await step.run("diff-state", async () => {
    const now = new Date();
    const priorRows =
      locationIds.length === 0
        ? []
        : await db
            .select()
            .from(locationPerformanceAlertState)
            .where(inArray(locationPerformanceAlertState.locationId, locationIds));
    const priorByLocation = new Map(priorRows.map((r) => [r.locationId, r]));

    return classification.rows.map((row) => {
      const prior = priorByLocation.get(row.locationId);
      const decision = decideAlert(
        prior
          ? { tier: prior.tier as Tier, lastAlertedAt: prior.lastAlertedAt }
          : null,
        row.tier,
        now,
      );
      return {
        ...row,
        decision,
        priorTier: (prior?.tier as Tier | undefined) ?? null,
        lastAlertedAt: prior?.lastAlertedAt ?? null,
        hadPriorRow: !!prior,
      };
    });
  });

  // ── Step 3: detect first-run ─────────────────────────────────────────────────
  // Pitfall 8 option a: if every hotel is new (no prior state rows), suppress
  // all alerts — this is a cold-start run, not a genuine underperformance event.
  const firstRun =
    decisions.length > 0 && decisions.every((d) => !d.hadPriorRow);
  const effectiveDecisions = firstRun
    ? decisions.map((d) => ({ ...d, decision: "no-alert" as Decision }))
    : decisions;

  // ── Step 4: write-state ─────────────────────────────────────────────────────
  // Compute `runIsoWeek` inside this step boundary so Inngest memoises it across
  // retries (CR-02). Outside any step.run, a retry that crosses a Monday
  // boundary in Europe/London would recompute a different ISO week and defeat
  // the email_log payloadHash dedup → duplicate emails.
  const runIsoWeek = await step.run("write-state", async () => {
    const now = new Date();
    for (const d of effectiveDecisions) {
      // numeric(6,2) accepts string on insert under drizzle's default mode;
      // .toFixed(2) matches the column scale exactly.
      const compositeScoreStr = d.compositeScore.toFixed(2);
      await db
        .insert(locationPerformanceAlertState)
        .values({
          locationId: d.locationId,
          tier: d.tier,
          compositeScore: compositeScoreStr,
          classifiedAt: now,
          lastRunAt: now,
          lastAlertedAt:
            d.decision === "flip-in" || d.decision === "chronic"
              ? now
              : d.lastAlertedAt,
        })
        .onConflictDoUpdate({
          target: locationPerformanceAlertState.locationId,
          set: {
            tier: d.tier,
            compositeScore: compositeScoreStr,
            classifiedAt: now,
            lastRunAt: now,
            lastAlertedAt:
              d.decision === "flip-in" || d.decision === "chronic"
                ? now
                : sql`excluded.last_alerted_at`,
          },
        });
    }
    return isoWeekKey(now);
  });

  // ── Step 5: emit-poc-emails ─────────────────────────────────────────────────
  // Inngest does not replay step.run closures — return counts as the step's
  // resolved value (CR-03). Closure-side mutation of an outer `let` would
  // leave the counter at 0 on every retry replay.
  const alertable = effectiveDecisions.filter((d) => d.decision !== "no-alert");
  const groups = groupByPoc(alertable);

  const alertedCount = await step.run("emit-poc-emails", async () => {
    const realPocGroups = groups.filter((g) => g.pocUserId !== null);
    if (realPocGroups.length === 0) return 0;

    const pocIds = realPocGroups.map((g) => g.pocUserId!);
    const userRows = await db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(user)
      .where(inArray(user.id, pocIds));
    const userById = new Map(userRows.map((u) => [u.id, u]));

    const events = realPocGroups
      .map((g) => {
        const u = userById.get(g.pocUserId!);
        if (!u || !u.email) return null;

        // Worst (lowest composite) hotels surface first — matches the email
        // body's "these need attention" framing.
        const sortedHotels = [...g.kiosks].sort(
          (a, b) => a.compositeScore - b.compositeScore,
        );
        const truncated = sortedHotels.slice(0, HOTEL_TRUNCATION_CAP);
        const moreCount = Math.max(0, sortedHotels.length - HOTEL_TRUNCATION_CAP);
        const subject = `These hotels are underperforming — ${sortedHotels.length} hotel${sortedHotels.length === 1 ? "" : "s"} need attention`;

        return {
          name: "email/send.requested" as const,
          data: {
            kind: "underperforming_poc" as const,
            to: u.email,
            subject,
            template: "poc-underperformance" as const,
            templateProps: {
              pocName: u.name ?? "there",
              hotels: truncated.map((hr) => {
                const salesPerRoomValue = hr.subMetrics.revenuePerRoom.value;
                return {
                  locationId: hr.locationId,
                  hotelName: hr.hotelName,
                  region: hr.region,
                  currency: hr.currency,
                  // Pre-format with the hotel's modal currency. The template
                  // renders these strings verbatim — see comment in
                  // src/emails/poc-underperformance.tsx.
                  totalRevenue: formatRevenueForKiosk(hr.totalRevenue, hr.currency),
                  totalTransactions: hr.totalTransactions,
                  kioskCount: hr.kioskCount,
                  numRooms: hr.numRooms,
                  // null when numRooms is unknown — template renders "—".
                  salesPerRoom:
                    salesPerRoomValue === null
                      ? null
                      : formatRevenueForKiosk(salesPerRoomValue, hr.currency),
                  // 0–100 composite, rounded to whole for display.
                  compositeScore: Math.round(hr.compositeScore),
                  subMetricPercentiles: {
                    revenue: Math.round(hr.subMetrics.revenue.percentile ?? 0),
                    transactions: Math.round(hr.subMetrics.transactions.percentile ?? 0),
                    revenuePerRoom:
                      hr.subMetrics.revenuePerRoom.percentile === null
                        ? null
                        : Math.round(hr.subMetrics.revenuePerRoom.percentile),
                    txnPerKiosk: Math.round(hr.subMetrics.txnPerKiosk.percentile ?? 0),
                    basketValue: Math.round(hr.subMetrics.basketValue.percentile ?? 0),
                  },
                  detailUrl: `${BRAND.prodUrl}/locations/${hr.locationId}`,
                };
              }),
              moreCount,
              windowDays: classification.windowDays,
              runIsoWeek,
              // CR-01: required by pocUnderperformanceText — without it the
              // plain-text CTA link renders as "undefined" for every recipient.
              portfolioUrl: `${BRAND.prodUrl}/analytics/portfolio`,
              // Bottom-tier cutoff is admin-configurable via app_settings;
              // render dynamically so the body copy never drifts from the
              // actual tier boundary.
              bottomPercentile: classification.tierConfig.bottom,
              // Composite-score weights footnote: the email renders these as
              // a sticky "Composite = revenue 30% · transactions 20% · ..."
              // line. Sourced from the classifier so a future migration of
              // weights → app_settings flows through to the rendered email
              // without a coupled change here.
              weights: classification.weights,
            },
            payloadHash: sha256(`${g.pocUserId}:${runIsoWeek}`),
          },
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (events.length > 0) {
      await step.sendEvent("emit-poc-emails", events);
    }
    return events.length;
  });

  // ── Step 6: emit-skip-rows ──────────────────────────────────────────────────
  // Same fix as CR-03: return the count from step.run instead of mutating
  // an outer `let`.
  //
  // No `.onConflictDoNothing()` here — skip rows write `payloadHash: null`,
  // which is excluded from the partial unique index
  // `(kind, payload_hash) WHERE payload_hash IS NOT NULL` (migration 0041).
  // There is no other unique key on this table that would fire, so a conflict
  // clause without an explicit target is a no-op guard. Inngest's per-step
  // memoisation usually prevents duplicate inserts on retry; if the step
  // partially fails after one INSERT, replay would write a second row and the
  // skipped count on the admin dashboard would be inflated. Acceptable
  // imprecision for metrics-only data.
  const skippedCount = await step.run("emit-skip-rows", async () => {
    const skipLocations = effectiveDecisions.filter(
      (d) => d.decision !== "no-alert" && d.internalPocId === null,
    );
    for (let i = 0; i < skipLocations.length; i++) {
      await db.insert(emailLog).values({
        kind: "underperforming_poc",
        recipient: "[skip:no-poc]",
        inngestRunId: runId,
        status: "skipped",
        payloadHash: null,
      });
    }
    return skipLocations.length;
  });

  // ── Step 7: write-run-audit ─────────────────────────────────────────────────
  await step.run("write-run-audit", async () => {
    const isManual = event?.name === "performance-alerts/run.requested";
    await writeAuditLog({
      actorId: isManual ? (event?.data?.actorId ?? "system") : "system",
      actorName: isManual
        ? (event?.data?.actorName ?? "manual trigger")
        : "weekly-poc-alerts cron",
      entityType: "performance_alert_run",
      entityId: runId,
      entityName: `Run ${runIsoWeek}`,
      action: "trigger",
    });
  });

  return {
    alerted: alertedCount,
    skipped: skippedCount,
    classified: effectiveDecisions.length,
    firstRun,
  };
}

// ─── Inngest function registration ───────────────────────────────────────────

export const weeklyPocAlertsFn = inngest.createFunction(
  {
    id: "weekly-poc-alerts",
    name: "Weekly POC underperformance alerts",
    triggers: [
      { cron: "TZ=Europe/London 0 9 * * 1" },
      { event: "performance-alerts/run.requested" as PerformanceAlertsRunRequested["name"] },
    ],
    concurrency: { limit: 1 },
    retries: 3,
  },
  async ({ step, runId, event }) => {
    return await _handleWeeklyPocAlerts({
      step: step as unknown as StepShim,
      runId,
      event: event as unknown as EventShim,
    });
  },
);
