# Phase 9: POC Underperformance Alerts - Research

**Researched:** 2026-05-09
**Domain:** Inngest scheduled cron + Postgres aggregation + react-email dispatch
**Confidence:** HIGH (all load-bearing decisions verified against installed source / Phase 8 code / Context7-fetched Inngest docs)

## Summary

Phase 9 ships a single Inngest function with two triggers (weekly cron + admin "Run now" event) that classifies `Live` kiosks against the existing `appSettings` percentile cutoffs over an admin-tunable trailing window, persists per-kiosk classification state to a new `kiosk_performance_alert_state` table, and emits one `email/send.requested` event per POC owning bottom-tier kiosks. The Phase 8 substrate (`src/inngest/functions/send-email.ts` + `email_log` partial unique idx + react-email components) is reused verbatim — Phase 9 only adds (a) one cron function, (b) one new react-email template, (c) one schema migration, (d) one admin route, (e) one kiosk-detail-page silencing control. **No new npm dependencies are needed** — every required library is already in `package.json` post-Phase-8.

**Primary recommendation:** Adopt the **UUID-pin-via-appSettings** strategy for D-09 (`pipeline_stage_id_live` row in `app_settings`, seeded at migration time from the seeded "Live" UUID, admin-tunable from the existing pipeline-stages settings page). It has the lowest blast radius, matches the existing `appSettings`-as-config-store pattern (seven `threshold_*` rows already live there), is admin-correctable without a deploy, and survives the planned admin pipeline-stage rename UI. The seeded `position=7000` fallback is used only at migration-seed time to find the UUID, never at cron runtime.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Weekly classification cron (kiosk → tier) | API / Backend (Inngest) | Database / Storage | Inngest is the locked async substrate (STATE.md v1.1 lock); classification reads sales_records + kiosks |
| "Run now" manual trigger | API / Backend (server action) | API / Backend (Inngest event) | Server action + RBAC gate posts `inngest.send`; cron function consumes |
| Email rendering + delivery | API / Backend (Inngest) | External (Resend) | Reuse Phase 8 `sendEmailFn` verbatim — Phase 9 only adds a template entry |
| Per-kiosk alert state | Database / Storage | — | New `kiosk_performance_alert_state` table; sole owner is the cron function |
| Per-kiosk silencing toggle | Frontend Server (RSC + server action) | Database / Storage | Admin UI on kiosk detail page; server action mutates `kiosks.alert_silenced_at` |
| Admin metadata page (`/admin/performance-alerts`) | Frontend Server (RSC) | Database / Storage | Same shape as `/admin/cache` — RSC reads, server action writes |
| Idempotency enforcement | Database / Storage | — | Existing `email_log` partial unique idx `(kind, payload_hash) WHERE payload_hash IS NOT NULL` from migration 0041 |

## Standard Stack

### Core (already installed — no new deps)

| Library | Installed Version | Purpose | Why Standard |
|---------|------------------|---------|--------------|
| `inngest` | `~4.3.0` | Cron schedule + event triggers + step memoisation | Phase 8 D-05 lock; `email_log.inngest_run_id` already wired |
| `resend` | `~6.12.3` | Outbound HTTP email send | Phase 8 D-01 lock; Phase 9 reuses Phase 8's `sendEmailFn` |
| `@react-email/components` | `~1.0.12` | Template primitives (`Html`, `Body`, `Heading`, `Section`, `Text`, `Link`, `Hr`) | Phase 8 D-07 lock; `password-changed.tsx` is the reference clone target |
| `@react-email/render` | `~2.0.8` | Async render of React → HTML/text | Used inside `sendEmailFn` step boundary 1 |
| `drizzle-orm` (already in repo) | (pinned by Phase 8 patch) | Schema additions + cron query | Existing pattern; new migration `0043` |

### Supporting (already installed)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `date-fns` (or built-in) | ISO-week computation for `payloadHash` keying | When deriving `run_iso_week = YYYY-Www` from `runAt` Date |
| `crypto` (Node built-in) | `sha256(poc_user_id + ':' + run_iso_week)` for `payloadHash` | At event-emission boundary in the cron function |
| `next/cache` `unstable_cache` | If admin-page metrics ever go cached | Default to **uncached** per CONTEXT D-23 last bullet — only cache if observed slow |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Standalone `kiosk_performance_alert_state` table | Inline JSON column on `kiosks` (`last_alert_state jsonb`) | JSON-on-kiosks loses type-safety + can't be indexed by `tier` for the per-run query; **rejected** |
| Per-kiosk `payload_hash` keying | Per-POC `(poc_user_id, run_iso_week)` keying (CONTEXT D-17) | D-17 is locked — keep the dedupe at the per-POC granularity so a manual re-run after partial failure can resend ONLY missing POCs (not duplicate already-sent ones) |
| Live string match `pipelineStages.name = 'Live'` | UUID-pin via `appSettings` (recommended) | String match is **explicitly forbidden by D-09** + brittle across admin renames |
| Inngest function emits one event per kiosk | Per-POC batched event (locked D-06) | Per-kiosk would explode the email volume + violate D-06 |

**Installation:** None — all packages already in `package.json` post-Phase-8. The CLAUDE.md `linux/amd64` Docker lockfile regen recipe is **NOT triggered** by this phase. [VERIFIED: read package.json at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/package.json]

**Version verification:** [VERIFIED: package.json] inngest@~4.3.0 (Phase 8 ships 4.2.6 in REQUIREMENTS table, but installed is 4.3.0 — the multi-trigger + cron-with-TZ surface used here is identical and stable across both). The sole runtime-relevant API surface (`inngest.createFunction({ triggers: [...] })`) is unchanged between 4.2 and 4.3.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Inngest Schedule (TZ=Europe/London 0 9 * * 1)                          │
│         OR                                                              │
│  Admin "Run now" button → server action → inngest.send(                 │
│         { name: "performance-alerts/run.requested" } )                  │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  weeklyPocAlertsFn  (src/inngest/functions/weekly-poc-alerts.ts)        │
│  triggers: [ { cron: "TZ=Europe/London 0 9 * * 1" },                    │
│              { event: "performance-alerts/run.requested" } ]            │
│  concurrency: { limit: 1 }   // race-protect Run-now spam               │
│                                                                         │
│  step 1: load-config        → app_settings: window, live UUID, tiers    │
│  step 2: classify-kiosks    → SELECT kiosks WHERE pipeline=live         │
│                              AND archived_at IS NULL                    │
│                              AND outlet_code IS NOT NULL                │
│                              AND alert_silenced_at IS NULL              │
│                              JOIN sales over window → tier              │
│  step 3: diff-state         → fetch prior tier per kiosk                │
│                              → tag flip-in / chronic / no-alert          │
│  step 4: write-state        → UPSERT kiosk_performance_alert_state      │
│  step 5: emit-email-events  → group by internal_poc_id                  │
│                              → for each POC: inngest.send(              │
│                                  email/send.requested, payloadHash)     │
│  step 6: emit-skip-rows     → for NULL POC: write email_log skip row    │
│  step 7: write-run-audit    → audit_logs (entity=performance_alert_run) │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
                       │ inngest.send("email/send.requested")
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  sendEmailFn  (Phase 8, unchanged)                                      │
│  step 1: render-html      → TEMPLATES["poc-underperformance"](props)    │
│  step 2: resend-send      → Resend.emails.send                          │
│  step 3: log              → INSERT email_log ON CONFLICT DO NOTHING     │
│                              against (kind, payload_hash) partial idx   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Admin Surfaces                                                         │
│  /admin/performance-alerts (RSC, requireRole("admin"))                  │
│    └─ reads kiosk_performance_alert_state + email_log + audit_logs      │
│    └─ "Run now" button → server action → inngest.send                   │
│  /kiosks/[id] (admin-gated section in existing form)                    │
│    └─ silence/unsilence control                                         │
│        → server action mutates kiosks.alert_silenced_at + reason        │
│        → writes audit_logs row                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── inngest/
│   ├── client.ts                    # existing, unchanged
│   ├── events.ts                    # extend EmailKind + EmailTemplate unions
│   └── functions/
│       ├── send-email.ts            # extend TEMPLATES dispatch + text-version
│       └── weekly-poc-alerts.ts     # NEW — cron + event handler
├── emails/
│   ├── poc-underperformance.tsx     # NEW — react-email template
│   ├── text-versions.ts             # extend with pocUnderperformanceText()
│   ├── _layout.tsx                  # existing, reused
│   ├── _cta.tsx                     # existing, reused
│   └── brand.ts                     # existing, reused
├── lib/
│   └── performance-alerts/          # NEW — pure functions for unit-test
│       ├── classify-dispatch.ts     # decideAlert(prior, new, lastAlertedAt)
│       ├── poc-batching.ts          # groupByPoc(kiosks)
│       └── iso-week.ts              # toIsoWeek(date) → "2026-W19"
├── app/
│   ├── api/inngest/route.ts         # add weeklyPocAlertsFn to functions[]
│   └── (app)/
│       ├── admin/
│       │   └── performance-alerts/  # NEW
│       │       ├── page.tsx         # RSC, requireRole("admin")
│       │       ├── run-now-button.tsx
│       │       └── actions.ts       # 'use server' — emits inngest event
│       └── kiosks/[id]/
│           └── (extend existing form with admin silence control)
└── db/
    └── schema.ts                    # add kioskPerformanceAlertState +
                                      kiosks.alertSilencedAt + reason

