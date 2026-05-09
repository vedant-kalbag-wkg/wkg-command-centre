---
phase: 09-poc-underperformance-alerts
plan: 05
type: execute
wave: 4
depends_on: [03]
files_modified:
  - src/app/(app)/admin/performance-alerts/page.tsx
  - src/app/(app)/admin/performance-alerts/run-now-button.tsx
  - src/app/(app)/admin/performance-alerts/actions.ts
  - tests/admin/performance-alerts.integration.test.ts
  - tests/admin/performance-alerts.spec.ts
autonomous: false
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "GET /admin/performance-alerts renders for admin sessions, returns 403/redirect for non-admins"
    - "Page surfaces last-run metadata: timestamp, kiosks classified, kiosks alerted, kiosks skipped (NULL POC), kiosks silenced — read from kiosk_performance_alert_state + email_log + kiosks"
    - "'Run now' button calls a server action that emits performance-alerts/run.requested with an idempotency key bucketed per minute per actor"
    - "Server action writes audit_logs entry with entity_type='performance_alert_run', action='trigger'"
    - "5-minute soft rate-limit gate prevents double-runs (server-side check on most recent audit_logs row)"
  artifacts:
    - path: "src/app/(app)/admin/performance-alerts/page.tsx"
      provides: "RSC admin metadata page"
      contains: "requireRole(\"admin\")"
    - path: "src/app/(app)/admin/performance-alerts/run-now-button.tsx"
      provides: "Client component — Run now button + last-run-metadata cards"
    - path: "src/app/(app)/admin/performance-alerts/actions.ts"
      provides: "triggerRunNow() server action — admin-RBAC + idempotency-keyed inngest.send + audit"
      exports: ["triggerRunNow"]
  key_links:
    - from: "Run now button onClick"
      to: "triggerRunNow() server action"
      via: "useTransition + sonner toast"
    - from: "triggerRunNow"
      to: "weeklyPocAlertsFn (plan 09-03)"
      via: "inngest.send({ name: 'performance-alerts/run.requested', id: bucketed-id })"
---

<objective>
Build the admin observability + manual-trigger surface for the cron.
A read-only metadata page at `/admin/performance-alerts` that surfaces
the last run's classification + alert counts, a "Run now" button that
emits the same Inngest event the cron consumes (so the cron path is
exercised manually identically), and an integration + Playwright spec
that prove the RBAC + audit + flash-toast behaviour end-to-end.

The plan clones the `src/app/(app)/admin/cache/` triple
(`page.tsx` + `cache-purge-panel.tsx` + `actions.ts`) — PATTERNS marks
these as **exact** analogs for shape, RBAC pattern, audit shape, and
Playwright spec.

Purpose: The cron alone is invisible to operators after it deploys.
This page provides the "is it running?" answer at-a-glance and the
"trigger it now" lever for when the operator needs to push an
alert immediately (e.g. after a threshold change).

Output:
- 3 source files in `src/app/(app)/admin/performance-alerts/`
- 1 integration test (RBAC + server-action behaviour)
- 1 Playwright spec (E2E against preview alias)
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
@.planning/phases/09-poc-underperformance-alerts/09-03-SUMMARY.md

@src/app/(app)/admin/cache/page.tsx
@src/app/(app)/admin/cache/cache-purge-panel.tsx
@src/app/(app)/admin/cache/actions.ts
@src/lib/rbac.ts
@src/lib/audit.ts
@src/inngest/client.ts
@src/db/schema.ts
@tests/admin/cache-purge.spec.ts

<interfaces>
RBAC pattern (src/lib/rbac.ts):
```typescript
export async function requireRole(...roles: Role[]): Promise<Session>;
// Throws "Forbidden" if user's role not in roles[]; returns session if pass.
```

Audit pattern (src/lib/audit.ts — extended in plan 09-03):
```typescript
await writeAuditLog({
  actorId: session.user.id,
  actorName: session.user.name,
  entityType: "performance_alert_run",  // added in 09-03
  entityId: runId | "manual",
  entityName: "Performance Alert Run",
  action: "trigger",                     // added in 09-03
});
```

Inngest event (defined in plan 09-03):
```typescript
{ name: "performance-alerts/run.requested", data: { actorId, actorName } }
```

