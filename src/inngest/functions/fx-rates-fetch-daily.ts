/**
 * Daily Bank of England spot-rate fetch.
 *
 * Fires every day at 06:00 Europe/London (D-02 — ordered before the existing
 * Azure sales ETL slot; matches BoE's London publishing tz so we always read
 * the freshest day-of CSV). Pulls the full {@link BOE_SERIES_TO_CCY} keyset for
 * "today" and idempotently upserts into `exchange_rates` keyed on
 * `(currency, rate_date)` per migration 0046's composite PK.
 *
 * Steps:
 *   1. fetch-boe       — single GET against BoE IADB CSV (delegated to
 *                        {@link fetchBoeRatesForDate})
 *   2. upsert-rates    — bulk insert with `onConflictDoNothing` on the
 *                        (currency, rate_date) PK so retries / next-day re-runs
 *                        are no-ops (D-02)
 *   3. write-run-audit — append `fx_rate_fetch_run` audit row (run history
 *                        readable off audit_logs, mirrors weekly-poc-alerts'
 *                        `performance_alert_run` shape)
 *
 * Failure handling (D-06 / D-08 / RESEARCH Pitfall 1):
 *   - HTTP / network / parse error caught at the handler boundary
 *     → fan-out `email/send.requested(kind="fx_rate_fetch_failed")` → re-throw
 *     so Inngest counts it as a retry. `retries: 5` (RESEARCH Code Examples —
 *     higher than POC alerts because BoE is the only rate source; carry-forward
 *     gives us another buffer day, but the operator email needs to fire fast).
 *   - Empty CSV payload (BoE non-publish day: Sat / Sun / UK bank holiday) is
 *     NOT a failure — `parseBoeCsv` returns `[]`, we record upserted=0, write
 *     the audit row, and rely on D-05 carry-forward at ETL time. Distinguishing
 *     this from "real fetch error" is load-bearing — promoting empty-data to a
 *     failure would page the operator every weekend.
 *
 * Per PATTERNS shared pattern 3: extracted handler + StepShim type so the
 * Wave 0 integration test (tests/inngest/fx-rates-fetch-daily.integration.test.ts)
 * drives this body directly without spinning up the full Inngest dev server.
 */

import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { fetchBoeRatesForDate, type ParsedRate } from "@/lib/fx/boe-fetch";
import { getFxAlertRecipient } from "@/lib/fx/alert-recipient";
import { writeAuditLog } from "@/lib/audit";

import { inngest } from "../client";

// ─── Step / event shims for testability ──────────────────────────────────────

export type StepShim = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (id: string, events: unknown[]) => Promise<unknown>;
};