migrations/
└── 0043_phase_09_poc_underperformance_alerts.sql   # NEW
```

[VERIFIED: All paths exist or follow existing conventions; admin/cache/ + admin/audit-log/ are the structural precedents read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/app/(app)/admin/]

### Pattern 1: Inngest function with cron + event multi-trigger

**What:** A single function with both a scheduled cron and an event trigger, so the manual "Run now" button uses the same code path as the weekly schedule.

**When to use:** Any time you want a scheduled job that operators can also trigger on demand.

**Example:**
```typescript
// Source: Context7 docs — /inngest/website "Multiple Triggers for a Function"
// [CITED: pages/docs/guides/multiple-triggers.mdx]
// [VERIFIED: installed inngest 4.3.0 types.d.ts lines 1182-1200]
import { inngest } from "@/inngest/client";

export const weeklyPocAlertsFn = inngest.createFunction(
  {
    id: "weekly-poc-alerts",
    name: "Weekly POC underperformance alerts",
    triggers: [
      { cron: "TZ=Europe/London 0 9 * * 1" },           // Mondays 09:00 London
      { event: "performance-alerts/run.requested" },     // admin "Run now"
    ],
    // Race protection for double-clicks on Run-now and cron-overlap-with-manual.
    // Single concurrent run ever; the second invocation queues.
    concurrency: { limit: 1 },
    // Inngest deduplicates events with the same `id` for 24h. The cron
    // trigger emits with auto-generated id; the manual trigger sets a
    // human-supplied id (see Pattern 4) so a double-click is collapsed.
    retries: 3,
  },
  async ({ step, runId, event }) => {
    // event is undefined for cron triggers, populated for event triggers
    const triggerKind = event?.name === "performance-alerts/run.requested" ? "manual" : "cron";
    // ... step boundaries below
  },
);
```

### Pattern 2: TZ-aware cron syntax (DST handling)

**What:** Inngest's cron parser understands a `TZ=` prefix in the cron string itself. The server-side parser handles DST automatically — the function fires at 09:00 London regardless of whether London is currently on BST (UTC+1) or GMT (UTC+0).

**Example:**
```typescript
// Source: Context7 docs — /inngest/website "Create a Scheduled Function with Timezone in TypeScript"
// [CITED: pages/docs/guides/scheduled-functions.mdx]
triggers: [{ cron: "TZ=Europe/London 0 9 * * 1" }]   // not "0 9 * * 1" with separate tz field
```

**DST behaviour:** [CITED: Inngest scheduled-functions docs] Inngest computes the next firing time in the specified IANA zone. Spring-forward / fall-back is invisible to the function code — `runId` and `event.ts` reflect the actual UTC moment, but the cron expression evaluates in the named zone.

### Pattern 3: Step boundaries for cron functions (memoisation across retries)

**What:** Each `step.run` is memoised by Inngest. If step 4 fails and the function retries, steps 1-3 are NOT re-run — their outputs are replayed from the durable state store. This is critical for correctness: classification must not change between attempts of the same run.

**Why it matters here:** Without step boundaries, a transient DB blip during the email-emit step would re-classify all kiosks on retry — possibly producing a different tier verdict on the second attempt (race against fresh sales data) and writing inconsistent state.

**Example pattern (extracted from Phase 8 `sendEmailFn`, lines 71-133):**
```typescript
// Source: src/inngest/functions/send-email.ts (Phase 8)
// [VERIFIED: read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/inngest/functions/send-email.ts]
const config = await step.run("load-config", async () => { ... });
const classifications = await step.run("classify-kiosks", async () => { ... });
const decisions = await step.run("diff-state", async () => { ... });
await step.run("write-state", async () => { ... });
await step.run("emit-email-events", async () => {
  // Use step.sendEvent for fan-out (see Pattern 5)
  await step.sendEvent("emit-poc-emails", events);
});
```

### Pattern 4: Manual "Run now" with idempotency key

**What:** The admin "Run now" button server-action calls `inngest.send` with a stable `id` that collapses double-clicks within 24 hours.

**Example:**
```typescript
// Source: Context7 docs — /inngest/website "Send Event with Idempotency Key (TypeScript)"
// [CITED: pages/docs/guides/handling-idempotency.mdx]
// admin/performance-alerts/actions.ts
'use server';
import { inngest } from "@/inngest/client";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