Schema reads (added in plan 09-01):
- `kiosk_performance_alert_state` — counts grouped by `tier` for the latest `last_run_at`.
- `email_log` filtered to `kind='underperforming_poc'` for sent / skipped counts.
- `kiosks` filtered to `alert_silenced_at IS NOT NULL` for silenced count.
- `audit_logs` filtered to `entity_type='performance_alert_run'` ORDER BY `created_at` DESC LIMIT 10 for the run history.
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser session -> /admin/performance-alerts (RSC) | Better Auth session cookie; admin role enforced via requireRole. |
| Client component -> server action triggerRunNow | Same auth boundary; RBAC re-validated server-side (do not trust client-side admin flag). |
| Server action -> Inngest event bus | Internal — Inngest validates events server-side via signing key. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-05-01 | Elevation | non-admin accessing the page | mitigate | `await requireRole("admin")` at the top of `page.tsx` (RSC). On role mismatch, the helper throws which Next.js converts to a 500 / redirects to / depending on existing pattern. Verify behaviour matches `/admin/cache`. |
| T-09-05-02 | Elevation | non-admin invoking triggerRunNow | mitigate | `await requireRole("admin")` at the top of the server action. The action is a Next.js server action — the boundary is enforced regardless of how the client invokes it. |
| T-09-05-03 | Tampering | CSRF on triggerRunNow | mitigate | Next.js server actions ride the React Action protocol — same-origin enforced by default; cookie-bound; no separate CSRF token needed (existing convention used by `purgeAnalyticsCache` in /admin/cache). |
| T-09-05-04 | DoS | admin spamming "Run now" | mitigate | (1) Inngest event idempotency: `inngest.send({ id: \`performance-alerts-manual-\${session.user.id}-\${minuteBucket}\`, ... })` collapses double-clicks within 60s for the same actor. (2) Function-level `concurrency: { limit: 1 }` on the cron (plan 09-03) — second event queues serially. (3) Server-side 5-min rate limit: SELECT most recent `audit_logs` row WHERE `entity_type='performance_alert_run'`; if `created_at >= NOW() - INTERVAL '5 min'`, return `{ error: 'Rate limited' }` without emitting. |
| T-09-05-05 | Repudiation | which admin pressed Run now | mitigate | `audit_logs` row carries `actor_id` + `actor_name` from `requireRole("admin")`'s returned session. Inngest dashboard also retains the event payload (`{ actorId, actorName }`). |
| T-09-05-06 | Information Disclosure | metadata page leaks data to lower-role users | mitigate | RBAC gate at page layer (T-09-05-01). The metadata itself is operational counts — not PII. |
| T-09-05-07 | Tampering | IDOR via path manipulation (`/admin/performance-alerts?actor=other_admin`) | accept | The page reads no path parameters besides RBAC. Server action takes no parameters. No IDOR surface. |

