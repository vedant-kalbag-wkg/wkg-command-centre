---
phase: 09-poc-underperformance-alerts
plan: 03
type: execute
wave: 3
depends_on: [01, 02, 04]
files_modified:
  - src/lib/performance-alerts/classify-kiosks.ts
  - src/db/schema.ts
  - migrations/0044_phase_09_email_log_skipped_status.sql
  - src/inngest/functions/weekly-poc-alerts.ts
  - src/app/api/inngest/route.ts
  - src/lib/audit.ts
  - tests/performance-alerts/eligibility.integration.test.ts
  - tests/performance-alerts/null-poc-skip.integration.test.ts
  - tests/performance-alerts/idempotency.integration.test.ts
notes: >
  BORDERLINE SCOPE — after BLOCKER 1+2 + BLOCKER 3 fixes from
  plan-checker iteration 1, this plan now owns 6 tasks across ~10
  files (cron + per-kiosk SQL + 3 integration tests + email_log
  status migration + Inngest registration + audit.ts entityType
  union). The cohesion is too tight to split cleanly: the migration
  unblocks the integration tests, the integration tests assert the
  cron's email_log writes, the cron emits events that 09-04's
  template consumes. The executor MUST take a fresh context window
  before starting this plan (run `/clear`) to keep this within the
  ~50% context budget.
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "Inngest function 'weekly-poc-alerts' is registered and reachable via cron + manual event triggers"
    - "Cron classifies eligible Live kiosks per-kiosk using existing percentile cutoffs over the configured window"
    - "Per-POC batched emails fan out via inngest.send (kind='underperforming_poc') riding the existing sendEmailFn (Phase 8) — kind + template literals are owned by plan 09-04 (BLOCKER-3) and consumed here"
    - "Per-POC subject is composed as `Performance update — N kiosk${N === 1 ? '' : 's'} need attention` where N is the per-POC batched-kiosk count (canonical wording locked in plan 09-04 must_haves)"
    - "NULL-POC kiosks produce a single email_log skip row each — no email"
    - "Re-run within same ISO week produces 0 new email_log sent rows (idempotency rides email_log partial unique idx)"
    - "kiosk_performance_alert_state is UPSERTed for every classified kiosk on every run"
    - "audit_logs gains one entity_type='performance_alert_run' row per run with actor info"
    - "Function has concurrency: { limit: 1 } and retries: 3"
    - "email_log status CHECK constraint extended to include 'skipped' AND 'queued' (the operator types: 'queued','sent','failed','skipped') BEFORE any test or runtime path writes a 'skipped' row — enforced by the BLOCKING migration task 2"
  artifacts:
    - path: "src/inngest/functions/weekly-poc-alerts.ts"
      provides: "weeklyPocAlertsFn — Inngest function with cron + event triggers, 7 step boundaries"
      exports: ["weeklyPocAlertsFn", "_handleWeeklyPocAlerts"]
    - path: "src/lib/performance-alerts/classify-kiosks.ts"
      provides: "classifyEligibleKiosks() — per-kiosk SQL + percentile rank + classifyOutletTier wrapper"
      exports: ["classifyEligibleKiosks", "ClassifiedKioskRow"]
    - path: "migrations/0044_phase_09_email_log_skipped_status.sql"
      provides: "DB-level CHECK constraint extension on email_log.status to include 'queued' and 'skipped'; idempotent DROP+ADD pattern guarded by pg_constraint lookup"
      contains: "CHECK (status IN ('queued','sent','failed','skipped'))"
    - path: "src/db/schema.ts"
      provides: "Drizzle emailLog.status enum extended to ['queued','sent','failed','skipped'] to match the new DB-level CHECK"
      contains: "queued"
    - path: "src/app/api/inngest/route.ts"
      provides: "weeklyPocAlertsFn registered in serve({ functions: [...] })"
      contains: "weeklyPocAlertsFn"
  key_links:
    - from: "weeklyPocAlertsFn step.sendEvent"
      to: "sendEmailFn (existing Phase 8 function)"
      via: "inngest event 'email/send.requested' with template:'poc-underperformance' (template registered in plan 09-04; the EmailKind/EmailTemplate unions consumed here are also extended in 09-04 per BLOCKER-3)"
    - from: "classifyEligibleKiosks"
      to: "src/lib/analytics/{thresholds-server.ts, metrics.ts}"
      via: "imports getOutletTierThresholds + classifyOutletTier (do NOT reimplement tier math — D-03)"
    - from: "weeklyPocAlertsFn step.run('emit-skip-rows', ...)"
      to: "email_log table (kind='underperforming_poc', recipient='[skip:no-poc]', status='skipped')"
      via: "Drizzle insert (depends on the BLOCKING migration 0044 having already extended email_log_status_check to include 'skipped')"
    - from: "migrations/0044 + schema.ts emailLog.status enum"
      to: "tests/performance-alerts/idempotency.integration.test.ts + null-poc-skip.integration.test.ts"
      via: "the integration tests in this plan write status='skipped' rows; they fail at runtime if the CHECK constraint is not extended first — hence the BLOCKING gate on task 2"
---

<objective>
Land the cron — the heart of POC-ALERT-01. A single Inngest function
with two triggers (TZ-aware Mondays-09:00-London cron + admin "Run now"
event) that classifies eligible `Live` kiosks per-kiosk against the
existing percentile cutoffs, persists state, batches per-POC, and
emits one `email/send.requested` event per POC. Reuses the Phase 8
`sendEmailFn` for the actual render+send (the cron does not call
Resend directly). The new template (`"poc-underperformance"`) AND the
EmailKind/EmailTemplate union extensions are registered by plan 09-04
in Wave 2 — this plan (Wave 3) consumes them. Per BLOCKER-3 from
plan-checker iteration 1, this plan now `depends_on: [01, 02, 04]`
explicitly so the type-checker has the union literals available
before the cron's `inngest.send({ data: { kind, template, ... } })`
is evaluated.

This plan also supersedes the Phase 8 placeholder integration test
at `tests/email/send-email-fn.integration.test.ts:119-158` (per the
explicit hand-off comment there) by writing the three Wave 0
integration tests against a synthetic K1-K10 kiosk fleet, AND by
adding an end-to-end test case in `idempotency.integration.test.ts`
that drives `_handleSendEmail` against the real Phase 9
`poc-underperformance` template (per W10 fix). The Phase 8 placeholder
may be removed in this same task OR left in place with an updated
comment pointing to the new test.

The classification SQL is **flagged NOVEL** by PATTERNS.md — it
cannot be cloned from `getOutletTiers` (per-LOCATION + 4-tier wrong
shape). Build a sibling per-kiosk reader.

Per W5 fix from plan-checker iteration 1: the SQL example below
references `r.name AS region` joined from the `regions` table via
`locations.primary_region_id`, NOT the dropped `locations.region`
column (free-text region was dropped in migration 0022; locations
now carries `primary_region_id uuid FK -> regions.id` plus
`region_group text`). The kiosks ↔ locations link goes via
`kiosk_assignments` (not a direct `kiosks.location_id` FK — verified
against schema.ts § kioskAssignments lines 274-295).

Purpose: Without this plan, no email is ever produced; the schema in
09-01 is unused; the pure utilities in 09-02 are unused; the admin
"Run now" button in 09-05 has no event consumer.

Output:
- `src/lib/performance-alerts/classify-kiosks.ts` (NOVEL — per-kiosk SQL)
- `migrations/0044_phase_09_email_log_skipped_status.sql` (BLOCKING — extends the existing 0042 CHECK constraint)
- `src/db/schema.ts` extended (emailLog.status enum tuple grows to include 'queued' + 'skipped')
- `src/inngest/functions/weekly-poc-alerts.ts` (multi-trigger cron with 7 steps)
- `src/app/api/inngest/route.ts` extended (one-line `functions: [...]` update)
- `src/lib/audit.ts` extended (entityType + action union add — only `performance_alert_run` + `trigger`; the `silence_alerts`/`unsilence_alerts` actions land in 09-06)
- 3 integration tests in `tests/performance-alerts/`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md
@.planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md
@.planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md
@.planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md
@.planning/phases/09-poc-underperformance-alerts/09-01-SUMMARY.md
@.planning/phases/09-poc-underperformance-alerts/09-02-SUMMARY.md
@.planning/phases/09-poc-underperformance-alerts/09-04-SUMMARY.md