export async function triggerRunNow() {
  const session = await requireRole("admin");
  // 1-minute id bucket — operator double-clicks within 60s collapse;
  // a deliberate retry after a minute starts a new run.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  await inngest.send({
    id: `performance-alerts-manual-${session.user.id}-${minuteBucket}`,
    name: "performance-alerts/run.requested",
    data: { actorId: session.user.id, actorName: session.user.name },
  });
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name ?? "unknown",
    entityType: "system",        // existing audit-logs entity-type union
    entityId: "performance_alert_run",
    entityName: "Performance Alert Run",
    action: "start_impersonation", // PLACEHOLDER — extend audit.ts union
                                   // (see "Schema additions" below)
  });
  return { ok: true };
}
```

**Note:** `src/lib/audit.ts` has a closed `entityType` and `action` union [VERIFIED: lines 12, 18-43]. The phase MUST extend both unions to admit `entity_type='performance_alert_run'` (entityType) and `action='trigger'` (action) — this is a one-line code edit, not a migration. Existing patterns: cache-purge added `'cache'` to entityType; existing audit-log entries write to a free-form text column underneath, so this is purely TypeScript-level.

### Pattern 5: Per-POC fan-out via `step.sendEvent`

**What:** After classification, the cron function emits one `email/send.requested` event per POC. Inngest's existing `sendEmailFn` (Phase 8) consumes them in parallel — each POC's email render+send is its own retry-isolated Inngest run.

**Example:**
```typescript
// Source: Context7 docs — /inngest/website "Create a Scheduled Function with Timezone in TypeScript"
// [CITED: pages/docs/guides/scheduled-functions.mdx]
await step.run("emit-poc-emails", async () => {
  const events = pocsToAlert.map((poc) => ({
    name: "email/send.requested" as const,
    data: {
      kind: "underperforming_poc",
      to: poc.email,
      subject: `Performance update — ${poc.kiosks.length} kiosks need attention`,
      template: "poc-underperformance" as const,
      templateProps: { ...poc, runIsoWeek, windowDays },
      payloadHash: sha256(`${poc.userId}:${runIsoWeek}`),
    },
  }));
  await step.sendEvent("emit-poc-emails", events);  // single batch
});
```

### Anti-Patterns to Avoid

- **Running classification logic outside `step.run`:** mutating DB rows or computing tier verdicts inside the function body (not in a step) means a retry re-runs them with possibly-different inputs. ALWAYS wrap deterministic-output work in `step.run`.
- **Holding a long-lived DB transaction across steps:** Inngest steps can be paused/replayed across hours; never `BEGIN ... COMMIT` across step boundaries. Each step.run is its own transactional scope.
- **String-matching pipeline stage by name:** [FORBIDDEN by CONTEXT D-09] — the admin can rename the "Live" stage at any time. Use UUID via `appSettings.pipeline_stage_id_live`.
- **Re-implementing tier classification:** [FORBIDDEN by CONTEXT D-03] — call `getOutletTierThresholds()` and `classifyOutletTier()` from `src/lib/analytics/{thresholds-server.ts, metrics.ts}`. Do not inline percentile cutoffs.
- **Per-kiosk email sends:** [FORBIDDEN by CONTEXT D-06] — group by `internal_poc_id` first, emit one event per POC.
- **Querying `getOutletTiers()` directly:** [VERIFIED: src/lib/analytics/queries/portfolio.ts lines 408-520] — that query is **per-LOCATION** (GROUP BY `locations.id`) and uses 4-tier classification (Premium/Standard/Developing/Emerging), not the 3-tier (top/mid/bottom) shape D-03 requires. The cron MUST aggregate **per-kiosk** with its own SQL using `kiosks.id` as the grouping key, then call `classifyOutletTier(percentile, tierConfig)` on the per-kiosk percentile rank. The mapping `Emerging` ⇒ "bottom" tier per `classifyOutletTier`'s threshold semantics: `percentile < bottom` (default 20). [VERIFIED: src/lib/analytics/metrics.ts lines 111-119].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | `vercel.json` cron entries | Inngest `triggers: [{ cron: "TZ=... ..." }]` | STATE.md v1.1 lock: "no `vercel.json` cron entries"; Inngest handles DST + retries + observability |
| Email queue / retry / dedupe | Bespoke `email_jobs` table + worker | Phase 8 `sendEmailFn` + `inngest.send({ name: "email/send.requested" })` | STATE.md v1.1 lock: "no bespoke `email_jobs` table"; Phase 8 already wired |
| Email template HTML | Hand-built HTML strings | `@react-email/components` + `_layout.tsx` clone | Phase 8 D-07 lock; Outlook-renderer issues already solved by `_layout.tsx`'s table layout |
| Tier classification | Re-implement percentile cutoffs | `classifyOutletTier(percentile, await getOutletTierThresholds())` | CONTEXT D-03 lock; admin-tunable cutoffs already wired |
| ISO week computation | Hand-rolled "is it the same Monday?" logic | `date-fns/getISOWeek` + `getISOWeekYear` (date-fns is transitively installed) OR `Intl.DateTimeFormat` with `week` field | Off-by-one bugs around week boundaries are inevitable in hand-rolled code |
| RBAC admin gate | Inline session checks | `await requireRole("admin")` from `src/lib/rbac.ts` | Existing pattern across `/admin/*`; the cache page is the reference [VERIFIED: src/app/(app)/admin/cache/page.tsx line 10] |
| Audit log write | Direct `db.insert(auditLogs)` | `await writeAuditLog({...})` from `src/lib/audit.ts` | Type-safe entityType / action unions; matches Phase 7 conventions |

**Key insight:** This phase is a thin orchestration layer over substrate that already exists. The "complexity budget" should go into the per-kiosk classification SQL, the dispatch-decision pure function, and the email body copy. Everything else is plumbing that already works.

## Common Pitfalls

### Pitfall 1: ISO-week boundary semantics for `payloadHash`

**What goes wrong:** A cron run on Monday 09:00 London + a manual run on Sunday 23:55 London (same calendar week, but Sunday→Monday is the ISO-week boundary) could produce different `runIsoWeek` strings → two emails to the same POC.

**Why it happens:** ISO-8601 weeks start Mondays — Sunday belongs to the *previous* week. A `Date` constructed in UTC vs. London at the boundary disagrees about which week it's in.

**How to avoid:**
1. Compute `runIsoWeek` in **Europe/London** wall-clock time, never UTC. Use `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })` to extract the date components first, then compute ISO-week from those.
2. Round the cron `runAt` Date to the **nearest Monday in Europe/London** before hashing — this gives the same key for any run within Mon 00:00 → Sun 23:59 London.
3. Add a unit test (`src/lib/performance-alerts/iso-week.test.ts`) with cases: 2026-12-28 (Mon, week 53), 2026-12-31 (Thu, week 53), 2027-01-03 (Sun, week 53), 2027-01-04 (Mon, week 1) — these are the canonical ISO-week edge cases.

**Warning signs:** Two `email_log` rows for the same POC within 7 days; payload_hash values differ by one digit at year-end.

### Pitfall 2: DST drift on the cron schedule

**What goes wrong:** [CITED: Inngest scheduled-functions docs] Inngest's TZ-aware parser handles DST itself — the cron `TZ=Europe/London 0 9 * * 1` always fires at 09:00 London. There's nothing to "drift". The pitfall is **assuming** drift and adding compensation logic.

**Why it happens:** Engineers seeing `Europe/London` reach for naïve "subtract one hour for BST" logic, double-correcting.

**How to avoid:** Trust the `TZ=` prefix. Do NOT compute time-zone offsets in the function body. The `runId` you log will be the UTC instant; convert for human display only.

**Warning signs:** Function body contains `getTimezoneOffset` or hard-coded `+1h` / `-1h` arithmetic.

### Pitfall 3: Per-POC batching when a POC owns >50 kiosks

**What goes wrong:** Resend's HTTP API documents a soft 50-recipient cap on `to:` and a 100KB body cap. A POC owning 80 underperforming kiosks doesn't hit the recipient cap (one POC = one recipient) but their email body could approach 100KB if every kiosk has a long location name + free-text region note.

**Why it happens:** Internal-tool design ignores the long tail; a POC for a multi-region brand can legitimately own dozens of kiosks.

**How to avoid:**
1. Cap the email body at the first **N=25** bottom-tier kiosks (sorted by total sales over window, ascending — worst performers first).
2. Add a footer line: "+ 12 more kiosks below cutoff — view full list at /analytics/portfolio".
3. The `payloadHash` keying on `(poc_user_id, run_iso_week)` is unaffected — one email per POC per week regardless of N.
4. Unit-test the truncation at N+1, N, N-1 boundaries.

**Warning signs:** A `Resend.emails.send` returns 413 / "request entity too large".

### Pitfall 4: Silenced kiosks during flip-in

**What goes wrong:** A kiosk is silenced AT 08:55 Monday by an admin. The cron fires at 09:00 Monday. Whether the kiosk shows up in the POC email depends on D-19's planner-discretion clause: "silenced kiosks excluded entirely OR classified-but-not-alerted".

**Recommendation:** **Excluded entirely from the cron walk.** SQL filter: `AND alert_silenced_at IS NULL`. Two reasons:
1. The state row is preserved with whatever its prior value was, so when the kiosk is unsilenced later, the next run computes a fresh `prior_tier` from that stale snapshot. This is the desired behaviour: the operator silenced specifically to suppress the noise; we should not re-classify behind their back.
2. Reduces query volume on the cron (skips a `JOIN sales` for silenced kiosks).

**How to avoid the alternative confusion:** Document this in PLAN.md and seed an integration test (synthetic kiosk silenced mid-flow → assertion: no state row update, no email).

**Warning signs:** A silenced kiosk's `kiosk_performance_alert_state.last_run_at` advances after each Monday — that's the wrong path.

### Pitfall 5: Run-now race when admin double-clicks

**What goes wrong:** Admin clicks "Run now" twice in <1s. Two `inngest.send` calls, two function runs, double-classified state writes, possibly two POC emails (the second runs after the first's `email_log` write — `payloadHash` would dedupe in the email step, but state writes can race).

**How to avoid:**
1. **Inngest event idempotency key** [VERIFIED: Context7 /inngest/website handling-idempotency.mdx]: `inngest.send({ id: "performance-alerts-manual-{userId}-{minute}", ... })` — Inngest dedupes events with the same `id` for 24h.
2. **Function-level concurrency** [VERIFIED: Context7 docs functions/concurrency.mdx]: `concurrency: { limit: 1 }` on `weeklyPocAlertsFn` — even if two events slip through, they queue serially.
3. **No DB-level lock needed** because state writes are UPSERTs and the email-step idempotency rides the `email_log` partial unique idx.

**Warning signs:** Two `audit_logs` rows for the same `entityType='performance_alert_run'` within seconds.

### Pitfall 6: Better Auth user IDs are TEXT, not UUID

**What goes wrong:** [VERIFIED: src/db/schema.ts line 28 — `user.id: text("id").primaryKey()`] The `internal_poc_id` FK on `kiosks` is `text(...).references(user.id)`, NOT `uuid`. Drizzle migrations that copy from another phase's UUID-FK template will fail because the FK column type doesn't match.

**Why it happens:** Better Auth uses random 32-char strings as IDs (per `audit_logs.entity_id` comment at schema.ts:303-305), not UUIDs. The new `kiosk_performance_alert_state` table doesn't reference users directly (its FK is on `kiosks`), so this isn't an issue here — but the email_log skip rows (D-07: NULL POC, populate `recipient` field) interact with the user table when filtering admin metadata.

**How to avoid:** When the cron looks up POC emails, JOIN `kiosks.internal_poc_id` against `user.id` using **text equality**, not UUID equality. Drizzle handles this correctly when the schema is right — just don't change the FK type.

**Warning signs:** `error: column "internal_poc_id" is of type text but expression is of type uuid`.

### Pitfall 7: Kiosks with NULL `outlet_code`

**What goes wrong:** [VERIFIED: src/db/schema.ts line 120 — `outletCode: text("outlet_code")`] `kiosks.outlet_code` is nullable. Pre-launch / placeholder kiosks have NULL. Joining sales on NULL produces no rows, so the kiosk's per-window revenue is 0 → percentile rank is the lowest possible → ALL nullable-outlet-code kiosks would land in bottom tier and spam every POC.

**How to avoid:** [LOCKED by CONTEXT D-08] Filter `kiosks.outlet_code IS NOT NULL` in the eligibility WHERE clause. Document this filter prominently in the cron's `step.run("classify-kiosks")` body.

**Warning signs:** A "Run now" preview shows 200+ bottom-tier kiosks on a fleet with ~1000 trading kiosks.

### Pitfall 8: First-ever run has no prior state

**What goes wrong:** The very first cron run finds zero rows in `kiosk_performance_alert_state`. By the flip-in rule (D-10), every bottom-tier kiosk is treated as "flipped INTO bottom" → every POC of every bottom-tier kiosk gets an email on launch day.

**How to avoid:** Two options, planner picks:
- **(a) Quiet first run:** Detect zero state rows, write state but skip alerts on the first run. Operator triggers "Run now" on day 7 to alert on actual flips. Documented in CONTEXT.md as discretion.
- **(b) Loud first run with operator forewarning:** Email the prod admin a heads-up before the migration applies; the natural Monday-09:00 cron alerts everyone for the genuinely-bottom-tier kiosks they own. This matches the spirit of the alert (everyone in bottom tier today is a candidate).

**Recommendation:** Option (a) — quiet first run. POCs reading their first email should see a flip-in worth attention; "you've been in bottom tier from day one" is not actionable in the same way.

**Warning signs:** Day-1 alert volume spike → operator inbox flood.

### Pitfall 9: Resend / Inngest down at 09:00 Monday

**What goes wrong:** External dependency outage at the exact cron firing moment.

**How to avoid:** No code change needed — Inngest's built-in retry handles this. [CITED: Inngest docs] The function retries with exponential backoff up to `retries: N` (default 3, Phase 8 sets 5 on `sendEmailFn`). For the cron itself, retry 3 should be enough — by the third retry (~minutes later), Resend or Inngest is back. If both are still down >15min, the run lands in Inngest's dead-letter queue and is visible in the Inngest dashboard.

**Warning signs:** Function shows `failed` status in Inngest dashboard for >1h. Operator action: investigate via Inngest dashboard, not the app.

## Code Examples

Verified patterns from official sources and existing codebase.

### Cron + manual trigger function shape

```typescript
// src/inngest/functions/weekly-poc-alerts.ts
// [PATTERN: Multi-trigger cron + concurrency from Context7 /inngest/website]
// [PATTERN: Step boundaries from src/inngest/functions/send-email.ts lines 71-133]
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  kiosks,
  kioskPerformanceAlertState,
  appSettings,
  user,
  emailLog,
  pipelineStages,
} from "@/db/schema";
import { inngest } from "../client";
import { getOutletTierThresholds } from "@/lib/analytics/thresholds-server";
import { classifyOutletTier } from "@/lib/analytics/metrics";
import { decideAlert } from "@/lib/performance-alerts/classify-dispatch";
import { groupByPoc } from "@/lib/performance-alerts/poc-batching";
import { toIsoWeek } from "@/lib/performance-alerts/iso-week";
import { sha256 } from "@/lib/performance-alerts/hash";

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
  async ({ step, runId }) => {
    const config = await step.run("load-config", async () => {
      const [windowDaysRow, liveStageIdRow, tiers] = await Promise.all([
        db.select().from(appSettings).where(eq(appSettings.key, "underperformance_window_days")),
        db.select().from(appSettings).where(eq(appSettings.key, "pipeline_stage_id_live")),
        getOutletTierThresholds(),
      ]);
      return {
        windowDays: Number(windowDaysRow[0]?.value ?? 30),
        liveStageId: liveStageIdRow[0]?.value!,
        tiers,
      };
    });

    const classifications = await step.run("classify-kiosks", async () => {
      // Per-kiosk SQL — DOES NOT call getOutletTiers() (that's per-location).
      // GROUP BY kiosks.id, percentile-rank kiosks against each other,
      // classifyOutletTier(percentile, config.tiers) per row.
      // Eligibility: archived_at IS NULL, outlet_code IS NOT NULL,
      // alert_silenced_at IS NULL, pipeline_stage_id = config.liveStageId.
      // Returns Array<{ kioskId, locationId, internalPocId, tier, revenue, percentile }>.
      // ...detailed SQL in plan
    });

    const decisions = await step.run("diff-state", async () => {
      // Read prior state, apply decideAlert(prior, new, lastAlertedAt) per row.
      // Returns Array<{ kioskId, decision: 'flip-in' | 'chronic' | 'no-alert', ... }>.
    });

    const runIsoWeek = toIsoWeek(new Date());

    await step.run("write-state", async () => {
      // UPSERT kiosk_performance_alert_state (one row per kiosk)
      // SET tier = ..., classified_at = NOW(), last_run_at = NOW(),
      //     last_alerted_at = (decision IN ('flip-in','chronic') ? NOW() : last_alerted_at)
    });

    await step.run("emit-poc-emails", async () => {
      const toAlert = decisions.filter((d) => d.decision !== "no-alert");
      const pocs = groupByPoc(toAlert);
      const events = pocs
        .filter((p) => p.userId !== null)
        .map((p) => ({
          name: "email/send.requested" as const,
          data: {
            kind: "underperforming_poc" as const,
            to: p.email,
            subject: `Performance update — ${p.kiosks.length} kiosk${p.kiosks.length > 1 ? "s" : ""} need attention`,
            template: "poc-underperformance" as const,
            templateProps: {
              pocName: p.name,
              kiosks: p.kiosks.slice(0, 25),  // Pitfall 3 cap
              moreCount: Math.max(0, p.kiosks.length - 25),
              windowDays: config.windowDays,
              runIsoWeek,
            },
            payloadHash: sha256(`${p.userId}:${runIsoWeek}`),
          },
        }));
      await step.sendEvent("emit-poc-emails", events);
    });

    await step.run("emit-skip-rows", async () => {
      // For each kiosk with NULL POC: insert one email_log row
      // (kind='underperforming_poc', recipient='[skip:no-poc]',
      //  status='skipped', payload_hash=null) so /admin/performance-alerts
      // can count "kiosks skipped (NULL POC)" cleanly.
      // Note: 'skipped' is NOT in the email_log_status_check (sent|failed) — see "Schema additions"
    });

    await step.run("write-run-audit", async () => {
      // writeAuditLog({entityType:'performance_alert_run', action:'trigger', ...})
    });
  },
);
```

### Pure dispatch-decision function (unit-testable)

```typescript
// src/lib/performance-alerts/classify-dispatch.ts
// Pure function — no DB, no clock dependency in the input. Caller passes
// `now` so tests are deterministic.
type Tier = "top" | "mid" | "bottom";  // mapped from "Premium"|"Standard"|"Developing"|"Emerging"
                                       // — but per CONTEXT D-03 the cron only cares about bottom

export type Decision = "flip-in" | "chronic" | "no-alert";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function decideAlert(
  prior: { tier: Tier; lastAlertedAt: Date | null } | null,
  newTier: Tier,
  now: Date,
): Decision {
  if (newTier !== "bottom") return "no-alert";
  // is_flip_in: prior_tier ≠ bottom OR no prior state, AND new_tier = bottom
  if (!prior || prior.tier !== "bottom") return "flip-in";
  // is_chronic: prior_tier = bottom AND (last_alerted_at NULL OR now - last_alerted_at >= 30d)
  if (
    prior.lastAlertedAt === null ||
    now.getTime() - prior.lastAlertedAt.getTime() >= THIRTY_DAYS_MS
  ) {
    return "chronic";
  }
  return "no-alert";
}
```

### Email template scaffold (clone of `password-changed.tsx`)

```typescript
// src/emails/poc-underperformance.tsx
// [PATTERN: src/emails/password-changed.tsx]
// [VERIFIED: read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/emails/password-changed.tsx]
import { Heading, Section, Text, Link } from "@react-email/components";
import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";

export type KioskRow = {
  kioskId: string;        // human-facing
  locationName: string;
  region: string;
  revenue: number;        // total over window
  percentile: number;     // 0-100
  detailUrl: string;      // {BRAND.prodUrl}/kiosks/{uuid}
};

export function PocUnderperformanceEmail({
  pocName,
  kiosks,
  moreCount,
  windowDays,
  runIsoWeek,
}: {
  pocName: string;
  kiosks: KioskRow[];
  moreCount: number;
  windowDays: number;
  runIsoWeek: string;
}) {
  const portfolioUrl = `${BRAND.prodUrl}/analytics/portfolio`;
  return (
    <EmailLayout preheader={`${kiosks.length} kiosk${kiosks.length > 1 ? "s" : ""} in your portfolio need attention`}>
      <Heading as="h1" style={{ /* same shape as password-changed.tsx */ }}>
        Performance update
      </Heading>
      <Text style={{ /* ... */ }}>
        Hi {pocName}, the following kiosks in your portfolio fell into the
        bottom outlet tier over the last {windowDays} days. Tap any kiosk to
        review its detail page.
      </Text>
      {kiosks.map((k) => (
        <Section key={k.kioskId} style={{ /* tinted panel like password-changed.tsx */ }}>
          <Text>{k.locationName} ({k.region})</Text>
          <Link href={k.detailUrl}>{k.kioskId}</Link>
          <Text>£{k.revenue.toFixed(2)} · bottom {k.percentile.toFixed(0)}%</Text>
        </Section>
      ))}
      {moreCount > 0 && (
        <Text>+ {moreCount} more — view all at {portfolioUrl}</Text>
      )}
      <CTA href={portfolioUrl} label="Open portfolio analytics" />
    </EmailLayout>
  );
}
```

### `src/inngest/events.ts` extension (one-line)

```typescript
// src/inngest/events.ts (CURRENT — Phase 8)
// [VERIFIED: read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/inngest/events.ts]
export type EmailKind = "password_changed" | "digest_daily" | "kiosk_offline";
export type EmailTemplate = "password-changed";

