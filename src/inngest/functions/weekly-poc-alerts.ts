/**
 * Weekly POC underperformance alert job.
 *
 * Fires every Monday at 09:00 Europe/London, or on demand via the
 * "performance-alerts/run.requested" event. Classifies all eligible live
 * kiosks, computes tier changes, and emails each POC whose kiosks are in the
 * bottom tier.
 *
 * Steps:
 *   1. load-config       — classify kiosks via SQL
 *   2. diff-state        — compare against kiosk_performance_alert_state
 *   3. (inline)          — detect first-run; suppress all alerts on cold start
 *   4. write-state       — upsert kiosk_performance_alert_state rows
 *   5. emit-poc-emails   — fan-out email/send.requested events per POC
 *   6. emit-skip-rows    — write email_log skip rows for kiosks with no POC
 *   7. write-run-audit   — append performance_alert_run audit log row
 */

import { sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { kioskPerformanceAlertState, emailLog, user } from "@/db/schema";
import { inngest } from "../client";
import {
  classifyEligibleKiosks,
  type ClassifiedKioskRow,
} from "@/lib/performance-alerts/classify-kiosks";
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

const KIOSK_TRUNCATION_CAP = 25;

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
    return await classifyEligibleKiosks();
  });

  const kioskIds = classification.rows.map((r) => r.kioskId);

  // ── Step 2: diff-state ──────────────────────────────────────────────────────
  const decisions = await step.run("diff-state", async () => {
    const now = new Date();
    const priorRows =
      kioskIds.length === 0
        ? []
        : await db
            .select()
            .from(kioskPerformanceAlertState)
            .where(inArray(kioskPerformanceAlertState.kioskId, kioskIds));
    const priorByKiosk = new Map(priorRows.map((r) => [r.kioskId, r]));

    return classification.rows.map((row) => {
      const prior = priorByKiosk.get(row.kioskId);
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
  // Pitfall 8 option a: if every kiosk is new (no prior state rows), suppress
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
      await db
        .insert(kioskPerformanceAlertState)
        .values({
          kioskId: d.kioskId,
          tier: d.tier,
          classifiedAt: now,
          lastRunAt: now,
          lastAlertedAt:
            d.decision === "flip-in" || d.decision === "chronic"
              ? now
              : d.lastAlertedAt,
        })
        .onConflictDoUpdate({
          target: kioskPerformanceAlertState.kioskId,
          set: {
            tier: d.tier,
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

        const sortedKiosks = [...g.kiosks].sort(
          (a, b) => (a as ClassifiedKioskRow).revenue - (b as ClassifiedKioskRow).revenue,
        );
        const truncated = sortedKiosks.slice(0, KIOSK_TRUNCATION_CAP);
        const moreCount = Math.max(0, sortedKiosks.length - KIOSK_TRUNCATION_CAP);
        const subject = `Performance update — ${sortedKiosks.length} kiosk${sortedKiosks.length === 1 ? "" : "s"} need attention`;

        return {
          name: "email/send.requested" as const,
          data: {
            kind: "underperforming_poc" as const,
            to: u.email,
            subject,
            template: "poc-underperformance" as const,
            templateProps: {
              pocName: u.name ?? "there",
              kiosks: truncated.map((k) => {
                const kr = k as ClassifiedKioskRow;
                return {
                  kioskId: kr.outletCode,
                  locationName: kr.locationName,
                  region: kr.region,
                  // Pre-format with the kiosk's own currency. The template
                  // renders this string verbatim — see comment in
                  // src/emails/poc-underperformance.tsx.
                  revenue: formatRevenueForKiosk(kr.revenue, kr.currency),
                  percentile: kr.percentile,
                  detailUrl: `${BRAND.prodUrl}/kiosks/${kr.kioskId}`,
                };
              }),
              moreCount,
              windowDays: classification.windowDays,
              runIsoWeek,
              // CR-01: required by pocUnderperformanceText — without it the
              // plain-text CTA link renders as "undefined" for every recipient.
              portfolioUrl: `${BRAND.prodUrl}/analytics/portfolio`,
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
    const skipKiosks = effectiveDecisions.filter(
      (d) => d.decision !== "no-alert" && d.internalPocId === null,
    );
    for (let i = 0; i < skipKiosks.length; i++) {
      await db.insert(emailLog).values({
        kind: "underperforming_poc",
        recipient: "[skip:no-poc]",
        inngestRunId: runId,
        status: "skipped",
        payloadHash: null,
      });
    }
    return skipKiosks.length;
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