@src/inngest/client.ts
@src/inngest/events.ts
@src/inngest/functions/send-email.ts
@src/app/api/inngest/route.ts
@src/lib/audit.ts
@src/lib/analytics/thresholds-server.ts
@src/lib/analytics/metrics.ts
@src/lib/analytics/queries/portfolio.ts
@src/db/schema.ts
@migrations/0042_phase_08_email_log_status_check.sql
@tests/email/send-email-fn.integration.test.ts
@tests/helpers/test-db.ts

<interfaces>
Pure utilities from plan 09-02 (already on disk + tested):
- `import { decideAlert, type Tier, type Decision } from "@/lib/performance-alerts/classify-dispatch";`
- `import { isoWeekKey } from "@/lib/performance-alerts/iso-week";`
- `import { groupByPoc, type PocGroup } from "@/lib/performance-alerts/poc-batching";`
- `import { sha256 } from "@/lib/performance-alerts/hash";`

Tier classification (existing — DO NOT REIMPLEMENT — D-03):
- `import { getOutletTierThresholdsCached } from "@/lib/analytics/thresholds-server";`
- `import { classifyOutletTier } from "@/lib/analytics/metrics";`
- `classifyOutletTier(percentile, config)` returns `"Premium"|"Standard"|"Developing"|"Emerging"`. Bottom-tier sentinel = `"Emerging"` (RESEARCH § Open Q1 lock).

EmailKind / EmailTemplate union extensions (owned by plan 09-04 per BLOCKER-3):
- `EmailKind` includes `"underperforming_poc"` (added in 09-04 task 3 step 1)
- `EmailTemplate` includes `"poc-underperformance"` (added in 09-04 task 3 step 1)
- This plan CONSUMES these literals when the cron emits `inngest.send({ data: { kind: "underperforming_poc", template: "poc-underperformance", ... } })`. The TypeScript compile-time check rides on 09-04 being merged first (Wave 2 → Wave 3 ordering).

Existing Phase 8 send-email contract (we emit events, sendEmailFn consumes):
```typescript
inngest.send({ name: "email/send.requested", data: {
  kind: EmailKind, to: string, subject: string,
  template: EmailTemplate, templateProps: Record<string, unknown>,
  payloadHash?: string,
}})
```

audit.ts unions (currently closed; we extend ONLY for performance_alert_run + trigger here):
- entityType: `"kiosk" | "location" | ... | "cache" | "system"`
- action: `"create" | "update" | ... | "monday_import_triggered"`
- We add entityType: `"performance_alert_run"`, action: `"trigger"`. (`silence_alerts`/`unsilence_alerts` are added in plan 09-06.)

email_log status CHECK constraint (existing — this plan extends it):
- Currently: `CHECK (status IN ('sent', 'failed'))` per migration 0042.
- After this plan's task 2 (BLOCKING): `CHECK (status IN ('queued','sent','failed','skipped'))`.
- The `'queued'` value is added preemptively to keep the constraint forward-compatible with any future Phase 8 retry/queue UX; 'skipped' is what THIS plan actually writes.

email_log idempotency target:
```typescript
.onConflictDoNothing({
  target: [emailLog.kind, emailLog.payloadHash],
  where: sql`payload_hash IS NOT NULL`,
});
```
The `where` clause MUST be re-stated to match the partial unique idx (PATTERNS § Drizzle onConflictDoNothing).

regions / locations / kiosks join shape (verified against schema.ts; per W5 fix):
- `locations.region` (free-text) was DROPPED in migration 0022. Use `locations.primary_region_id uuid` (FK to `regions.id`) and project `regions.name AS region` in the cron's SQL.
- `kiosks` connect to `locations` via the `kiosk_assignments` temporal join table (lines 274-295). One active assignment per kiosk: `WHERE ka.unassigned_at IS NULL`. A kiosk MAY have no active assignment (orphan); the LEFT JOIN preserves the row and `region` falls back to NULL → COALESCE to `'(no region)'`.
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Inngest event source -> cron handler | Manual "Run now" event from admin UI (server-action signed via session); cron event from Inngest scheduler. Both arrive via Inngest's signed webhook to /api/inngest. |
| cron handler -> DB | Drizzle parameterised queries; no string concatenation of user input. |
| cron handler -> fan-out events -> sendEmailFn | Internal Inngest event bus; payload is structured + typed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-03-01 | Tampering | inbound performance-alerts/run.requested event | mitigate | Inngest validates the event signature against INNGEST_SIGNING_KEY. The cron handler does NOT trust data.actorId for any privileged action — it only logs the actor in audit_logs for forensics. |
| T-09-03-02 | DoS | repeated event sends ("Run now" spam) | mitigate | concurrency: { limit: 1 } on the function (RESEARCH § Pattern 1). Idempotency key in the server-action (plan 09-05) prevents 24h-window dupes. |
| T-09-03-03 | Repudiation | who triggered a run | mitigate | step.run("write-run-audit", ...) writes audit_logs with actor_id from the event data (or "system" for cron). Inngest dashboard also retains runId and event payload. |
| T-09-03-04 | Information Disclosure | email body contains kiosk-level performance data | accept | Recipients are exclusively kiosks.internal_poc_id-resolved users (D-07); each POC sees only their own kiosks (the SQL filter is WHERE internal_poc_id = $pocId per group). No PII beyond user.name + user.email. |
| T-09-03-05 | Tampering | string-match pipeline stage by name | mitigate | FORBIDDEN by D-09. Eligibility filter uses kiosks.pipeline_stage_id = $appSettings.pipeline_stage_id_live (UUID-pin). The literal string "Live" appears nowhere in the cron body. |
| T-09-03-06 | DoS | classification query timeout on large fleets | mitigate | Single SELECT against kiosks (~1000 rows) + JOIN sales_records over the trailing window. kiosk_performance_alert_state.tier index from plan 09-01 supports the per-tier admin metadata query. Step boundary timeout is Inngest default (60s); if a step takes longer it retries. |
| T-09-03-07 | Tampering | first-ever run with no prior state | mitigate | RESEARCH § Pitfall 8 + Assumption A2: pick option (a) quiet first run — when zero prior-state rows exist, the function writes state but skips the dispatch step entirely (no flip-in alerts on day 1). Documented in PLAN.md + integration test. |
| T-09-03-08 | Information Disclosure | error details leak in email | mitigate | sendEmailFn (Phase 8) writes errors to email_log.last_error and the Inngest dashboard. The cron never includes error strings in templateProps. |
| T-09-03-09 | Tampering | open redirect in email kiosk-detail link | mitigate | Deep-link URLs constructed as ${BRAND.prodUrl}/kiosks/${kiosk.id} — BRAND.prodUrl is a build-time constant in src/emails/brand.ts. The cron never accepts user-supplied URL fragments. |
| T-09-03-10 | Tampering | bypassing email_log status CHECK constraint via raw psql | mitigate | The 'skipped' status is added at the DB layer (CHECK constraint in migration 0044) and at the TS layer (Drizzle enum in schema.ts). Both must agree; out-of-band status writes via raw psql are blocked at the constraint level. |