export type FxRatesFetchDailyResult = {
  fetched: number;
  upserted: number;
  alerted: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Today as ISO YYYY-MM-DD in UTC. The cron itself fires at 06:00 Europe/London,
 * which is 05:00 or 06:00 UTC depending on BST — for our purpose we want "the
 * date that BoE just published rates for", which is always the calendar day in
 * UTC at the moment of cron firing (BoE publishes at ~16:00 London → already
 * yesterday's date by the time our 06:00-next-day cron reads it; using UTC
 * today is correct because we read the CSV "for date X" where X is today).
 */
function todayIso(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Core handler (exported for integration tests) ───────────────────────────

/**
 * Per CONTEXT.md D-02: daily BoE spot-rate fetch, ordered before Azure ETL.
 * Per D-06 / D-08: HTTP / network / parse failure → fan-out
 *   `fx_rate_fetch_failed` alert + re-throw so Inngest counts the retry.
 * Per D-05 / RESEARCH Pitfall 1: empty payload (BoE non-publish day: Sat / Sun
 *   / UK bank holiday) is NOT a failure — carry-forward via {@link getRateForDate}
 *   at ETL time handles it.
 * Per PATTERNS Shared Pattern 3: extracted handler + {@link StepShim} type for
 *   integration-test drivability.
 */
export async function _handleFxRatesFetchDaily(args: {
  step: StepShim;
  runId: string;
  /** Override for tests; defaults to today's UTC ISO date. */
  isoDate?: string;
}): Promise<FxRatesFetchDailyResult> {
  const isoDate = args.isoDate ?? todayIso();
  let alerted = false;

  // ── Step 1: fetch-boe ───────────────────────────────────────────────────────
  // Wrapped in try / catch at the handler boundary so the alert fan-out fires
  // BEFORE the re-throw (Inngest discards step state on throw — emitting the
  // event from inside the failed step.run would skip the alert on retry-5).
  let rates: ParsedRate[] = [];
  try {
    rates = await args.step.run("fetch-boe", async () => {
      return await fetchBoeRatesForDate(isoDate);
    });
  } catch (err) {
    // D-06 / D-08: real fetch failure → emit alert + re-throw so Inngest
    // counts the retry. RESEARCH Open Question #3 — recipient defaults to
    // the prod admin (auto-memory `prod-admin-account`) but is overridable
    // via FX_ALERT_TO env var.
    alerted = true;
    const reason = err instanceof Error ? err.message : String(err);
    await args.step.sendEvent("emit-fx-fetch-failed", [
      {
        name: "email/send.requested",
        data: {
          kind: "fx_rate_fetch_failed",
          // Phase 9.1 CR-02 — FX_ALERT_TO required; throws at call site if unset
          // (no hardcoded prod admin literal in source). Set on Vercel preview
          // AND production env vars per 09.1-HUMAN-UAT.md step 4.
          to: getFxAlertRecipient(),
          subject: `FX rates daily fetch failed (${isoDate})`,
          template: "plain-text",
          templateProps: { reason, isoDate, runId: args.runId },
          // payloadHash deduplicates retries within the same run — the partial
          // unique idx on email_log.(kind, payload_hash) catches Inngest's
          // exponential-backoff replays so we don't spam the inbox 5×.
          payloadHash: `fx_rate_fetch_failed:${isoDate}:${args.runId}`,
        },
      },
    ]);
    throw err;
  }

  // ── Step 2: upsert-rates ────────────────────────────────────────────────────
  // Idempotent: composite PK (currency, rate_date) from migration 0046, so a
  // re-run on the same date drops the duplicate rows silently. Empty `rates`
  // (Sat / Sun / holiday) skips the INSERT entirely — no-op upsert is wasted
  // SQL.
  const upserted = await args.step.run("upsert-rates", async () => {
    if (rates.length === 0) return 0;
    await db
      .insert(exchangeRates)
      .values(
        rates.map((r) => ({
          currency: r.currency,
          rateDate: r.rateDate,
          // numeric(18,10) accepts string at insert under drizzle's default
          // mode; toString() on a number > 6 sig figs would lose JPY-class
          // precision via float coercion, so we hand the parser-validated
          // number directly to drizzle as a string.
          rateToGbp: String(r.rate),
          source: "boe" as const,
        })),
      )
      .onConflictDoNothing({
        target: [exchangeRates.currency, exchangeRates.rateDate],
      });
    return rates.length;
  });

  // ── Step 3: write-run-audit ─────────────────────────────────────────────────
  // Mirrors the weekly-poc-alerts.ts `performance_alert_run` shape — operators
  // read run history off audit_logs (cron has no other persistent timeline).
  await args.step.run("write-run-audit", async () => {
    await writeAuditLog({
      actorId: "system",
      actorName: "fx-rates-fetch-daily cron",
      entityType: "fx_rate_fetch_run",
      entityId: args.runId,
      entityName: `Run ${isoDate}`,
      action: "trigger",
    });
  });

  return { fetched: rates.length, upserted, alerted };
}

// ─── Inngest function registration ───────────────────────────────────────────

/**
 * Per D-02: TZ=Europe/London 0 6 * * * (06:00 London, before Azure sales ETL
 * slot). Per RESEARCH § Code Examples: retries: 5 (higher than POC alerts'
 * `retries: 3` because BoE is the only rate source — no fallback path; the
 * alert email must fire fast on a real outage, but the carry-forward window
 * gives us a few days of grace before D-07 staleness bites).
 */
export const fxRatesFetchDailyFn = inngest.createFunction(
  {
    id: "fx-rates-fetch-daily",
    name: "FX rates daily fetch (BoE)",
    triggers: [{ cron: "TZ=Europe/London 0 6 * * *" }],
    concurrency: { limit: 1 },
    retries: 5,
  },
  async ({ step, runId }) => {
    return await _handleFxRatesFetchDaily({
      step: step as unknown as StepShim,
      runId,
    });
  },
);