// AFTER PHASE 9
export type EmailKind = "password_changed" | "digest_daily" | "kiosk_offline" | "underperforming_poc";
export type EmailTemplate = "password-changed" | "poc-underperformance";

// Phase 9 ALSO defines:
export type PerformanceAlertsRunRequested = {
  name: "performance-alerts/run.requested";
  data: { actorId: string; actorName: string };
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vercel.json` cron jobs | Inngest scheduled functions | v1.1 lock 2026-05-03 | No-edge-config-needed; observable in Inngest dashboard; per-run dedupe |
| Hand-rolled email retry table | Inngest function retries + `email_log` audit | v1.1 lock 2026-05-03 | DB stays audit-only; queue state owned by Inngest |
| Inline-HTML email | `@react-email/components` | Phase 8 (2026-05-09) | Type-safe templates; preview server (`npm run email:dev`); Outlook-renderer fixes already in `_layout.tsx` |
| Pipeline-stage name match (`name='Live'`) | UUID-pin via `appSettings` | This phase (D-09) | Survives admin renames; auditable change of "what counts as Live" |

**Deprecated/outdated:**
- The `getOutletTiers()` query in `src/lib/analytics/queries/portfolio.ts` is **per-location** with 4-tier classification — do NOT reuse it for this phase's per-kiosk bottom-tier alert. Build a sibling per-kiosk query.
- Inngest 4.2.6 mentioned in REQUIREMENTS.md table is now 4.3.0 in `package.json` — the cron+TZ surface used here is identical between versions.

## Project Constraints (from CLAUDE.md)

> Extracted from `~/.claude/CLAUDE.md`, `./CLAUDE.md`, and auto-memory.

| Directive | Source | Enforcement |
|-----------|--------|-------------|
| Phase branching: `gsd/phase-09-poc-underperformance-alerts` | `~/.claude/CLAUDE.md` § GSD Workflow | Verified by gsd-orchestrator |
| Summary commit per plan + phase-completion commit before merge | `~/.claude/CLAUDE.md` § GSD Workflow | Verified by gsd-orchestrator |
| WeKnow brand tokens: Azure `#00A6D3`, Graphite `#121212`, Circular Pro fallback | `~/.claude/weknow-brand-guidelines.md` | Already in `src/emails/brand.ts` — reuse |
| `BETTER_AUTH_URL` (and any origin-pinned secret) MUST use git-branch alias on Vercel preview | `./CLAUDE.md` § Vercel preview env vars | Existing rule from Phase 8; no new env vars this phase |
| Playwright specs MUST run against the preview deploy, not just `--list` | `./CLAUDE.md` § Playwright specs | Admin "Run now" + silencing UI must be exercised against preview alias before merge |
| `npm ci` lockfile drift recipe (linux/amd64 Docker) when adding deps | `./CLAUDE.md` § npm lockfile | **NOT TRIGGERED** — this phase adds no new deps |
| No manual SQL for ops cleanup — recurring destructive ops must be admin UI | auto-memory `no_manual_sql_for_ops.md` | Admin silencing UI + admin "Run now" honour this |
| `data_model_locations_kiosks.md` — outlet_code is per-kiosk; same-name locations collapse | auto-memory | Cron classifies per-kiosk (D-05); does NOT aggregate by location |
| `email_provider_decision.md` — Resend primary, Brevo documented fallback | auto-memory | Reuses Phase 8 substrate; no provider decisions in this phase |
| `subagent-driven-development` default, `superpowers` + `karpathy-guidelines` active | auto-memory | Plan execution preference, doesn't constrain research |
| Lockfile correctness is host-dependent — generate on Linux x64 if any dep added | `./CLAUDE.md` | N/A this phase |

## Runtime State Inventory

> This phase adds new state. It does NOT rename or migrate existing state. Most categories are "None".

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — phase only adds new tables, does not migrate existing rows | None |
| Live service config | **Inngest:** new function `weekly-poc-alerts` registered via `serve({ functions: [...] })` in `src/app/api/inngest/route.ts`. Inngest auto-syncs the cron schedule on next deploy — no manual API call. | Deploy = sync; verify in Inngest dashboard post-deploy |
| OS-registered state | None — Inngest schedule is service-side, not host-side | None |
| Secrets/env vars | No new env vars. Reuses existing `RESEND_API_KEY`, `EMAIL_FROM`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` from Phase 8. | None — verify the 4 vars are set on the preview branch alias before UAT |
| Build artifacts | None — no compiled binary or generated package | None |

**Nothing found in category:** Stored data, OS-registered state, secrets, build artifacts — verified via grep + auto-memory + CLAUDE.md review.

## Environment Availability

> Skip-able if all dependencies are in-tree. We use external services (Inngest, Resend) — surface them.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Inngest cloud | Cron schedule firing | ✓ (existing Phase 8 wiring) | 4.3.0 SDK | Inngest dev server for local; Inngest dashboard for prod observability |
| Resend | Email delivery | ✓ (existing Phase 8 wiring) | 6.12.3 SDK | None — Brevo is documented-only per `email_provider_decision.md` |
| PostgreSQL 16 | DB schema + cron query | ✓ (Vercel/Neon prod, Testcontainers in tests) | 16 | None — DB is hard dep |
| `@react-email/components` | Email template render | ✓ (Phase 8 install) | ~1.0.12 | None — react-email is the locked template substrate |
| Inngest dev server (local) | Local cron testing | Manual install: `npx inngest-cli@latest dev` | latest | Mock with the `_handleSendEmail`-style step shim from Phase 8 tests for unit-level coverage |
| Playwright + Chromium | Admin page UAT | ✓ (existing repo `playwright.config.ts`) | (Phase 8) | Manual UAT (operator click) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Inngest dev server is per-machine; reset by reinstall. Tests use the step shim pattern from `tests/email/send-email-fn.integration.test.ts` so the real Inngest dev server is not required for CI green.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (two projects: `unit` + `integration`) + Playwright 1.x |
| Config files | `vitest.config.ts` (root), `playwright.config.ts` (root) |
| Quick run command | `npx vitest run --project unit src/lib/performance-alerts/` |
| Full unit suite | `npx vitest run --project unit` |
| Integration suite | `npx vitest run --project integration` |
| Playwright preview | `PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/admin/performance-alerts/` |

[VERIFIED: read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/vitest.config.ts and playwright.config.ts]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POC-ALERT-01 (a) | Eligibility filter: only `Live` + `outlet_code IS NOT NULL` + `archived_at IS NULL` + `alert_silenced_at IS NULL` kiosks classify | integration | `npx vitest run --project integration tests/performance-alerts/eligibility.integration.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (b) | `decideAlert(prior, new, now)` flip-in / chronic / no-alert pure logic | unit | `npx vitest run --project unit src/lib/performance-alerts/classify-dispatch.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (c) | Per-POC batching: N kiosks owned by same POC → 1 email; M kiosks across N POCs → N emails | unit | `npx vitest run --project unit src/lib/performance-alerts/poc-batching.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (d) | NULL POC → silent skip + email_log row with skip status | integration | `npx vitest run --project integration tests/performance-alerts/null-poc-skip.integration.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (e) | Idempotency: re-run within same ISO week → no duplicate emails (rides existing `email_log` partial unique idx) | integration | `npx vitest run --project integration tests/performance-alerts/idempotency.integration.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (f) | ISO week boundary: 2026-12-28 Mon, 2027-01-03 Sun, 2027-01-04 Mon | unit | `npx vitest run --project unit src/lib/performance-alerts/iso-week.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (g) | Email template renders to non-empty HTML + plain-text equivalent has all kiosk rows | unit | `npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (h) | Admin "Run now" button server action — admin-only, posts inngest event, writes audit | integration | `npx vitest run --project integration tests/admin/performance-alerts.integration.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (i) | Admin per-kiosk silence toggle — admin-only, mutates kiosks.alert_silenced_at + reason, writes audit | integration | `npx vitest run --project integration tests/kiosks/silence-toggle.integration.test.ts` | ❌ Wave 0 |
| POC-ALERT-01 (j) | E2E: admin signs in → /admin/performance-alerts → "Run now" → flash message + audit row visible | e2e | `PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/admin/performance-alerts.spec.ts` | ❌ Wave 0 |
| POC-ALERT-01 (k) | E2E: admin signs in → /kiosks/[id] → silence kiosk with reason → reload → silenced state visible | e2e | `PLAYWRIGHT_BASE_URL=<preview-alias> npx playwright test tests/kiosks/silence.spec.ts` | ❌ Wave 0 |
| POC-ALERT-01 (l) | Manual UAT: real cron fires on Mondays 09:00 London (operator-driven; check Inngest dashboard) | manual-only | (operator runbook in `*-SUMMARY.md`) | N/A |

### Sampling Rate

- **Per task commit:** `npx vitest run --project unit src/lib/performance-alerts/ src/emails/__tests__/poc-underperformance.test.ts`
- **Per wave merge:** `npx vitest run --project unit && npx vitest run --project integration tests/performance-alerts/ tests/admin/performance-alerts.integration.test.ts tests/kiosks/silence-toggle.integration.test.ts`
- **Phase gate:** Full unit + integration suite green + Playwright admin specs green against preview alias before `/gsd-verify-work`

### Synthetic test fixtures (seed in beforeEach)

The integration tests need a deterministic kiosk fleet. Seed via `setupTestDb()` then insert:

| Kiosk | Pipeline stage | outlet_code | archived | silenced | POC | Sales | Expected tier | Expected decision |
|-------|---------------|-------------|----------|----------|-----|-------|---------------|-------------------|
| K1 | Live UUID | "K001" | null | null | user_alpha | £100 (low) | bottom | flip-in (no prior) |
| K2 | Live UUID | "K002" | null | null | user_alpha | £200 (low) | bottom | flip-in (no prior) — batches with K1 |
| K3 | Live UUID | "K003" | null | null | user_beta | £150 (low) | bottom | flip-in (no prior) — separate email |
| K4 | Live UUID | "K004" | null | null | null | £100 (low) | bottom | skip-no-poc (email_log row, no email) |
| K5 | Live UUID | "K005" | null | NOW() | user_alpha | £100 | EXCLUDED | excluded (silenced) |
| K6 | Live UUID | null (not coded) | null | null | user_alpha | £100 | EXCLUDED | excluded (NULL outlet_code) |
| K7 | Prospect UUID | "K007" | null | null | user_alpha | £100 | EXCLUDED | excluded (not Live) |
| K8 | Live UUID | "K008" | NOW() | null | user_alpha | £100 | EXCLUDED | excluded (archived) |
| K9 | Live UUID | "K009" | null | null | user_alpha | £999 (high) | top | no-alert |
| K10 | Live UUID | "K010" | null | null | user_alpha | £200 | bottom prior | chronic if last_alerted_at ≥30d ago, else no-alert |

After `weeklyPocAlertsFn` runs:
- `email_log` has 2 sent rows (user_alpha receives K1+K2+K10-batched, user_beta receives K3) + 1 skip row (K4) = 3 rows.
- Re-running within same ISO week: 0 new sent rows (idempotency).
- `kiosk_performance_alert_state` has rows for K1, K2, K3, K4, K9, K10 (NOT K5/K6/K7/K8 — excluded entirely per Pitfall 4 recommendation).

### Wave 0 Gaps

- [ ] `tests/performance-alerts/eligibility.integration.test.ts` — covers POC-ALERT-01 (a)
- [ ] `tests/performance-alerts/null-poc-skip.integration.test.ts` — covers POC-ALERT-01 (d)
- [ ] `tests/performance-alerts/idempotency.integration.test.ts` — covers POC-ALERT-01 (e); SUPERSEDES the placeholder test in `tests/email/send-email-fn.integration.test.ts` lines 119-158 (the comment there explicitly invites Phase 9 to swap it to `template: "poc-underperformance"`)
- [ ] `src/lib/performance-alerts/classify-dispatch.test.ts` — covers POC-ALERT-01 (b)
- [ ] `src/lib/performance-alerts/poc-batching.test.ts` — covers POC-ALERT-01 (c)
- [ ] `src/lib/performance-alerts/iso-week.test.ts` — covers POC-ALERT-01 (f)
- [ ] `src/emails/__tests__/poc-underperformance.test.ts` — covers POC-ALERT-01 (g); pattern: clone `src/emails/__tests__/helpers/render-snapshot.ts` usage
- [ ] `tests/admin/performance-alerts.integration.test.ts` — covers POC-ALERT-01 (h)
- [ ] `tests/kiosks/silence-toggle.integration.test.ts` — covers POC-ALERT-01 (i)
- [ ] `tests/admin/performance-alerts.spec.ts` (Playwright) — covers POC-ALERT-01 (j)
- [ ] `tests/kiosks/silence.spec.ts` (Playwright) — covers POC-ALERT-01 (k)

No new framework install required — Vitest + Playwright are already in `package.json` and used by Phase 8.

## Security Domain

`security_enforcement` not explicitly disabled in `.planning/config.json` → enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (admin pages) | Better Auth session via `requireRole("admin")` from `src/lib/rbac.ts` |
| V3 Session Management | yes | Reuses Better Auth's existing session store; no new session surface |
| V4 Access Control | yes | `requireRole("admin")` on all 3 write surfaces (Run now, silence, admin page); the alert email itself reaches every POC regardless of their RBAC tier — operational, not preference |
| V5 Input Validation | yes | Zod schema for the silence-reason field (free-text, length-capped); Zod schema for the `appSettings.underperformance_window_days` save action (positive int, ≤365) |
| V6 Cryptography | yes | `sha256(poc_user_id + ':' + run_iso_week)` via Node `crypto.createHash('sha256')`. **No hand-rolled hashing.** |
| V7 Error Handling | yes | Inngest captures function errors → dashboard; do not echo error details to email recipients |
| V8 Data Protection | yes | Email body contains kiosk-level performance data; only sent to `kiosks.internal_poc_id`; no PII beyond user.name + user.email |

### Known Threat Patterns for {Inngest cron + Resend email + Drizzle/Postgres}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replayed `performance-alerts/run.requested` event | Tampering / DoS | Inngest event `id` idempotency (24h dedupe) + function-level `concurrency: { limit: 1 }` |
| Operator double-clicks "Run now" → 2 emails | Repudiation | Same as above + per-POC `payloadHash` riding `email_log` partial unique idx |
| Open redirect in email kiosk-detail link | Tampering | Hard-code `BRAND.prodUrl` prefix; never accept user-supplied URL fragments in templateProps |
| Email phishing via spoofed `EMAIL_FROM` | Spoofing | Phase 8 already pins `noreply@command.weknowgroup.com` + DMARC `p=quarantine` |
| Privilege escalation via silence-action | Elevation | `requireRole("admin")` server-side; never trust client-side admin flag |
| Sensitive data in email body | Information Disclosure | Email contains kiosk_id, location name, region, sales total, percentile — all data the POC already sees in /analytics/portfolio. No banking details, no contracts, no employee data. |
| Tampered cron schedule | Tampering | Cron string is hard-coded in source; admin cannot edit schedule via UI; change requires PR |
| SQL injection via silence reason | Tampering | Drizzle parameterised queries enforce this; Zod validates reason before insert |
| Malicious kiosk_id in URL → spoofed silencing | Tampering | `requireRole("admin")` + verify kiosk exists + write audit row |

## Sources

### Primary (HIGH confidence)
- Context7 `/inngest/website` — fetched via `npx ctx7@latest docs` for: scheduled functions cron timezone TZ, multi-trigger functions, idempotency keys, concurrency, rate-limit
- `src/inngest/functions/send-email.ts` — Phase 8 reference implementation [VERIFIED: read at /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/inngest/functions/send-email.ts]
- `src/inngest/events.ts` — wire-shape contracts to extend [VERIFIED: read]
- `src/emails/password-changed.tsx` + `_layout.tsx` + `brand.ts` + `text-versions.ts` — clone target [VERIFIED: all read]
- `src/lib/analytics/{thresholds-server.ts, metrics.ts, queries/portfolio.ts, types.ts}` — tier classification [VERIFIED: read]
- `src/db/schema.ts` lines 27-44 (user), 99-103 (appSettings), 106-114 (pipelineStages), 117-144 (kiosks), 275-295 (kioskAssignments), 298-314 (auditLogs), 1107-1134 (emailLog) [VERIFIED: read]
- `src/db/seed-pipeline-stages.ts` — confirms `Live` seeded at `position=7000` [VERIFIED: read]
- `migrations/0041_phase_08_email_log.sql` + `0042_phase_08_email_log_status_check.sql` — partial unique idx + status CHECK [VERIFIED: read]
- `src/app/api/inngest/route.ts` — `serve({ functions: [...] })` mount [VERIFIED: read]
- `src/lib/rbac.ts` — `requireRole("admin")` pattern [VERIFIED: read]
- `src/lib/audit.ts` — `writeAuditLog` + entityType/action unions [VERIFIED: read]
- `src/app/(app)/admin/cache/{page.tsx, cache-purge-panel.tsx, actions.ts}` — admin-page + server-action precedent [VERIFIED: read]
- `src/app/api/account/password-changed/route.ts` — `inngest.send({ name: "email/send.requested", ... })` precedent [VERIFIED: read]
- `tests/email/send-email-fn.integration.test.ts` — explicit Phase 9 hand-off comment lines 119-127 [VERIFIED: read]
- `tests/helpers/test-db.ts` — Testcontainers Postgres pattern [VERIFIED: read]
- `vitest.config.ts` + `playwright.config.ts` — test substrate [VERIFIED: read]
- `package.json` — installed deps + scripts [VERIFIED: read]
- Installed `node_modules/inngest/types.d.ts` lines 1180-1200 — confirms `triggers: [{ cron, jitter? }]` Zod schema [VERIFIED: read]

### Secondary (MEDIUM confidence)
- WeKnow brand guidelines path `~/.claude/weknow-brand-guidelines.md` — referenced in CLAUDE.md but not directly read this session; tokens are mirrored verbatim in `src/emails/brand.ts` [CITED]

### Tertiary (LOW confidence)
- Resend 50-recipient/100KB body soft caps (Pitfall 3) — knowledge from training; **not verified** against Resend docs in this session. Risk if wrong: the truncation cap of 25 might be unnecessarily defensive. Mitigation: the cap is a UX call regardless — a POC scrolling 80 kiosks in an email is bad regardless of Resend's API limits.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POC-ALERT-01 | Weekly bottom-tier POC email alert. Inngest cron classifies `Live` kiosks via existing percentile cutoffs over admin-tunable trailing window; per-POC batched emails for flip-in + monthly cadence; admin per-kiosk silencing + read-only `/admin/performance-alerts` page with manual "Run now" trigger. Depends on EMAIL-04. | All sections — particularly Patterns 1-5 (cron + multi-trigger + step boundaries + manual trigger + fan-out), the Synthetic test fixtures table (eligibility + dispatch correctness + idempotency), and Pitfalls 1+4+5+8 (boundary semantics + silenced-mid-run + race + first-run); Schema additions cover the persistence layer; Pure dispatch-decision function isolates the testable logic. |

## Assumptions Log

> All claims tagged `[ASSUMED]` in this research that require user / planner confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resend has soft 50-recipient / 100KB body caps | Pitfall 3 | If caps are higher, the 25-kiosk truncation is unnecessary; if lower, we need a smaller cap. UX rationale stands either way. |
| A2 | Quiet first run (Pitfall 8 option a) is preferred over loud first run | Pitfall 8 | If operators want loud first run, swap to option (b); ~15min change in the cron handler. Documented as planner discretion in CONTEXT D-23 last bullet. |
| A3 | "Bottom" maps to `classifyOutletTier(percentile, config) === "Emerging"` | Architecture (Anti-Patterns) | This is a **deduction** from `classifyOutletTier` source: `if (percentile < bottom) return "Emerging"`. CONTEXT D-03 says "tier='bottom'" but `classifyOutletTier` never returns the string `"bottom"` — it returns `"Emerging"`. Planner must lock the mapping in PLAN.md and either rename in code or document the translation table. |
| A4 | The 25-kiosk truncation cap (Pitfall 3) is acceptable to operators | Pitfall 3 | Operator may want fewer/more; trivially configurable via a constant; no deep impact. |
| A5 | `last_alerted_at >= 30d` chronic threshold is the literal rule (not 4 weeks ISO) | Pattern (decideAlert) | CONTEXT D-10 says "≥30 days"; the 30-day-ms math in the code matches; if planner wants ISO-week alignment instead, swap to `runIsoWeek - lastAlertedIsoWeek >= 4`. |
| A6 | The audit-log entityType/action unions in `src/lib/audit.ts` will accept new values via simple TypeScript edit (the underlying DB column is free-form text) | Pattern 4 | [VERIFIED at src/db/schema.ts:298-314 — column is `text("entity_type")` no CHECK constraint; the union is purely TypeScript]. So this is verified, not assumed. Mark this entry as resolved. |
| A7 | First-ever cron run produces no `kiosk_performance_alert_state` rows pre-run, so prior-state lookup returns NULL for every kiosk | Pitfall 8 | This is true by construction (new table). Verified. |

**Resolution path:** A1, A2, A4, A5 land in CONTEXT.md / PLAN.md as planner picks. A3 MUST be locked in PLAN.md (the bottom/Emerging mapping is non-obvious and a downstream reader will be confused without the explicit table).

## Open Questions (RESOLVED)

1. **Which name does the cron use for the bottom tier in code: `"bottom"` (D-03 wording) or `"Emerging"` (return value of `classifyOutletTier`)?**
   - **RESOLVED:** Store `"Emerging"`/`"Developing"`/`"Standard"`/`"Premium"` in `kiosk_performance_alert_state.tier` to avoid a translation layer; cron's dispatch decision filters `tier === "Emerging"` for "bottom-tier alert". Use `text + CHECK constraint` (not Postgres `enum`) so adding a tier later doesn't require migration. Document the wording mismatch in a header comment on the schema definition. **Encoded in:** Plan 09-01 (schema CHECK constraint), Plan 09-02 (decideAlert pure logic), Plan 09-03 (cron dispatch).
   - Background: `classifyOutletTier` returns `"Premium" | "Standard" | "Developing" | "Emerging"` per `src/lib/analytics/types.ts:146`. CONTEXT D-03 uses words `top|mid|bottom`. The seven `appSettings` rows are `threshold_outlet_tier_top|mid|bottom`.

2. **Where exactly does the silencing UI go on the kiosk detail page?**
   - **RESOLVED:** New `<KioskAdminPanel>` component rendered conditionally below `<KioskDetailForm>` when `requireRole("admin")` succeeds in the page-level RSC. Keeps existing form prop surface stable and isolates the admin write path. **Encoded in:** Plan 09-06 (`src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx`).
   - Background: `src/app/(app)/kiosks/[id]/page.tsx` renders `<KioskDetailForm>` with kiosk + pipelineStages + locations props (~75 LOC). D-20 says "exact placement is planner's discretion".

3. **Should the admin page recompute "kiosks classified" / "alerted" / "skipped" counts from `kiosk_performance_alert_state` + `email_log`, or should it read a small per-run summary row?**
   - **RESOLVED:** On-the-fly query with a 60-second `unstable_cache` keyed by `last_run_at`. ~1000 rows aggregated by `tier` + `last_alerted_at = last_run_at` is a single grouped query expected to finish in <50ms on prod-shape data. No per-run summary table introduced. **Encoded in:** Plan 09-05 (`/admin/performance-alerts/page.tsx`).
   - Background: D-23 last-bullet says "default to on-the-fly; introduce a runs table only if the admin page query becomes slow".

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep version verified against installed `package.json`; cron+TZ syntax verified against Context7 + installed Inngest SDK types
- Architecture: HIGH — every reused file read end-to-end; the per-kiosk-vs-per-location distinction surfaced and explicitly addressed
- Pitfalls: HIGH on 1, 2, 4, 5, 6, 7, 9 (verified via codebase grep + installed types + Context7); MEDIUM on 3 (Resend caps from training); HIGH on 8 (deduction from new-table state)
- Validation Architecture: HIGH — vitest + playwright configs read; Phase 8 test patterns directly portable
- Security: HIGH on V2/V4/V6/V8 controls (existing patterns); MEDIUM on V5 (Zod schemas need authoring)

**Research date:** 2026-05-09
**Valid until:** 2026-06-08 (30 days; Inngest v4 + Resend v6 + Phase 8 substrate are stable)