ASVS controls applied:
- V2.1.1 (Auth): manual trigger requires admin RBAC at the server-action layer (plan 09-05).
- V4.1.1 (Access Control): cron is server-side only; email recipients pinned to internal_poc_id (no fan-out to admins).
- V5.1.1 (Input Validation): event data is type-checked at the Inngest event boundary; SQL uses parameterised queries.
- V6.2.1 (Cryptography): sha256(poc_user_id + ':' + run_iso_week) for idempotency keying via Node crypto (not hand-rolled).
- V7.4.1 (Error Handling): function-level retries (3); errors written to Inngest dashboard, not echoed to recipients.
- V8.1 (Data Protection): performance metrics data; no PII beyond name+email of the POC.
- V14.2.5 (Configuration): INNGEST_SIGNING_KEY set on Vercel preview branch alias per CLAUDE.md operational rule.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Author src/lib/performance-alerts/classify-kiosks.ts (NOVEL — per-kiosk SQL)</name>
  <files>src/lib/performance-alerts/classify-kiosks.ts</files>
  <read_first>
    - src/lib/analytics/queries/portfolio.ts § getOutletTiers (lines 408-520) — the structural twin you cannot clone wholesale (per-LOCATION + 4-tier). Read end-to-end so you understand WHY the per-kiosk version needs different SQL.
    - src/lib/analytics/thresholds-server.ts § getOutletTierThresholdsCached (lines 41-80) — call this AS-IS for tier config (RESEARCH "Don't Hand-Roll" rule).
    - src/lib/analytics/metrics.ts § classifyOutletTier — pure tier classifier; bottom = "Emerging".
    - src/db/schema.ts (full file is large; specifically read these blocks):
      - `kiosks` table (lines 117-201, plus the `alertSilencedAt` + `alertSilencedReason` columns added by 09-01) — confirm `pipelineStageId`, `internalPocId`, `outletCode`, `archivedAt`, `alertSilencedAt`.
      - `kioskAssignments` table (lines 274-295) — the temporal join table linking kiosks ↔ locations. Use `WHERE ka.unassigned_at IS NULL` for the active assignment.
      - `locations` table — confirm `primaryRegionId uuid` (FK to `regions.id`); the free-text `region` column was DROPPED in migration 0022 and is gone.
      - `regions` table (line ~575) — confirm `regions.name` and `regions.id`.
      - `salesRecords` table — confirm exact column names (likely `outletCode`, `transactionDate`, `totalAmount`).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/lib/performance-alerts/classify-kiosks.ts" (NOVEL flag + cloneable shape from portfolio.ts lines 415-419, 491-495, 510-517).
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Anti-Patterns (forbids cloning getOutletTiers) + § Pitfall 7 (NULL outlet_code filter).
  </read_first>
  <behavior>
    - When called with no args, returns `Promise<{ rows: ClassifiedKioskRow[]; tierConfig: OutletTierConfig; windowDays: number; liveStageId: string }>`.
    - Each ClassifiedKioskRow carries: kioskId, internalPocId, outletCode, locationName, region, revenue, percentile, tier.
    - The eligibility WHERE clause filters: archivedAt IS NULL AND outletCode IS NOT NULL AND alertSilencedAt IS NULL AND pipelineStageId = $liveStageId.
    - The trailing window comes from app_settings.underperformance_window_days (default 30 if missing).
    - The Live stage UUID comes from app_settings.pipeline_stage_id_live (REQUIRED; throw a descriptive error if missing — the migration in 09-01 seeds this).
    - Sales over window are summed per kiosk via JOIN sales_records ON sales_records.outlet_code = kiosks.outlet_code AND transaction_date >= NOW() - INTERVAL ...
    - Percentile rank is computed via the binary-search-rank pattern from getOutletTiers (RESEARCH/PATTERNS), then classifyOutletTier(percentile, tierConfig) produces the verbatim "Premium"|"Standard"|"Developing"|"Emerging" tier.
    - Kiosks with zero sales in the window get revenue=0 and rank at the bottom of the sorted array (which lands them in "Emerging").
    - Region projection comes from JOIN regions ON regions.id = locations.primary_region_id, projected as `regions.name AS region` (the dropped `locations.region` column is NOT used — per W5 fix). NULL falls back to `'(no region)'`.
  </behavior>
  <action>
    Write the file as a pure async function that the cron orchestrates. Do not embed Inngest concerns; do not embed any step.run calls — those wrap the call site, not the body. Reference shape:

    ```typescript
    import { sql, eq } from "drizzle-orm";
    import { db } from "@/db";
    import { appSettings } from "@/db/schema";
    import {
      getOutletTierThresholdsCached,
      type OutletTierConfig,
    } from "@/lib/analytics/thresholds-server";
    import { classifyOutletTier } from "@/lib/analytics/metrics";
    import type { Tier } from "@/lib/performance-alerts/classify-dispatch";

    export type ClassifiedKioskRow = {
      kioskId: string;
      internalPocId: string | null;
      outletCode: string;
      locationName: string;
      region: string;
      revenue: number;       // total over trailing window
      percentile: number;    // 0-100
      tier: Tier;            // "Emerging" = bottom
    };

    export async function classifyEligibleKiosks(): Promise<{
      rows: ClassifiedKioskRow[];
      tierConfig: OutletTierConfig;
      windowDays: number;
      liveStageId: string;
    }> {
      // 1. Read app_settings + tierConfig in parallel.
      const [windowDaysRow, liveStageRow, tierConfig] = await Promise.all([
        db.select().from(appSettings).where(eq(appSettings.key, "underperformance_window_days")),
        db.select().from(appSettings).where(eq(appSettings.key, "pipeline_stage_id_live")),
        getOutletTierThresholdsCached(),
      ]);

      const windowDays = Number(windowDaysRow[0]?.value ?? 30);
      const liveStageId = liveStageRow[0]?.value;
      if (!liveStageId) {
        throw new Error(
          "app_settings.pipeline_stage_id_live is missing — run migration 0043 first.",
        );
      }

      // 2. Per-kiosk SQL (W5 fix — region comes from regions.name via primary_region_id;
      //    the dropped locations.region free-text column is NOT used).
      // Reference shape (executor MUST verify exact column names against schema.ts):
      //
      // SELECT
      //   k.id           AS kiosk_id,
      //   k.outlet_code,
      //   l.id           AS location_id,
      //   l.name         AS location_name,
      //   r.name         AS region,                   -- FROM regions table, not locations.region
      //   k.internal_poc_id,
      //   COALESCE(SUM(s.total_amount), 0)::numeric AS total_sales
      // FROM kiosks k
      // LEFT JOIN kiosk_assignments ka
      //   ON ka.kiosk_id = k.id AND ka.unassigned_at IS NULL  -- active assignment only
      // LEFT JOIN locations l ON l.id = ka.location_id
      // LEFT JOIN regions r ON r.id = l.primary_region_id
      // LEFT JOIN sales_records s
      //   ON s.outlet_code = k.outlet_code
      //  AND s.transaction_date >= NOW() - ($windowDays || ' days')::interval
      // WHERE k.archived_at IS NULL
      //   AND k.outlet_code IS NOT NULL
      //   AND k.alert_silenced_at IS NULL
      //   AND k.pipeline_stage_id = $liveStageId::uuid
      // GROUP BY k.id, k.outlet_code, l.id, l.name, r.name, k.internal_poc_id;
      //
      // Notes:
      // - kiosks attach to locations via kiosk_assignments (NOT a direct kiosks.location_id FK).
      //   Verified: schema.ts § kioskAssignments lines 274-295.
      // - The active-assignment filter is `ka.unassigned_at IS NULL`. Verify this exact column
      //   name when reading schema.ts; the table uses `unassignedAt` in Drizzle and
      //   `unassigned_at` in SQL.
      // - regions.name is the human-friendly region label (UK / IE / DE / ES / CZ etc per
      //   schema.ts § regions). The dropped locations.region was free-text; do not reintroduce.
      // - Use a parameterised drizzle sql template literal — never string-concat windowDays
      //   or liveStageId.
      // - If a kiosk has multiple historical assignments (kiosks may move between locations),
      //   the `WHERE ka.unassigned_at IS NULL` constraint scopes to the CURRENT one.
      //   Document the chosen join in the function's docstring.

      const raw = await db.execute(sql`
        SELECT
          k.id::text AS kiosk_id,
          k.internal_poc_id AS internal_poc_id,
          k.outlet_code AS outlet_code,
          l.name AS location_name,
          r.name AS region,
          COALESCE(SUM(s.total_amount::numeric), 0)::float AS revenue
        FROM kiosks k
        LEFT JOIN kiosk_assignments ka
          ON ka.kiosk_id = k.id AND ka.unassigned_at IS NULL
        LEFT JOIN locations l ON l.id = ka.location_id
        LEFT JOIN regions r ON r.id = l.primary_region_id
        LEFT JOIN sales_records s
          ON s.outlet_code = k.outlet_code
         AND s.transaction_date >= NOW() - (${windowDays} || ' days')::interval
        WHERE k.archived_at IS NULL
          AND k.outlet_code IS NOT NULL
          AND k.alert_silenced_at IS NULL
          AND k.pipeline_stage_id = ${liveStageId}::uuid
        GROUP BY k.id, k.internal_poc_id, k.outlet_code, l.name, r.name
      `);

      // 3. Compute percentile rank against sorted revenues + classify tier
      // (same pattern as portfolio.ts lines 491-517).
      const parsed = raw.rows as Array<{
        kiosk_id: string;
        internal_poc_id: string | null;
        outlet_code: string;
        location_name: string | null;
        region: string | null;
        revenue: number;
      }>;
      const sortedRevenues = parsed.map((r) => r.revenue).sort((a, b) => a - b);
      const total = sortedRevenues.length;

      const rows: ClassifiedKioskRow[] = parsed.map((r) => {
        // rank = number of revenues strictly less than this one (binary search lower bound)
        let lo = 0, hi = total;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sortedRevenues[mid] < r.revenue) lo = mid + 1;
          else hi = mid;
        }
        const percentile = total > 0 ? (lo / total) * 100 : 0;
        const tier = classifyOutletTier(percentile, tierConfig) as Tier;
        return {
          kioskId: r.kiosk_id,
          internalPocId: r.internal_poc_id,
          outletCode: r.outlet_code,
          locationName: r.location_name ?? "(no location)",
          region: r.region ?? "(no region)",
          revenue: r.revenue,
          percentile,
          tier,
        };
      });

      return { rows, tierConfig, windowDays, liveStageId };
    }
    ```

    Verify exact column names (`primary_region_id`, `unassigned_at`, `total_amount`) against the live schema before finalising. The function returns a typed object; the cron destructures it. No step.run wrapper.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "classify-kiosks|performance-alerts" || echo OK</automated>
  </verify>
  <done>
    - File exists, exports classifyEligibleKiosks and ClassifiedKioskRow.
    - TypeScript compiles clean (no new errors from this file).
    - Eligibility WHERE clause includes all 4 filters from D-08 + D-19.
    - Calls classifyOutletTier (does NOT reimplement tier math — D-03).
    - Pipeline stage is resolved by UUID (liveStageId), not by string match (D-09).
    - `grep -c "l.region" src/lib/performance-alerts/classify-kiosks.ts` returns 0 (W5 fix — the dropped column is not referenced).
    - `grep -c "r.name" src/lib/performance-alerts/classify-kiosks.ts` returns at least 1 (region projected from regions.name via the JOIN).
    - `grep -c "kiosk_assignments\|kioskAssignments" src/lib/performance-alerts/classify-kiosks.ts` returns at least 1 (the link table is the join path, NOT a direct kiosks.location_id FK).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2 [BLOCKING]: Extend email_log status CHECK + Drizzle enum to include 'queued' and 'skipped' (migration 0044 + schema.ts)</name>
  <files>src/db/schema.ts, migrations/0044_phase_09_email_log_skipped_status.sql</files>
  <read_first>
    - src/db/schema.ts lines 1107-1134 — the `emailLog` table definition. Specifically the line `text("status", { enum: ["sent", "failed"] }).notNull()` (verified at line 1120). You will extend the enum tuple to `["queued", "sent", "failed", "skipped"]`.
    - migrations/0042_phase_08_email_log_status_check.sql (full file — 23 lines) — the existing `email_log_status_check` constraint with `CHECK (status IN ('sent', 'failed'))`. Your migration mirrors its idempotent-DROP-then-ADD shape. Read the full pg_constraint guard pattern (lines 13-23).
    - .planning/phases/09-poc-underperformance-alerts/09-01-SUMMARY.md — confirms the `drizzle-kit push` pattern used in plan 09-01 task 3 (mirror that BLOCKING gate structure here).
  </read_first>
  <behavior>
    - After this task: `psql $DATABASE_URL -c "SELECT 1 FROM information_schema.check_constraints WHERE constraint_name='email_log_status_check' AND check_clause LIKE '%skipped%'"` returns exactly 1 row (proves the new constraint is live, not just authored).
    - After this task: `psql $DATABASE_URL -c "INSERT INTO email_log (id, kind, recipient, status, payload_hash) VALUES (gen_random_uuid(), 'underperforming_poc', '[skip:no-poc]', 'skipped', NULL); ROLLBACK;"` succeeds (the status='skipped' write is accepted by the constraint).
    - The Drizzle `emailLog.status` enum tuple matches the DB-level CHECK exactly: `['queued','sent','failed','skipped']`.
    - Re-running migration 0044 is a no-op (idempotent — the pg_constraint guard skips re-application).
    - Why 'queued' is included alongside 'skipped': forward-compat with any future Phase 8 retry/queue UX; the operator types fixed to `'queued','sent','failed','skipped'` per the BLOCKER 1+2 fix from plan-checker iteration 1.
  </behavior>
  <action>
    1. **Edit src/db/schema.ts** (line 1120 in the existing emailLog definition):
       - Change `status: text("status", { enum: ["sent", "failed"] }).notNull(),`
       - To: `status: text("status", { enum: ["queued", "sent", "failed", "skipped"] }).notNull(),`
       - Order the tuple as `['queued','sent','failed','skipped']` to match the migration file's CHECK clause for visual consistency.

    2. **Author migrations/0044_phase_09_email_log_skipped_status.sql** — clone the exact idempotent-DROP-then-ADD shape from migration 0042 lines 13-23:

       ```sql
       -- Phase 9 Plan 09-03 — extend email_log.status CHECK constraint to include
       -- 'queued' and 'skipped' (POC-ALERT-01).
       --
       -- Phase 8 (migration 0042) shipped with CHECK (status IN ('sent', 'failed')).
       -- Phase 9 introduces the 'skipped' status for NULL-POC kiosks (one row per
       -- skipped kiosk; the cron at src/inngest/functions/weekly-poc-alerts.ts
       -- step 6 writes these). 'queued' is added preemptively for forward-compat
       -- with any future Phase 8+ retry/queue UX — the operator types are fixed
       -- to 'queued','sent','failed','skipped' (per plan-checker iteration 1
       -- BLOCKER 1+2 resolution).
       --
       -- Idempotent — drops the existing constraint by name, then re-adds with
       -- the extended enum. Re-running on UAT / preview branches that already
       -- have the extended constraint is a no-op (the DROP is guarded by
       -- pg_constraint lookup; the ADD is guarded by the same).
       --
       -- Order of operations:
       --   1. DROP existing email_log_status_check (added by 0042) IF it exists.
       --   2. ADD email_log_status_check with the extended IN list IF the
       --      replacement constraint is not already present.
       --
       -- Both steps are guarded so re-application is safe.

       DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'email_log_status_check'
         ) THEN
           ALTER TABLE "email_log" DROP CONSTRAINT "email_log_status_check";
         END IF;
       END $$;
       --> statement-breakpoint

       DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'email_log_status_check'
         ) THEN
           ALTER TABLE "email_log"
             ADD CONSTRAINT "email_log_status_check"
             CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
         END IF;
       END $$;
       --> statement-breakpoint
       ```

    3. **Run drizzle-kit to generate + apply** (mirror 09-01 task 3 BLOCKING gate):
       - `npx drizzle-kit generate` — verify the generated SQL matches the hand-authored 0044 shape. If drizzle-kit produces an extra/duplicate file, prefer the hand-authored 0044 (delete the auto-generated duplicate to keep migration order linear).
       - `npx drizzle-kit push` (or `migrate`, depending on the codebase's existing convention — verify via `drizzle.config.ts` and `package.json` scripts).
       - Verify the constraint is live in the dev DB with the runtime SELECT in the `<done>` block below. If the constraint is not live, the integration tests in tasks 5/6 WILL fail at runtime with `new row for relation "email_log" violates check constraint "email_log_status_check"`.

    4. **CRITICAL — this task MUST complete before tasks 4-6** (the cron + integration tests write `status='skipped'` rows). This is the BLOCKING gate equivalent to 09-01 task 3.
  </action>
  <verify>
    <automated>test -f migrations/0044_phase_09_email_log_skipped_status.sql &amp;&amp; grep -c "CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))" migrations/0044_phase_09_email_log_skipped_status.sql &amp;&amp; grep -c '"queued"' src/db/schema.ts &amp;&amp; npx tsx -e "(await import('./src/db')).db.execute(/* sql */ \"SELECT 1 FROM information_schema.check_constraints WHERE constraint_name='email_log_status_check' AND check_clause LIKE '%skipped%'\").then(r => process.exit(r.rows.length === 1 ? 0 : 1))"</automated>
  </verify>
  <done>
    - `migrations/0044_phase_09_email_log_skipped_status.sql` exists.
    - `grep -c "CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))" migrations/0044_phase_09_email_log_skipped_status.sql` returns 1 (per BLOCKER 1+2 expected_output line).
    - `grep -c '"queued"' src/db/schema.ts` returns at least 1 (the Drizzle enum tuple was extended).
    - `grep -c '"skipped"' src/db/schema.ts` returns at least 1 in the emailLog table region.
    - Runtime SELECT (the verify command above) exits 0 — `email_log_status_check` is live in the dev DB and contains 'skipped' in its check_clause.
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
    - `npx drizzle-kit push` (or `migrate`) exited 0.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Extend src/lib/audit.ts (entityType + action union add)</name>
  <files>src/lib/audit.ts</files>
  <read_first>
    - src/lib/audit.ts (full file) — read the current entityType + action unions (PATTERNS notes lines 13 + 17-35; verified: writeAuditLog signature already accepts `metadata?: Record<string, unknown>` at line 39).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/lib/audit.ts (modify)".
  </read_first>
  <behavior>
    - entityType (in audit.ts) accepts "performance_alert_run" as a valid value.
    - action (in audit.ts) accepts "trigger" as a valid value.
    - Existing imports of these unions still compile clean.
    - No DB migration — the underlying `audit_logs.entity_type` + `action` columns are plain `text` (verified at PATTERNS).
    - Per BLOCKER-3: this plan does NOT extend src/inngest/events.ts (the EmailKind/EmailTemplate union extensions are owned by plan 09-04).
  </behavior>
  <action>
    1. Edit src/lib/audit.ts:
       - Add "performance_alert_run" to the entityType union (per RESEARCH Assumption A6 — verified, no migration needed; the underlying DB column is free-form text).
       - Add "trigger" to the action union.
       - Do NOT add "silence_alerts"/"unsilence_alerts" here — those land in plan 09-06.

    2. Run `npx tsc --noEmit` to verify no callers broke.

    3. **NOTE (BLOCKER-3 fix):** the `EmailKind` / `EmailTemplate` union extensions originally specified for this task have been MOVED to plan 09-04 task 3 to resolve a Wave-2 type-narrowing race. This plan now `depends_on: [01, 02, 04]` so 09-04's union extensions are merged before this plan's cron file (which consumes them) is type-checked.
  </action>
  <verify>
    <automated>grep -q performance_alert_run src/lib/audit.ts &amp;&amp; grep -q '"trigger"' src/lib/audit.ts &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep audit || echo OK</automated>
  </verify>
  <done>
    - `grep -c "performance_alert_run" src/lib/audit.ts` returns at least 1.
    - `grep -c '"trigger"' src/lib/audit.ts` returns at least 1 (the action union now includes 'trigger').
    - `npx tsc --noEmit -p tsconfig.json` exits 0 (no callers broke).
    - `grep -c "underperforming_poc\|poc-underperformance" src/lib/audit.ts` returns 0 (BLOCKER-3 — those literals belong in src/inngest/events.ts, owned by plan 09-04).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Author src/inngest/functions/weekly-poc-alerts.ts (the cron)</name>
  <files>src/inngest/functions/weekly-poc-alerts.ts</files>
  <read_first>
    - src/inngest/functions/send-email.ts (full file) — exact analog for: imports + lazy-init pattern, createFunction shape, step boundaries, test-shim split (`_handleSendEmail`), email_log onConflictDoNothing with the partial-idx where clause.
    - src/inngest/events.ts AT POST-09-04 STATE — the EmailKind union now includes "underperforming_poc" and the EmailTemplate union includes "poc-underperformance" (added by plan 09-04 task 3 step 1, per BLOCKER-3). The cron CONSUMES these literals; do NOT modify events.ts here.
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Code Examples lines 419-525 (full reference function body) + § Patterns 1-5 + § Pitfalls 1, 4, 5, 8, 9.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/inngest/functions/weekly-poc-alerts.ts" (full pattern map for function shape).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-10 + D-12 + D-13 + D-17 + D-19.
    - src/db/schema.ts § kioskPerformanceAlertState (added in plan 09-01) + emailLog (status enum extended in task 2 of THIS plan to include 'queued' + 'skipped') + auditLogs.
    - src/lib/audit.ts § writeAuditLog signature — verified: accepts `metadata?: Record<string, unknown>` directly (no `as any` cast needed).
    - src/emails/brand.ts § BRAND.prodUrl (used to construct deep-link URLs in templateProps).
  </read_first>
  <behavior>
    - The function is registered with id="weekly-poc-alerts", concurrency.limit=1, retries=3, two triggers: { cron: "TZ=Europe/London 0 9 * * 1" } and { event: "performance-alerts/run.requested" }.
    - The function exports a private `_handleWeeklyPocAlerts({ step, runId, event })` handler that integration tests can drive without spinning up the Inngest dev server (mirrors `_handleSendEmail` in send-email.ts).
    - The handler executes 7 step boundaries:
      1. `step.run("load-config", ...)` -> calls classifyEligibleKiosks() (which itself reads app_settings + tierConfig and runs the per-kiosk SQL). Returns the typed result.
      2. `step.run("diff-state", ...)` -> reads prior kiosk_performance_alert_state rows for the classified kiosk_ids; for each row calls decideAlert(prior, newTier, now) and tags it. Returns Array<ClassifiedKioskRow & { decision: Decision; priorTier: Tier | null; lastAlertedAt: Date | null }>.
      3. `step.run("check-first-run", ...)` -> if zero prior-state rows existed AND every decision is "flip-in", set `firstRun = true` and override every decision to "no-alert". This implements RESEARCH § Pitfall 8 option (a) — quiet first run. Document the decision in a comment.
      4. `step.run("write-state", ...)` -> UPSERT kiosk_performance_alert_state for every classified kiosk: SET tier=newTier, classified_at=NOW(), last_run_at=NOW(), last_alerted_at = (decision IN ('flip-in','chronic') ? NOW() : prior.last_alerted_at). Use Drizzle's `.onConflictDoUpdate({ target: kioskId, set: { ... } })`.
      5. `step.run("emit-poc-emails", ...)` -> filter decisions to dispatch-able (flip-in / chronic), groupByPoc, build event payloads (one per non-null POC), then `step.sendEvent("emit-poc-emails", events)`. Each event has payloadHash = sha256(`${pocUserId}:${runIsoWeek}`). templateProps include kiosks (capped at 25 — RESEARCH § Pitfall 3), moreCount, windowDays, runIsoWeek, pocName, kiosk-detail deep links built from BRAND.prodUrl. Subject is composed as `Performance update — N kiosk${N === 1 ? '' : 's'} need attention` (canonical wording locked in plan 09-04 must_haves).
      6. `step.run("emit-skip-rows", ...)` -> for groups with pocUserId=null: insert one email_log row per kiosk: `{ kind: "underperforming_poc", recipient: "[skip:no-poc]", inngestRunId: runId, status: "skipped", payloadHash: null }`. Use `.onConflictDoNothing()` (no payloadHash so the partial idx doesn't apply; multiple skip rows for the same kiosk across runs are fine and provide audit history). REQUIRES task 2 (BLOCKING migration 0044) to have already extended the email_log_status_check constraint to include 'skipped'.
      7. `step.run("write-run-audit", ...)` -> writeAuditLog({ actorId: event?.data?.actorId ?? "system", actorName: event?.data?.actorName ?? "weekly-poc-alerts cron", entityType: "performance_alert_run", entityId: runId, entityName: `Run ${runIsoWeek}`, action: "trigger" }).
    - For NULL recipient lookup: when emitting events, the cron must JOIN against the `user` table to resolve `internal_poc_id` -> email + name. Do this once inside step 5 with a single SELECT (`WHERE id = ANY($pocIds)`).

    Notes on `event` typing: the Inngest createFunction body receives `event` typed as the union of all configured triggers' events. For cron triggers, `event.data` is `{}` (no actor). For the `performance-alerts/run.requested` trigger, `event.data` is `{ actorId, actorName }`. Use a discriminator on `event?.name` to branch.

    Note on `PerformanceAlertsRunRequested` event type: this plan ALSO appends a new exported event type to src/inngest/events.ts (separate from the BLOCKER-3 EmailKind/EmailTemplate unions which 09-04 owns). The new event type is:
    ```typescript
    export type PerformanceAlertsRunRequested = {
      name: "performance-alerts/run.requested";
      data: { actorId: string; actorName: string };
    };
    ```
    If a discriminated-union `Events` type exists, append PerformanceAlertsRunRequested to it. This addition is a co-edit to events.ts that does NOT collide with 09-04's union extensions (different lines / different exports). Add `src/inngest/events.ts` BACK to this plan's files_modified ONLY if you do this co-edit; otherwise the cron must accept a less-typed event shape.

    Wait — re-reading BLOCKER-3 carefully: "Remove from 09-03 task 2 action: any edits to src/inngest/events.ts adding 'underperforming_poc' to EmailKind and 'poc-underperformance' to EmailTemplate. Remove src/inngest/events.ts from 09-03's files_modified frontmatter." The blocker is specifically about the EmailKind/EmailTemplate unions. The `PerformanceAlertsRunRequested` event type addition is a different concern — but the frontmatter change in BLOCKER-3 removes events.ts entirely from this plan. To preserve the BLOCKER-3 fix exactly: do NOT modify src/inngest/events.ts in this plan. Instead, define `PerformanceAlertsRunRequested` as an inline type in src/inngest/functions/weekly-poc-alerts.ts (it is consumed only by that file's createFunction call). The Inngest client will accept the trigger config without a registered event type (Inngest's typegen handles this lazily). If the typegen complains, plan 09-04 (or a follow-up) can promote the type to events.ts.
  </behavior>
  <action>
    1. **Author the cron file** at src/inngest/functions/weekly-poc-alerts.ts. Mirror the structure of src/inngest/functions/send-email.ts:

       ```typescript
       import { sql, eq, inArray } from "drizzle-orm";
       import { db } from "@/db";
       import {
         kiosks,
         kioskPerformanceAlertState,
         emailLog,
         user,
       } from "@/db/schema";
       import { inngest } from "../client";
       import { classifyEligibleKiosks, type ClassifiedKioskRow } from "@/lib/performance-alerts/classify-kiosks";
       import { decideAlert, type Decision, type Tier } from "@/lib/performance-alerts/classify-dispatch";
       import { groupByPoc } from "@/lib/performance-alerts/poc-batching";
       import { isoWeekKey } from "@/lib/performance-alerts/iso-week";
       import { sha256 } from "@/lib/performance-alerts/hash";
       import { writeAuditLog } from "@/lib/audit";
       import { BRAND } from "@/emails/brand";

       const KIOSK_TRUNCATION_CAP = 25;  // RESEARCH § Pitfall 3

       type StepShim = {
         run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
         sendEvent: (id: string, events: unknown[]) => Promise<unknown>;
       };

       type EventShim = {
         name?: string;
         data?: { actorId?: string; actorName?: string };
       };

       export async function _handleWeeklyPocAlerts({
         step,
         runId,
         event,
       }: {
         step: StepShim;
         runId: string;
         event?: EventShim;
       }): Promise<{ alerted: number; skipped: number; classified: number; firstRun: boolean }> {
         // step 1: classify
         const classification = await step.run("load-config", async () => {
           return await classifyEligibleKiosks();
         });

         const kioskIds = classification.rows.map((r) => r.kioskId);

         // step 2: diff-state
         const decisions = await step.run("diff-state", async () => {
           const now = new Date();
           const priorRows = kioskIds.length === 0
             ? []
             : await db
                 .select()
                 .from(kioskPerformanceAlertState)
                 .where(inArray(kioskPerformanceAlertState.kioskId, kioskIds));
           const priorByKiosk = new Map(priorRows.map((r) => [r.kioskId, r]));
           return classification.rows.map((row) => {
             const prior = priorByKiosk.get(row.kioskId);
             const decision = decideAlert(
               prior ? { tier: prior.tier as Tier, lastAlertedAt: prior.lastAlertedAt } : null,
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

         // step 3: check first-run (RESEARCH § Pitfall 8 option a — quiet first run)
         const firstRun = decisions.length > 0 && decisions.every((d) => !d.hadPriorRow);
         const effectiveDecisions = firstRun
           ? decisions.map((d) => ({ ...d, decision: "no-alert" as Decision }))
           : decisions;

         // step 4: write-state (UPSERT every row, regardless of decision)
         await step.run("write-state", async () => {
           const now = new Date();
           for (const d of effectiveDecisions) {
             await db
               .insert(kioskPerformanceAlertState)
               .values({
                 kioskId: d.kioskId,
                 tier: d.tier,
                 classifiedAt: now,
                 lastRunAt: now,
                 lastAlertedAt: d.decision === "flip-in" || d.decision === "chronic" ? now : d.lastAlertedAt,
               })
               .onConflictDoUpdate({
                 target: kioskPerformanceAlertState.kioskId,
                 set: {
                   tier: d.tier,
                   classifiedAt: now,
                   lastRunAt: now,
                   lastAlertedAt: d.decision === "flip-in" || d.decision === "chronic" ? now : sql`excluded.last_alerted_at`,
                 },
               });
           }
         });

         const runIsoWeek = isoWeekKey(new Date());

         // step 5: emit-poc-emails
         const alertable = effectiveDecisions.filter((d) => d.decision !== "no-alert");
         const groups = groupByPoc(alertable);
         let alertedCount = 0;
         await step.run("emit-poc-emails", async () => {
           const realPocGroups = groups.filter((g) => g.pocUserId !== null);
           if (realPocGroups.length === 0) return;

           // resolve POC user emails + names (single SELECT)
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
               const sortedKiosks = [...g.kiosks].sort((a, b) => a.revenue - b.revenue);
               const truncated = sortedKiosks.slice(0, KIOSK_TRUNCATION_CAP);
               const moreCount = Math.max(0, sortedKiosks.length - KIOSK_TRUNCATION_CAP);
               // Subject wording is canonical and locked in plan 09-04 must_haves.
               const subject = `Performance update — ${sortedKiosks.length} kiosk${sortedKiosks.length === 1 ? "" : "s"} need attention`;
               return {
                 name: "email/send.requested" as const,
                 data: {
                   kind: "underperforming_poc" as const,        // EmailKind union extended in 09-04
                   to: u.email,
                   subject,
                   template: "poc-underperformance" as const,    // EmailTemplate union extended in 09-04
                   templateProps: {
                     pocName: u.name ?? "there",
                     kiosks: truncated.map((k) => ({
                       kioskId: k.outletCode,        // human-facing identifier (per kiosks.outletCode)
                       locationName: k.locationName,
                       region: k.region,
                       revenue: k.revenue,
                       percentile: k.percentile,
                       detailUrl: `${BRAND.prodUrl}/kiosks/${k.kioskId}`,
                     })),
                     moreCount,
                     windowDays: classification.windowDays,
                     runIsoWeek,
                   },
                   payloadHash: sha256(`${g.pocUserId}:${runIsoWeek}`),
                 },
               };
             })
             .filter((e): e is NonNullable<typeof e> => e !== null);
           alertedCount = events.length;
           if (events.length > 0) {
             await step.sendEvent("emit-poc-emails", events);
           }
         });

         // step 6: emit-skip-rows (kiosks with NULL POC OR users without an email row)
         // REQUIRES the BLOCKING migration 0044 (task 2 of this plan) to have extended
         // the email_log_status_check constraint to include 'skipped' before this runs.
         let skippedCount = 0;
         await step.run("emit-skip-rows", async () => {
           const skipKiosks = effectiveDecisions.filter(
             (d) => d.decision !== "no-alert" && d.internalPocId === null,
           );
           skippedCount = skipKiosks.length;
           for (const k of skipKiosks) {
             await db
               .insert(emailLog)
               .values({
                 kind: "underperforming_poc",
                 recipient: "[skip:no-poc]",
                 inngestRunId: runId,
                 status: "skipped",
                 payloadHash: null,
               })
               .onConflictDoNothing();
           }
         });

         // step 7: audit
         await step.run("write-run-audit", async () => {
           const isManual = event?.name === "performance-alerts/run.requested";
           await writeAuditLog({
             actorId: isManual ? (event?.data?.actorId ?? "system") : "system",
             actorName: isManual ? (event?.data?.actorName ?? "manual trigger") : "weekly-poc-alerts cron",
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

       export const weeklyPocAlertsFn = inngest.createFunction(
         {
           id: "weekly-poc-alerts",
           name: "Weekly POC underperformance alerts",
           triggers: [
             { cron: "TZ=Europe/London 0 9 * * 1" },
             { event: "performance-alerts/run.requested" },
           ],
           concurrency: { limit: 1 },
           retries: 3,
         },
         async ({ step, runId, event }) => {
           await _handleWeeklyPocAlerts({
             step: step as unknown as StepShim,
             runId,
             event: event as unknown as EventShim,
           });
         },
       );
       ```

    2. Match writeAuditLog's exact signature against src/lib/audit.ts. Verified: writeAuditLog accepts `metadata?: Record<string, unknown>` directly (no `as any` cast needed).

    3. Verify that `event.name` discriminator works at runtime — the Inngest typegen may require a generic. If TS rejects the union access, narrow via `if (event && "name" in event && event.name === "performance-alerts/run.requested")`.

    4. The narrowing on `kind: "underperforming_poc"` and `template: "poc-underperformance"` literals will type-check ONLY if plan 09-04 has merged first (it extends the EmailKind/EmailTemplate unions). This plan's `depends_on: [01, 02, 04]` enforces that ordering — Wave 3 cannot run until Wave 2 (which contains 09-04) completes.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "weekly-poc-alerts" || echo OK</automated>
  </verify>
  <done>
    - File exists with weeklyPocAlertsFn export AND _handleWeeklyPocAlerts export.
    - 7 step.run boundaries (`grep -c "step.run(" src/inngest/functions/weekly-poc-alerts.ts` returns at least 7 — 6 named step.run + 1 internal helper, depending on layout; minimum 6).
    - `grep -c "concurrency: { limit: 1 }" src/inngest/functions/weekly-poc-alerts.ts` returns 1 AND `grep -c "retries: 3" src/inngest/functions/weekly-poc-alerts.ts` returns 1.
    - Two triggers (cron + event): `grep -c "TZ=Europe/London" src/inngest/functions/weekly-poc-alerts.ts` returns 1 AND `grep -c "performance-alerts/run.requested" src/inngest/functions/weekly-poc-alerts.ts` returns at least 1.
    - First-run quiet behaviour implemented: `grep -c "firstRun" src/inngest/functions/weekly-poc-alerts.ts` returns at least 1.
    - Subject wording matches plan 09-04 must_haves: `grep -c 'Performance update — ' src/inngest/functions/weekly-poc-alerts.ts` returns at least 1.
    - `npx tsc --noEmit -p tsconfig.json` exits 0 (the `kind`/`template` literal narrowing succeeds because 09-04 extended the unions in Wave 2).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Register weeklyPocAlertsFn at src/app/api/inngest/route.ts</name>
  <files>src/app/api/inngest/route.ts</files>
  <read_first>
    - src/app/api/inngest/route.ts (full file — it's <10 lines).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/app/api/inngest/route.ts (modify)".
  </read_first>
  <behavior>
    - The Inngest serve handler exports the new weeklyPocAlertsFn alongside sendEmailFn.
    - Inngest auto-syncs the new cron schedule on the next deploy — verify post-deploy in the Inngest dashboard.
  </behavior>
  <action>
    Add a single import + array entry:
    ```typescript
    import { serve } from "inngest/next";
    import { inngest } from "@/inngest/client";
    import { sendEmailFn } from "@/inngest/functions/send-email";
    import { weeklyPocAlertsFn } from "@/inngest/functions/weekly-poc-alerts";

    export const { GET, POST, PUT } = serve({
      client: inngest,
      functions: [sendEmailFn, weeklyPocAlertsFn],
    });
    ```
  </action>
  <verify>
    <automated>grep -q "weeklyPocAlertsFn" src/app/api/inngest/route.ts &amp;&amp; echo OK</automated>
  </verify>
  <done>
    - `grep -c "weeklyPocAlertsFn" src/app/api/inngest/route.ts` returns at least 2 (one import, one in functions array).
    - `grep -c "sendEmailFn" src/app/api/inngest/route.ts` returns at least 2 (preserved alongside the new function).
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Author 3 integration tests against the synthetic K1-K10 fleet (supersedes Phase 8 placeholder per W10)</name>
  <files>tests/performance-alerts/eligibility.integration.test.ts, tests/performance-alerts/null-poc-skip.integration.test.ts, tests/performance-alerts/idempotency.integration.test.ts</files>
  <read_first>
    - tests/email/send-email-fn.integration.test.ts (full file — your structural template: vi.hoisted Resend mock, dbRef mock, setupTestDb / teardownTestDb, makeStepShim, beforeEach reset). Lines 119-158 are the placeholder this plan supersedes (W10 fix — see action step 6 below).
    - tests/helpers/test-db.ts — confirms the Testcontainers Postgres pattern.
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md § Synthetic Test Fixtures — the K1-K10 spec.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § Testcontainers integration-test scaffold.
  </read_first>
  <behavior>
    Each test seeds the K1-K10 fleet via setupTestDb() helpers and a custom seed function that inserts: pipeline_stages (Live + Prospect), app_settings (underperformance_window_days=30, pipeline_stage_id_live=Live UUID, threshold_outlet_tier_top|mid|bottom), users (user_alpha + user_beta), kiosks (K1-K10), kiosk_assignments + locations + regions, sales_records.

    Test file 1 — `eligibility.integration.test.ts` (covers VALIDATION row a):
    - it("classifies only Live + outlet_code-IS-NOT-NULL + non-archived + non-silenced kiosks", ...): seed K1-K10, drive _handleWeeklyPocAlerts via makeStepShim, assert kiosk_performance_alert_state has rows for K1, K2, K3, K4, K9, K10 (NOT K5/K6/K7/K8).
    - it("first-ever run is quiet: no email events emitted, only state writes", ...): assert sendEvent was called with an empty events array OR not called for the alertable groups; assert email_log has only the K4 skip row, no sent rows.
    - it("non-first run: K1+K2+K10 produce flip-in/chronic decisions for user_alpha; K3 flip-in for user_beta", ...): seed prior_state rows so this is NOT a first run, then drive the handler, assert sendEvent was called with 2 events (one per POC), assert payloadHashes are sha256 of the (poc_user_id, run_iso_week) pair.

    Test file 2 — `null-poc-skip.integration.test.ts` (covers VALIDATION row d):
    - it("kiosks with NULL internal_poc_id produce one email_log skip row each, no email events", ...): seed only K4 (or K4 + K1 to verify the NULL group is bucketed separately). Drive the handler. Assert: sendEvent NOT called (or called with K1's group only), email_log has 1 row WHERE recipient='[skip:no-poc]' AND status='skipped' AND kind='underperforming_poc' AND payload_hash IS NULL.

    Test file 3 — `idempotency.integration.test.ts` (covers VALIDATION row e + W10 end-to-end fix):
    - it("re-run within same ISO week emits no duplicate sent rows", ...): seed K1-K3 with non-first-run state. Drive the handler -> capture sendEvent calls. Then SIMULATE the sendEmailFn consuming those events by directly inserting the corresponding email_log rows with the captured payloadHashes (since the test does not run sendEmailFn). Then drive _handleWeeklyPocAlerts AGAIN; capture sendEvent call 2. Assert that the SECOND set of email payloadHashes are IDENTICAL to the first (same ISO week + same POC -> same hash). Then INSERT-with-onConflictDoNothing the second batch into email_log -> assert 0 rows added (the partial unique idx blocks them). This is the idempotency guarantee.
    - **NEW W10 case:** it("end-to-end: _handleSendEmail consuming a poc-underperformance event writes status='sent' with the matching payloadHash", ...): drive the Phase 9 sendEmailFn handler (`_handleSendEmail` from `src/inngest/functions/send-email.ts`) with the real Phase 9 template (`template: "poc-underperformance"`, kind: "underperforming_poc"`). Use the canonical 2-kiosk fixture from plan 09-04's snapshot test as templateProps, plus a fresh payloadHash = sha256(`<test-poc-user-id>:2026-W19`). Assert: email_log row exists WITH status='sent' AND kind='underperforming_poc' AND payload_hash matching the input. This case clones the Phase 8 placeholder pattern at `tests/email/send-email-fn.integration.test.ts:119-158` but exercises the REAL Phase 9 dispatch path through the TEMPLATES table extended in plan 09-04 task 3. **This test SUPERSEDES the Phase 8 placeholder at tests/email/send-email-fn.integration.test.ts:119-158.** Either remove the Phase 8 placeholder in this same task OR leave it in place with an updated comment line referencing `tests/performance-alerts/idempotency.integration.test.ts § "end-to-end: _handleSendEmail..."`. Whichever path you pick, the developer running this plan MUST grep-confirm only one source of truth remains for the template-dispatch test:
      - `grep -c "poc-underperformance" tests/email/send-email-fn.integration.test.ts` should return 0 (placeholder removed) OR the placeholder body is replaced with a one-line comment.

    All three files must run under: `npx vitest run --project integration tests/performance-alerts/`. Test runtime <60s per file.
  </behavior>
  <action>
    1. Create the test directory: `tests/performance-alerts/` (mkdir).
    2. Write a shared seed helper (inline or as `tests/performance-alerts/_seed.ts`) that inserts K1-K10 per the VALIDATION § Synthetic Test Fixtures table. Use the `setupTestDb` ctx and the test DB's drizzle client. Seed `regions` rows + `kiosk_assignments` rows so the cron's classify-kiosks JOIN (region from `regions.name` via `locations.primary_region_id`) returns rows.
    3. Write each of the three test files using the structural template from tests/email/send-email-fn.integration.test.ts:
       - vi.hoisted resend mock (just to satisfy any imports — the cron itself doesn't call Resend; the new W10 case in idempotency.integration.test.ts DOES exercise sendEmailFn, so the resend mock matters there)
       - dbRef mock against `@/db`
       - setupTestDb / teardownTestDb in beforeAll/afterAll
       - beforeEach: clear emailLog + kioskPerformanceAlertState + audit_logs + sales_records as needed
       - drive `_handleWeeklyPocAlerts({ step: makeStepShim(), runId: "test-run-1", event: undefined })`
       - assert via direct selects against the test DB
    4. The makeStepShim must implement BOTH `run` AND `sendEvent`:
       ```typescript
       function makeStepShim() {
         const sentEvents: unknown[] = [];
         return {
           shim: {
             run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
             sendEvent: async (_id: string, events: unknown[]) => { sentEvents.push(...events); },
           },
           sentEvents,
         };
       }
       ```
       Tests inspect `sentEvents` to assert the per-POC fan-out shape.
    5. **W10 — write the new end-to-end case in `idempotency.integration.test.ts`** that drives `_handleSendEmail` with `template: "poc-underperformance"`. Import the helper from `src/inngest/functions/send-email.ts` (already exported per Phase 8 patterns). Use a fresh test DB connection so the resend mock captures the actual call shape; assert email_log row creation with `status='sent'` and matching `payload_hash`.
    6. **W10 — supersede the Phase 8 placeholder.** Either:
       - (a) Delete the placeholder test body at `tests/email/send-email-fn.integration.test.ts:119-158` — replace with a single comment: `// Phase 9 supersedes — see tests/performance-alerts/idempotency.integration.test.ts § "end-to-end: _handleSendEmail consuming a poc-underperformance event"`.
       - (b) Leave the placeholder body intact but UPDATE the existing comment header to point at the new test (informational hand-off only).
       Pick (a) by default; pick (b) ONLY if the placeholder still serves a Phase-8-specific purpose (it doesn't — it was always a Phase 9 placeholder per its hand-off comment). Document the choice in the plan SUMMARY.
    7. Verify each file passes individually via the listed vitest command before declaring the task done.
  </action>
  <verify>
    <automated>npx vitest run --project integration tests/performance-alerts/</automated>
  </verify>
  <done>
    - Three test files exist in tests/performance-alerts/.
    - All three pass: `npx vitest run --project integration tests/performance-alerts/` exits 0.
    - Each test file covers the VALIDATION row it claims (a, d, e).
    - Synthetic K1-K10 fleet seeded via a shared helper.
    - Tests drive `_handleWeeklyPocAlerts` directly (no Inngest dev server needed).
    - **W10 — end-to-end case present:** `grep -c "_handleSendEmail" tests/performance-alerts/idempotency.integration.test.ts` returns at least 1 AND `grep -c "template: \"poc-underperformance\"" tests/performance-alerts/idempotency.integration.test.ts` returns at least 1.
    - **W10 — placeholder superseded:** at least one of these holds:
      - `grep -c "poc-underperformance" tests/email/send-email-fn.integration.test.ts` returns 0 (placeholder body removed; option (a)), OR
      - the placeholder header comment at `tests/email/send-email-fn.integration.test.ts` lines 119-158 references the new test path (`grep -c "tests/performance-alerts/idempotency" tests/email/send-email-fn.integration.test.ts` returns at least 1; option (b)).
  </done>
</task>

</tasks>

<verification>
- `grep -q "weeklyPocAlertsFn" src/app/api/inngest/route.ts` -> success
- `grep -q "concurrency: { limit: 1 }" src/inngest/functions/weekly-poc-alerts.ts` -> success
- `grep -q 'cron: "TZ=Europe/London 0 9 \* \* 1"' src/inngest/functions/weekly-poc-alerts.ts` -> success
- `grep -q '"performance-alerts/run.requested"' src/inngest/functions/weekly-poc-alerts.ts` -> success
- `grep -q "performance_alert_run" src/lib/audit.ts` -> success (this plan owns the entityType extension; the EmailKind/EmailTemplate extensions are owned by 09-04 per BLOCKER-3)
- `grep -c "underperforming_poc\|poc-underperformance" src/inngest/events.ts` returns at least 1 (proves 09-04 extended the unions before this plan's tsc check)
- `grep -c "CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))" migrations/0044_phase_09_email_log_skipped_status.sql` returns 1 (BLOCKER 1+2 — the BLOCKING migration is on disk)
- Runtime: `email_log_status_check` constraint in the dev DB contains `'skipped'` (BLOCKER 1+2 — verify via the task 2 runtime SELECT)
- `grep -c "l.region" src/lib/performance-alerts/classify-kiosks.ts` returns 0 (W5 — the dropped column is not referenced)
- `grep -c "r.name" src/lib/performance-alerts/classify-kiosks.ts` returns at least 1 (W5 — region is sourced from regions.name)
- `npx vitest run --project integration tests/performance-alerts/` exits 0
- `npx tsc --noEmit -p tsconfig.json` exits 0
- After deploy: Inngest dashboard shows weekly-poc-alerts function with next-run = next Monday 09:00 London (operator verifies)
</verification>

<success_criteria>
1. `weeklyPocAlertsFn` exists, registered in `/api/inngest/route.ts`, with both triggers + concurrency limit 1.
2. Per-kiosk SQL classifier exists and uses the existing percentile cutoffs (no reimplementation). The SQL projects region from `regions.name` via `locations.primary_region_id` (W5 — the dropped `locations.region` is not referenced).
3. The 3 Wave 0 integration tests pass against the synthetic K1-K10 fleet — VALIDATION rows (a), (d), (e) all green.
4. The new end-to-end W10 test case in `idempotency.integration.test.ts` drives `_handleSendEmail` with `template: "poc-underperformance"` and produces an `email_log` row with `status='sent'` AND a payload_hash matching `sha256(JSON.stringify({ pocUserId, runIsoWeek }))` (or the equivalent shape used elsewhere in the codebase).
5. The Phase 8 placeholder at `tests/email/send-email-fn.integration.test.ts:119-158` is either removed (option a) or annotated to point at the new test (option b) — exactly one source of truth for the Phase 9 dispatch case.
6. NULL-POC kiosks produce skip rows; same ISO week re-run produces 0 new sent rows.
7. First-ever run is quiet (option a; documented in code comment + integration test).
8. Schema extension for `email_log.status` to include `'queued'` + `'skipped'` applied via migration 0044 + drizzle-kit push (BLOCKING task 2 — runtime SELECT confirms the constraint is live before integration tests run).
9. BLOCKER-3 satisfied: this plan does NOT modify src/inngest/events.ts (the EmailKind/EmailTemplate union extensions are owned by 09-04). The cron consumes the unions via TS compile-time narrowing; `depends_on: [01, 02, 04]` enforces 09-04 merging first.
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-03-SUMMARY.md` with:
- Files created (cron + classifier + 3 integration tests + migration 0044)
- Files modified (audit.ts, route.ts, schema.ts; **NOT events.ts** — owned by 09-04 per BLOCKER-3)
- The 3 integration test runtimes
- The synthetic K1-K10 fleet seed function location (for reuse in 09-05/09-06)
- Confirmation of first-run quiet behaviour + the migration 0044 application (with the runtime SELECT output proving `'skipped'` is in the live constraint)
- W5 confirmation: the classify-kiosks SQL JOINs `regions` via `locations.primary_region_id` and projects `r.name AS region` (the dropped `locations.region` is not referenced)
- W10 confirmation: which option (a or b) was chosen for the Phase 8 placeholder supersession + the new end-to-end test case path
- BLOCKER-3 confirmation: which 09-04 SUMMARY.md commit added the EmailKind/EmailTemplate union extensions (referencing the SHA so the audit trail is complete)
- Any deviations: e.g. if a column name in classify-kiosks.ts SQL had to be corrected vs the reference shape
</output>