ASVS controls applied:
- V2.1.1 (Auth): Better Auth session via requireRole.
- V4.1.1 (Access Control): Admin-only at both RSC + server-action layers.
- V4.2.1 (Operation-level): Rate-limit gate prevents amplification.
- V11.1.1 (Business Logic): The 5-min gate is the documented business rule for run cadence.
- V14.5.2 (Configuration): Cron schedule is hardcoded in source — admin cannot edit cadence via UI (deliberate; CONTEXT D-12).
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Author admin page + run-now button + server action</name>
  <files>src/app/(app)/admin/performance-alerts/page.tsx, src/app/(app)/admin/performance-alerts/run-now-button.tsx, src/app/(app)/admin/performance-alerts/actions.ts</files>
  <read_first>
    - src/app/(app)/admin/cache/page.tsx (full file — your end-to-end clone target for the RSC).
    - src/app/(app)/admin/cache/cache-purge-panel.tsx (full file — clone target for the client component, including useTransition + sonner toast pattern).
    - src/app/(app)/admin/cache/actions.ts (full file — clone target for the server action, including RBAC + audit shape).
    - src/lib/rbac.ts (full file — confirm requireRole signature + behaviour on role mismatch).
    - src/lib/audit.ts (full file — confirm writeAuditLog signature; entityType + action unions are extended in plan 09-03).
    - src/inngest/client.ts — confirms `inngest.send` shape.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § three rows for performance-alerts/page.tsx, run-now-button.tsx, actions.ts (full pattern map).
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Pattern 4 (idempotency-keyed inngest.send) + Pitfall 5 (run-now race protection).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-21 + D-22 (page metadata fields + Run now button shape).
  </read_first>
  <behavior>
    - GET `/admin/performance-alerts`:
      - Non-authenticated → redirected to sign-in (existing behaviour for the (app) route group).
      - Authenticated non-admin → `Forbidden` error (matches /admin/cache behaviour).
      - Admin → renders the metadata page with: page title "Performance alerts", description copy, a "Latest run" card (last_run_at timestamp from kioskPerformanceAlertState's MAX, classified count, alerted count, skipped count, silenced count), a Run-now-button card, a "Recent runs" card listing the last 10 audit_logs entries with `entity_type='performance_alert_run'`.
    - "Run now" button:
      - Disabled while pending; shows "Queueing run…" copy.
      - Calls triggerRunNow() server action.
      - On success: toast.success("Run queued — refresh in ~30 seconds").
      - On rate-limit response: toast.error("Already queued — wait at least 5 minutes between runs").
      - On other error: toast.error(error.message).
    - triggerRunNow server action:
      - `await requireRole("admin")` first.
      - SELECT the most recent `audit_logs` WHERE `entity_type='performance_alert_run'` LIMIT 1; if `created_at >= NOW() - INTERVAL '5 min'`, return `{ error: 'Rate limited', minutesRemaining }`.
      - Otherwise: `inngest.send({ id: \`performance-alerts-manual-\${session.user.id}-\${minuteBucket}\`, name: "performance-alerts/run.requested", data: { actorId: session.user.id, actorName: session.user.name ?? "unknown admin" } })`.
      - `await writeAuditLog({ ..., entityType: "performance_alert_run", entityId: \`manual-\${Date.now()}\`, entityName: "Manual run trigger", action: "trigger" })`.
      - Return `{ ok: true }`.
      - The audit row is what the 5-min rate-limit reads on subsequent calls — so the gate works.
  </behavior>
  <action>
    1. Create the directory: `src/app/(app)/admin/performance-alerts/`.

    2. Create `actions.ts`:
       ```typescript
       "use server";
       import { sql, desc, eq } from "drizzle-orm";
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
       ```

    3. Create `run-now-button.tsx` (client component clone of cache-purge-panel.tsx):
       ```typescript
       "use client";
       import { useTransition } from "react";
       import { Button } from "@/components/ui/button";
       import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
       import { toast } from "sonner";
       import { triggerRunNow } from "./actions";

       export function RunNowButton() {
         const [pending, startTransition] = useTransition();

         const handleRun = () => {
           startTransition(async () => {
             try {
               const result = await triggerRunNow();
               if (result.ok) {
                 toast.success("Run queued — refresh in ~30 seconds");
               } else if (result.error === "Rate limited") {
                 toast.error(
                   `Already queued — wait ~${result.minutesRemaining ?? 5} more minutes`,
                 );
               } else {
                 toast.error(result.error);
               }
             } catch (err) {
               toast.error(err instanceof Error ? err.message : "Trigger failed");
             }
           });
         };

         return (
           <Card>
             <CardHeader>
               <CardTitle>Run now</CardTitle>
             </CardHeader>
             <CardContent className="flex flex-col gap-3">
               <p className="text-sm text-muted-foreground">
                 Manually fire the weekly POC alert now. Use sparingly — the cron fires
                 automatically Mondays 09:00 (Europe/London).
               </p>
               <Button onClick={handleRun} disabled={pending} className="max-w-xs">
                 {pending ? "Queueing run…" : "Run now"}
               </Button>
             </CardContent>
           </Card>
         );
       }
       ```

    4. Create `page.tsx` (RSC clone of cache/page.tsx):
       ```typescript
       import { sql, eq, desc, isNotNull, and } from "drizzle-orm";
       import { requireRole } from "@/lib/rbac";
       import { db } from "@/db";
       import {
         auditLogs,
         emailLog,
         kioskPerformanceAlertState,
         kiosks,
       } from "@/db/schema";
       import { PageHeader } from "@/components/layout/page-header";
       import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
       import { RunNowButton } from "./run-now-button";

       export default async function AdminPerformanceAlertsPage() {
         await requireRole("admin");

         // Latest run timestamp = MAX(last_run_at) from state table.
         // (If the table is empty, latestRunAt is null — render "No runs yet".)
         const [latestRow] = await db
           .select({ ts: sql<Date | null>`MAX(${kioskPerformanceAlertState.lastRunAt})` })
           .from(kioskPerformanceAlertState);
         const latestRunAt = latestRow?.ts ?? null;

         // Counts grouped by tier (for the latest run — tier reflects most-recent classification).
         const tierCountsRows = await db
           .select({
             tier: kioskPerformanceAlertState.tier,
             count: sql<number>`COUNT(*)::int`,
           })
           .from(kioskPerformanceAlertState)
           .groupBy(kioskPerformanceAlertState.tier);
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

         // Silenced count.
         const [silencedRow] = await db
           .select({ count: sql<number>`COUNT(*)::int` })
           .from(kiosks)
           .where(isNotNull(kiosks.alertSilencedAt));
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
               <Card>
                 <CardHeader><CardTitle>Latest run</CardTitle></CardHeader>
                 <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                   <Stat label="Last run" value={latestRunAt ? latestRunAt.toLocaleString("en-GB") : "—"} />
                   <Stat label="Classified" value={String(classifiedCount)} />
                   <Stat label="Bottom tier" value={String(bottomCount)} />
                   <Stat label="Emails sent (24h)" value={String(sentCount)} />
                   <Stat label="Skipped — no POC (24h)" value={String(skippedCount)} />
                   <Stat label="Silenced kiosks" value={String(silencedCount)} />
                 </CardContent>
               </Card>

               <RunNowButton />

               <Card>
                 <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
                 <CardContent>
                   {recentRuns.length === 0 ? (
                     <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
                   ) : (
                     <ul className="space-y-2 text-sm">
                       {recentRuns.map((r) => (
                         <li key={r.id} className="flex justify-between gap-2">
                           <span>{r.entityName} — {r.actorName}</span>
                           <span className="text-muted-foreground">{r.createdAt.toLocaleString("en-GB")}</span>
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
             <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
             <span className="text-base font-semibold">{value}</span>
           </div>
         );
       }
       ```

    5. Verify the import paths for `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Button`, `PageHeader` against the existing /admin/cache files (the components/ paths in this codebase). Adjust imports to match.

    6. Verify TS compiles clean.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "performance-alerts" || echo OK</automated>
  </verify>
  <done>
    - All three files exist.
    - page.tsx calls requireRole("admin") at the top.
    - actions.ts calls requireRole("admin") at the top + 5-min rate limit + idempotency-keyed inngest.send + writeAuditLog.
    - run-now-button.tsx is a client component using useTransition + sonner toast.
    - npx tsc --noEmit clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Integration test — admin RBAC + server action behaviour</name>
  <files>tests/admin/performance-alerts.integration.test.ts</files>
  <read_first>
    - tests/email/send-email-fn.integration.test.ts (Testcontainers + dbRef mock pattern).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § Testcontainers integration-test scaffold.
    - tests/admin/cache-purge.spec.ts (analog Playwright spec — useful for understanding the RBAC behaviour expectations).
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md row (h).
  </read_first>
  <behavior>
    Tests:
    - it("triggerRunNow throws Forbidden for non-admin sessions"): mock requireRole to throw "Forbidden"; assert the action rejects.
    - it("triggerRunNow emits inngest event + writes audit row for admin sessions"): mock requireRole returning admin session; mock inngest.send; call action; assert inngest.send called once with `{ name: 'performance-alerts/run.requested', id: matches /performance-alerts-manual-.+-\\d+/ }`; assert audit_logs has 1 row with entityType='performance_alert_run', action='trigger'.
    - it("triggerRunNow rate-limits a second call within 5 minutes"): seed an audit_logs row with entityType='performance_alert_run' and createdAt=NOW(); call action; assert returns { ok: false, error: 'Rate limited' }; assert inngest.send NOT called this time.
    - it("triggerRunNow proceeds when the most recent audit row is older than 5 minutes"): seed audit_logs row with createdAt=10 min ago; call action; assert returns { ok: true }; assert inngest.send called once.
  </behavior>
  <action>
    1. Create tests/admin/performance-alerts.integration.test.ts using the standard Testcontainers + vi.hoisted pattern from tests/email/send-email-fn.integration.test.ts.
    2. Mock `@/lib/rbac` so `requireRole` returns a deterministic admin session for the success cases (or throws "Forbidden" for the fail case).
    3. Mock `@/inngest/client` so `inngest.send` is captured (vi.fn()).
    4. Use the real test DB (Testcontainers) to verify the audit row + the rate-limit query work end-to-end.
    5. Run the tests.
  </action>
  <verify>
    <automated>npx vitest run --project integration tests/admin/performance-alerts.integration.test.ts</automated>
  </verify>
  <done>
    - Test file exists.
    - All 4 cases pass.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Playwright E2E spec against preview alias + manual UAT</name>
  <files>tests/admin/performance-alerts.spec.ts</files>
  <what-built>
    - Playwright E2E spec at tests/admin/performance-alerts.spec.ts that:
      - signs in as the admin (using the existing tests/helpers/auth.ts signInAsAdmin helper)
      - navigates to /admin/performance-alerts
      - asserts the page title "Performance alerts" is visible
      - asserts the "Run now" button is visible
      - clicks "Run now"
      - asserts the success toast appears (matches /Run queued/i)
      - reloads the page
      - asserts a recent runs entry now appears (matches the actor name)
    - Spec must clone the structure of tests/admin/cache-purge.spec.ts.
    - Per CLAUDE.md: the spec MUST run against the Vercel preview deploy (PLAYWRIGHT_BASE_URL=git-branch-alias) — `--list` is NOT sufficient evidence.
  </what-built>
  <how-to-verify>
    Operator-driven verification (Claude cannot run Playwright against a preview deploy autonomously):

    1. Ensure the branch is pushed and the preview deploy is up:
       ```bash
       git push -u origin gsd/phase-09-poc-underperformance-alerts
       vercel alias ls | grep phase-09
       ```
       Expect a `wkg-command-centre-git-gsd-phase-09-...vercel.app` alias.

    2. Confirm preview env vars are set on the git-branch alias (per CLAUDE.md). Required for this phase: `BETTER_AUTH_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `DATABASE_URL`. The latter four were set in Phase 8; only `BETTER_AUTH_URL` may need a fresh preview-alias value:
       ```bash
       echo "https://wkg-command-centre-git-gsd-phase-09-poc-underperformance-alerts-vedant-kalbag-wkgs-projects.vercel.app" | \
         vercel env add BETTER_AUTH_URL preview gsd/phase-09-poc-underperformance-alerts
       ```
       Then redeploy the branch.

    3. Apply the migration to the preview's database (whichever Neon branch the preview points at):
       ```bash
       DATABASE_URL=<preview-db-url> npx drizzle-kit push
       ```

    4. Run the spec against the preview alias:
       ```bash
       PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-phase-09-poc-underperformance-alerts-vedant-kalbag-wkgs-projects.vercel.app \
       TEST_ADMIN_EMAIL=<from .env.test> \
       TEST_ADMIN_PASSWORD=<from .env.test> \
         npx playwright test tests/admin/performance-alerts.spec.ts
       ```
       Expect: spec passes; no failed screenshot in test-results/.

    5. Manually open the preview alias `/admin/performance-alerts` in a browser, sign in as admin, and visually confirm:
       - Page renders without console errors
       - Latest-run card shows expected stats (initially "—" / "0" until the first cron or Run-now)
       - "Run now" button works → toast appears → recent-runs list updates after refresh
       - 2nd click within 5 minutes shows rate-limit toast

    6. Verify the Inngest dashboard (https://app.inngest.com) shows the `weekly-poc-alerts` function with next-run scheduled at the next Monday 09:00 London.
  </how-to-verify>
  <resume-signal>Type "approved" once the Playwright spec passes against the preview alias and the manual UAT checklist is green. Or describe any issues — the planner can revise the spec or the page implementation.</resume-signal>
</task>

</tasks>

<verification>
- `grep -q 'requireRole("admin")' src/app/(app)/admin/performance-alerts/page.tsx`
- `grep -q 'requireRole("admin")' src/app/(app)/admin/performance-alerts/actions.ts`
- `grep -q "performance-alerts/run.requested" src/app/(app)/admin/performance-alerts/actions.ts`
- `grep -q "writeAuditLog" src/app/(app)/admin/performance-alerts/actions.ts`
- `npx vitest run --project integration tests/admin/performance-alerts.integration.test.ts` exits 0
- (Operator) Playwright spec passes against preview alias
- (Operator) Inngest dashboard shows weekly-poc-alerts next-run at Monday 09:00 London
</verification>

<success_criteria>
1. /admin/performance-alerts renders for admins, blocks non-admins.
2. Run-now button emits the manual-trigger event, idempotency-keyed by user+minute.
3. 5-min server-side rate limit prevents accidental double-runs.
4. audit_logs row written for every successful trigger.
5. Recent runs list shows the last 10 triggers (cron + manual).
6. E2E flow verified against preview alias.
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-05-SUMMARY.md` with:
- Files created
- Integration test runtime + assertions covered
- Playwright spec result against preview alias (operator confirms)
- Manual UAT checklist sign-off
- Any deviations: rate-limit window adjustment, copy tweaks, etc.
</output>
