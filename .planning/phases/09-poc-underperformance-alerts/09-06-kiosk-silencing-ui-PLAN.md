---
phase: 09-poc-underperformance-alerts
plan: 06
type: execute
wave: 4
depends_on: [01, 03]
files_modified:
  - src/app/(app)/kiosks/[id]/page.tsx
  - src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx
  - src/app/(app)/kiosks/[id]/silence-actions.ts
  - src/lib/audit.ts
  - tests/kiosks/silence-toggle.integration.test.ts
  - tests/kiosks/silence.spec.ts
autonomous: false
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "Admin-only KioskAdminPanel renders below the existing form on /kiosks/[id] when session.role is 'admin'"
    - "Toggle + free-text reason field allow admin to set kiosks.alert_silenced_at and kiosks.alert_silenced_reason"
    - "silenceKiosk + unsilenceKiosk server actions enforce admin RBAC, validate inputs with zod, write audit_logs entry"
    - "Silenced kiosks are excluded from the cron's classify-kiosks SQL (already enforced by plan 09-03's WHERE alert_silenced_at IS NULL)"
    - "Audit row carries actor + entityType='kiosk' + action='silence_alerts' or 'unsilence_alerts' + the reason text in metadata jsonb"
  artifacts:
    - path: "src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx"
      provides: "Admin-RBAC-gated UI for silencing/unsilencing alerts on this kiosk"
    - path: "src/app/(app)/kiosks/[id]/silence-actions.ts"
      provides: "silenceKiosk(kioskId, reason) + unsilenceKiosk(kioskId) server actions"
      exports: ["silenceKiosk", "unsilenceKiosk"]
  key_links:
    - from: "KioskAdminPanel form submit"
      to: "silenceKiosk / unsilenceKiosk server actions"
      via: "useTransition + sonner toast"
    - from: "kiosks.alert_silenced_at"
      to: "weeklyPocAlertsFn classify-kiosks WHERE clause (plan 09-03)"
      via: "the cron filters out silenced kiosks per Pitfall 4 recommendation"
---

<objective>
Add the admin-only kiosk-level silencing UI. A new `<KioskAdminPanel>`
component is rendered conditionally on `/kiosks/[id]` when the session
role is admin (per CONTEXT D-19 + D-20 — the planner picks the
placement; PATTERNS + RESEARCH § Open Question Q2 recommend a new
panel below the existing form rather than inlining in the form). The
panel exposes: a toggle (silence on/off), a free-text reason field
(required when silencing; optional when unsilencing — but capture
"why unsilenced" if provided), and a submit button. Two server
actions handle the writes — `silenceKiosk` and `unsilenceKiosk` — both
admin-RBAC-gated and audit-logged.

The audit_logs `action` union (this plan EXTENDS at the TypeScript
layer only — `audit_logs.action` is plain `text` per RESEARCH
Assumption A6) is extended in this plan with `silence_alerts` +
`unsilence_alerts`. Plan 09-03 already added `'trigger'` (action) and
`'performance_alert_run'` (entityType) — DO NOT remove or replace those;
APPEND only.

Per W12 fix from plan-checker iteration 1: the example silence-actions.ts
calls drop the `as any` cast on `writeAuditLog`. The signature at
`src/lib/audit.ts:9-44` already accepts `metadata?: Record<string, unknown>`
directly — no cast needed.

Per W6 fix from plan-checker iteration 1: this plan now correctly
documents that `audit.ts` is read AT POST-09-03 STATE (i.e. with
`'trigger'` already in the action union and `'performance_alert_run'`
already in the entityType union from plan 09-03). The depends_on
chain `[01, 03]` enforces this ordering — 09-03 lands its audit.ts
edits in Wave 3, and this plan (Wave 4) APPENDS its `silence_alerts`
+ `unsilence_alerts` action values without disturbing the prior
additions.

Purpose: Without admin-only silencing, an alert that turns out to be
noisy (e.g. a kiosk in scheduled maintenance for 3 weeks) cannot be
suppressed without code changes. The silencing flow is the operator's
escape valve; documented in CONTEXT.md as the only mechanism (no
per-user opt-out per D-18).

Output:
- 2 new source files (`kiosk-admin-panel.tsx`, `silence-actions.ts`)
- 1 modified source file (`page.tsx` — wire in the panel below the existing form)
- 1 modified utility (`audit.ts` — APPEND 2 action union values to the post-09-03 state)
- 1 integration test
- 1 Playwright spec
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
@.planning/phases/09-poc-underperformance-alerts/09-03-SUMMARY.md

@src/app/(app)/kiosks/[id]/page.tsx
@src/app/(app)/kiosks/actions.ts
@src/app/(app)/admin/cache/cache-purge-panel.tsx
@src/app/(app)/admin/cache/actions.ts
@src/lib/rbac.ts
@src/lib/audit.ts
@src/db/schema.ts

<interfaces>
RBAC pattern (existing):
```typescript
import { requireRole } from "@/lib/rbac";
const session = await requireRole("admin");
```

Schema columns added in plan 09-01:
- `kiosks.alertSilencedAt: Date | null` (db column: alert_silenced_at)
- `kiosks.alertSilencedReason: string | null` (db column: alert_silenced_reason)

Existing kiosk-update analog (src/app/(app)/kiosks/actions.ts § updateKioskField):
```typescript
// updateKioskField uses requireRole("admin", "member") — broader RBAC.
// Phase 9 silence actions are admin-only — do NOT extend updateKioskField's
// allow-list; the silence action is its own action because the audit shape
// includes the reason text.
```

writeAuditLog signature (verified at src/lib/audit.ts:9-44 — POST-09-03 STATE):
```typescript
export async function writeAuditLog(
  entry: {
    actorId: string;
    actorName: string;
    entityType: "kiosk" | "location" | ... | "performance_alert_run" | ... | "system"; // 'performance_alert_run' added in 09-03
    entityId: string;
    entityName: string;
    action:
      | "create" | "update" | ...
      | "trigger"                    // ← added in plan 09-03
      | ...
      | "monday_import_triggered";
    field?: string;
    oldValue?: string;
    newValue?: string;
    metadata?: Record<string, unknown>;  // ← already accepts free-form metadata; NO `as any` cast required (W12 fix)
  },
  db: AnyDb = defaultDb,
): Promise<void>;
```

THIS plan APPENDS to the action union: `"silence_alerts" | "unsilence_alerts"`. The metadata jsonb column on audit_logs (verified at schema.ts line 312) carries the free-form reason text — pass it via the existing `metadata` parameter, no cast needed.

Audit pattern (CORRECTED per W12 — no `as any`):
```typescript
await writeAuditLog({
  actorId: session.user.id,
  actorName: session.user.name,
  entityType: "kiosk",                          // existing union member
  entityId: parsed.data.kioskId,
  entityName: <kiosk human label>,
  action: parsed.data.silenced ? "silence_alerts" : "unsilence_alerts",
  metadata: { reason: parsed.data.reason ?? null },
});
```

Zod for input validation (existing pattern in the codebase — verify against an existing server action):
```typescript
const SILENCE_INPUT = z.object({
  kioskId: z.string().uuid(),
  reason: z.string().min(3).max(500),  // brand-voice prompt: "Why is this kiosk being silenced?"
});
```
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser session -> /kiosks/[id] (RSC) | Better Auth session; non-admin sees the page but NOT the admin panel (RBAC-gated render). |
| Client component -> silenceKiosk / unsilenceKiosk server actions | Same auth boundary; RBAC + Zod validation re-enforced server-side. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-06-01 | Elevation | non-admin invoking silenceKiosk via direct API call | mitigate | `await requireRole("admin")` at the top of both server actions. The kiosk-id parameter is validated and the session-level check is what gates the write — not any client-side admin flag. |
| T-09-06-02 | Tampering | IDOR — admin silencing a kiosk via crafted ID | accept | Admins are trusted to silence any kiosk by definition (D-19). The action verifies the kiosk exists; otherwise no integrity issue. |
| T-09-06-03 | Tampering | SQL injection via reason text | mitigate | Drizzle parameterised queries. Zod validates `reason` as `z.string().max(500)` — bounded length, but contents can be any UTF-8. The DB stores raw text; rendering is via React JSX (auto-escaped); no server-side eval. |
| T-09-06-04 | Tampering | XSS via stored reason text rendering on the kiosk detail page | mitigate | Rendering uses React JSX which auto-escapes children. We never use `dangerouslySetInnerHTML` for the reason field. |
| T-09-06-05 | Repudiation | which admin silenced a kiosk + why | mitigate | `audit_logs` row carries actor_id, actor_name, entity_id (kiosk uuid), action, and the reason text in the audit `metadata` jsonb (verified at src/lib/audit.ts line 39 + schema.ts line 312). |
| T-09-06-06 | Information Disclosure | reason text contains business-sensitive context | accept | Free-form text in an admin-only column. Not exposed to non-admin reads. RBAC redaction handled by existing `redactSensitiveFields` if any non-admin code path ever selects this column. (None planned in this phase.) |
| T-09-06-07 | DoS | admin spamming silence/unsilence | accept | Low priority — admin-only, not externally exposed; existing rate-limiting on the application layer applies. |
| T-09-06-08 | Elevation | the silence-reason field used as a covert channel for cross-kiosk data leak | accept | Reason field is bounded and admin-only. Threat is hypothetical for an internal tool. |

ASVS controls applied:
- V2.1.1 (Auth): Better Auth session.
- V4.1.1 (Access Control): Admin-only at server-action layer.
- V4.2.2 (Conditional access): Panel is also RBAC-gated at the page-render layer (defence-in-depth — non-admins don't even see the form).
- V5.1.3 (Validation): Zod validates kioskId + reason length.
- V5.2.1 (Output Encoding): React auto-escape on rendering reason text in the panel after a successful silence.
- V8.1 (Data Protection): reason text is admin-only; not PII.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend src/lib/audit.ts with silence_alerts + unsilence_alerts actions (APPEND to post-09-03 state)</name>
  <files>src/lib/audit.ts</files>
  <read_first>
    Read `src/lib/audit.ts` AT POST-09-03 STATE — `'trigger'` is already in the `action` union and `'performance_alert_run'` is in the `entityType` union (added by Plan 09-03). APPEND `'silence_alerts'` and `'unsilence_alerts'` to the existing `action` union — do NOT replace the union or remove existing entries. Per W6 fix from plan-checker iteration 1.

    Also read:
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/lib/audit.ts (modify — type-extension)".
    - .planning/phases/09-poc-underperformance-alerts/09-03-SUMMARY.md to confirm the exact line(s) where 09-03 added `'trigger'` + `'performance_alert_run'` (so your APPEND lands cleanly without merge churn).
  </read_first>
  <behavior>
    - The `action` union accepts `"silence_alerts"` and `"unsilence_alerts"` as valid values, IN ADDITION to all values present after plan 09-03 (which includes `"trigger"`).
    - The `entityType` union retains `"performance_alert_run"` from plan 09-03 (this plan does not modify entityType).
    - Existing callers of writeAuditLog still compile (including the cron from 09-03 which uses `action: "trigger"` and `entityType: "performance_alert_run"`).
    - No DB migration — the underlying `audit_logs.action` column is plain `text` (verified at PATTERNS).
  </behavior>
  <action>
    1. Read the current `action` union at `src/lib/audit.ts` (POST-09-03 STATE — the lines around 16-35 that contain `"create" | "update" | ... | "trigger" | ... | "monday_import_triggered"`).
    2. APPEND `"silence_alerts"` and `"unsilence_alerts"` to the union — preserve ordering of existing entries; place the new entries adjacent to other lifecycle/state-mutation actions (e.g. near `"archive"` / `"resolve"`) for readability.
    3. Confirm `entityType` union still contains `"performance_alert_run"` from plan 09-03 (do not remove).
    4. Run `npx tsc --noEmit` — no callers should break (specifically: the cron's `writeAuditLog({ action: "trigger", entityType: "performance_alert_run", ... })` call must still compile clean).
  </action>
  <verify>
    <automated>grep -q '"silence_alerts"' src/lib/audit.ts &amp;&amp; grep -q '"unsilence_alerts"' src/lib/audit.ts &amp;&amp; grep -q '"trigger"' src/lib/audit.ts &amp;&amp; grep -q '"performance_alert_run"' src/lib/audit.ts &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep audit || echo OK</automated>
  </verify>
  <done>
    - `grep -c '"silence_alerts"' src/lib/audit.ts` returns at least 1.
    - `grep -c '"unsilence_alerts"' src/lib/audit.ts` returns at least 1.
    - `grep -c '"trigger"' src/lib/audit.ts` returns at least 1 (preserved from plan 09-03 — this plan APPENDS, does not replace).
    - `grep -c '"performance_alert_run"' src/lib/audit.ts` returns at least 1 (preserved from plan 09-03).
    - `npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -c "src/lib/audit.ts"` returns 0 (no TS errors in this file).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Author silence-actions.ts (silenceKiosk + unsilenceKiosk server actions — no `as any` cast per W12)</name>
  <files>src/app/(app)/kiosks/[id]/silence-actions.ts</files>
  <read_first>
    - src/app/(app)/admin/cache/actions.ts (full file — RBAC + writeAuditLog shape).
    - src/app/(app)/kiosks/actions.ts § updateKioskField (lines 288-345 per PATTERNS) — kiosk-mutation analog (allow-list pattern, audit pattern).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/app/(app)/kiosks/[id]/silence-actions.ts".
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-19 + D-20 (silencing semantics).
    - src/lib/audit.ts (POST-THIS-PLAN-TASK-1 STATE) § writeAuditLog full signature — VERIFIED: `metadata?: Record<string, unknown>` is already on the typed parameter (line 39). NO `as any` cast is needed at any call site (W12 fix). The `metadata` value lands in `audit_logs.metadata` (jsonb column at schema.ts line 312).
  </read_first>
  <behavior>
    - silenceKiosk(kioskId, reason):
      - Calls requireRole("admin").
      - Validates inputs with zod: kioskId must be uuid; reason must be string of length 3..500.
      - SELECTs the kiosk to confirm it exists; throws "Kiosk not found" if not.
      - UPDATEs `kiosks` SET `alert_silenced_at = NOW(), alert_silenced_reason = $reason` WHERE `id = $kioskId`.
      - Writes audit_logs row: entityType='kiosk', entityId=kioskId, entityName=`<kiosk identifier>`, action='silence_alerts', and persists the reason via the writeAuditLog `metadata` parameter (typed `Record<string, unknown>`, NO cast).
      - Calls revalidatePath(`/kiosks/${kioskId}`) so the page re-renders with the silenced state.
      - Returns `{ ok: true }`.
    - unsilenceKiosk(kioskId, reason?):
      - Same RBAC + validation (reason is optional, defaults to undefined; zod schema allows reason omission).
      - UPDATEs `kiosks` SET `alert_silenced_at = NULL, alert_silenced_reason = NULL` WHERE `id = $kioskId`.
      - Writes audit_logs row with action='unsilence_alerts' (and any provided reason in metadata for context).
      - revalidatePath same.
      - Returns `{ ok: true }`.
    - On any error (zod validation, kiosk not found, RBAC fail), returns `{ ok: false, error: <message> }` (or throws — match the convention used by existing server actions in the codebase).
    - **No `as any` cast** anywhere in this file (W12 fix — writeAuditLog's typed signature accepts metadata directly).
  </behavior>
  <action>
    Author src/app/(app)/kiosks/[id]/silence-actions.ts:

    ```typescript
    "use server";
    import { z } from "zod";
    import { eq } from "drizzle-orm";
    import { revalidatePath } from "next/cache";
    import { db } from "@/db";
    import { kiosks } from "@/db/schema";
    import { requireRole } from "@/lib/rbac";
    import { writeAuditLog } from "@/lib/audit";

    const SILENCE_INPUT = z.object({
      kioskId: z.string().uuid(),
      reason: z.string().min(3, "Reason must be at least 3 characters")
                       .max(500, "Reason must be at most 500 characters"),
    });

    const UNSILENCE_INPUT = z.object({
      kioskId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    });

    type Result = { ok: true } | { ok: false; error: string };

    export async function silenceKiosk(
      kioskId: string,
      reason: string,
    ): Promise<Result> {
      const session = await requireRole("admin");
      const parsed = SILENCE_INPUT.safeParse({ kioskId, reason });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
      }

      const kiosk = await db.query.kiosks.findFirst({
        where: eq(kiosks.id, parsed.data.kioskId),
      });
      if (!kiosk) {
        return { ok: false, error: "Kiosk not found" };
      }

      const now = new Date();
      await db
        .update(kiosks)
        .set({
          alertSilencedAt: now,
          alertSilencedReason: parsed.data.reason,
        })
        .where(eq(kiosks.id, parsed.data.kioskId));

      const entityName = kiosk.outletCode ?? kiosk.id;
      // W12 — writeAuditLog accepts `metadata?: Record<string, unknown>` directly.
      // No `as any` cast required.
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name ?? "unknown admin",
        entityType: "kiosk",
        entityId: parsed.data.kioskId,
        entityName,
        action: "silence_alerts",
        metadata: { reason: parsed.data.reason },
      });

      revalidatePath(`/kiosks/${parsed.data.kioskId}`);
      return { ok: true };
    }

    export async function unsilenceKiosk(
      kioskId: string,
      reason?: string,
    ): Promise<Result> {
      const session = await requireRole("admin");
      const parsed = UNSILENCE_INPUT.safeParse({ kioskId, reason });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
      }

      const kiosk = await db.query.kiosks.findFirst({
        where: eq(kiosks.id, parsed.data.kioskId),
      });
      if (!kiosk) {
        return { ok: false, error: "Kiosk not found" };
      }

      await db
        .update(kiosks)
        .set({
          alertSilencedAt: null,
          alertSilencedReason: null,
        })
        .where(eq(kiosks.id, parsed.data.kioskId));

      const entityName = kiosk.outletCode ?? kiosk.id;
      // W12 — no `as any` cast. metadata is part of the typed signature.
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name ?? "unknown admin",
        entityType: "kiosk",
        entityId: parsed.data.kioskId,
        entityName,
        action: "unsilence_alerts",
        metadata: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
      });

      revalidatePath(`/kiosks/${parsed.data.kioskId}`);
      return { ok: true };
    }
    ```

    The metadata jsonb column on `audit_logs` (verified at schema.ts line 312) accepts arbitrary `Record<string, unknown>` shapes; the unsilence path passes `undefined` when no reason is provided rather than an empty object — keeps the audit row's metadata column NULL when there's nothing to record.
  </action>
  <verify>
    <automated>grep -c "as any" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep silence-actions || echo OK</automated>
  </verify>
  <done>
    - Both server actions exported (`grep -c "export async function silenceKiosk" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns 1, same for unsilenceKiosk).
    - `grep -c "as any" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns 0 (W12 fix — no cast on writeAuditLog).
    - Zod validation applied to inputs (`grep -c "SILENCE_INPUT.safeParse\|UNSILENCE_INPUT.safeParse" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns at least 2).
    - Audit log written with appropriate action (`grep -c '"silence_alerts"\|"unsilence_alerts"' src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns at least 2).
    - revalidatePath called (`grep -c "revalidatePath" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns at least 2).
    - `npx tsc --noEmit -p tsconfig.json` exits 0 (TS clean — confirms writeAuditLog typing accepts the metadata-included call without cast).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Author KioskAdminPanel client component + wire into kiosks/[id]/page.tsx</name>
  <files>src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx, src/app/(app)/kiosks/[id]/page.tsx</files>
  <read_first>
    - src/app/(app)/kiosks/[id]/page.tsx (full current file — small, ~75 LOC). You'll add a conditional render below the existing form.
    - src/app/(app)/admin/cache/cache-purge-panel.tsx (full file — clone for the client component shape: useTransition + sonner toast + Card layout).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/app/(app)/kiosks/[id]/silence-panel.tsx".
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Open Question Q2 (recommendation: new <KioskAdminPanel> rather than inlining in form).
    - WeKnow brand voice rules (~/.claude/weknow-brand-guidelines.md) — UI copy should be professional + actionable.
  </read_first>
  <behavior>
    - kiosk-admin-panel.tsx is a client component (`"use client"`) that takes props `{ kioskId: string; isSilenced: boolean; currentReason: string | null }`.
    - When `isSilenced=false`: shows a "Silence alerts" button with a `<textarea>` for the reason. Submit calls silenceKiosk(kioskId, reason). On success toast.success("Alerts silenced for this kiosk"); on validation error toast.error(error).
    - When `isSilenced=true`: shows the current `currentReason` in a tinted info panel (Azure-20%) and an "Unsilence alerts" button (with optional reason textarea). Submit calls unsilenceKiosk(kioskId, reason). Toast on success.
    - The component is wrapped in a Card with title "Alert silencing (admin only)".
    - Uses useTransition for the pending state.
    - The component is rendered ONLY when the page detects an admin session — gate at the page layer (RSC) AND at the server-action layer (defence-in-depth).
    - page.tsx is modified to: (1) read the session role via the existing auth helper, (2) read the kiosk's `alertSilencedAt` + `alertSilencedReason` from the DB, (3) conditionally render `<KioskAdminPanel>` below the existing form when role==='admin'.
  </behavior>
  <action>
    1. Author src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx:

       ```typescript
       "use client";
       import { useState, useTransition } from "react";
       import { Button } from "@/components/ui/button";
       import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
       import { Textarea } from "@/components/ui/textarea";
       import { toast } from "sonner";
       import { silenceKiosk, unsilenceKiosk } from "./silence-actions";

       export function KioskAdminPanel({
         kioskId,
         isSilenced,
         currentReason,
       }: {
         kioskId: string;
         isSilenced: boolean;
         currentReason: string | null;
       }) {
         const [reason, setReason] = useState("");
         const [pending, startTransition] = useTransition();

         const handleSilence = () => {
           if (reason.trim().length < 3) {
             toast.error("Provide a reason (3+ characters) before silencing");
             return;
           }
           startTransition(async () => {
             const result = await silenceKiosk(kioskId, reason.trim());
             if (result.ok) {
               toast.success("Alerts silenced for this kiosk");
               setReason("");
             } else {
               toast.error(result.error);
             }
           });
         };

         const handleUnsilence = () => {
           startTransition(async () => {
             const trimmed = reason.trim();
             const result = await unsilenceKiosk(kioskId, trimmed.length > 0 ? trimmed : undefined);
             if (result.ok) {
               toast.success("Alerts re-enabled for this kiosk");
               setReason("");
             } else {
               toast.error(result.error);
             }
           });
         };

         return (
           <Card>
             <CardHeader>
               <CardTitle>Alert silencing (admin only)</CardTitle>
             </CardHeader>
             <CardContent className="flex flex-col gap-3">
               {isSilenced ? (
                 <>
                   <div
                     className="rounded-md border-l-4 px-3 py-2 text-sm"
                     style={{ borderLeftColor: "#00A6D3", backgroundColor: "#CCEDF6" }}
                   >
                     <p className="font-semibold">Currently silenced</p>
                     {currentReason ? (
                       <p className="mt-1 text-muted-foreground">{currentReason}</p>
                     ) : (
                       <p className="mt-1 text-muted-foreground">(no reason recorded)</p>
                     )}
                   </div>
                   <label className="text-sm font-medium">Why unsilence? (optional)</label>
                   <Textarea
                     value={reason}
                     onChange={(e) => setReason(e.target.value)}
                     placeholder="e.g. Maintenance complete; resume alerts."
                     maxLength={500}
                     disabled={pending}
                   />
                   <Button
                     onClick={handleUnsilence}
                     disabled={pending}
                     className="max-w-xs"
                     variant="default"
                   >
                     {pending ? "Re-enabling…" : "Unsilence alerts"}
                   </Button>
                 </>
               ) : (
                 <>
                   <p className="text-sm text-muted-foreground">
                     Silencing this kiosk will exclude it from the weekly POC underperformance
                     alert until you unsilence it. The kiosk continues to trade and is still
                     visible elsewhere.
                   </p>
                   <label className="text-sm font-medium">Reason (required)</label>
                   <Textarea
                     value={reason}
                     onChange={(e) => setReason(e.target.value)}
                     placeholder="e.g. In scheduled maintenance for the next 3 weeks."
                     maxLength={500}
                     disabled={pending}
                   />
                   <Button
                     onClick={handleSilence}
                     disabled={pending || reason.trim().length < 3}
                     className="max-w-xs"
                   >
                     {pending ? "Silencing…" : "Silence alerts"}
                   </Button>
                 </>
               )}
             </CardContent>
           </Card>
         );
       }
       ```

    2. Modify src/app/(app)/kiosks/[id]/page.tsx:
       - Read the existing structure end-to-end first.
       - Determine the existing session/role accessor (e.g. `getSessionOrThrow()`, or check how `/admin/cache/page.tsx` reads role — likely via `auth()` from Better Auth or a wrapper).
       - Read the kiosk row to get `alertSilencedAt` + `alertSilencedReason` (the existing kiosk fetch likely already selects all columns — verify).
       - Conditionally render `<KioskAdminPanel>` below the existing form when `session.user.role === "admin"`.
       - Pass `kioskId={kiosk.id}`, `isSilenced={kiosk.alertSilencedAt !== null}`, `currentReason={kiosk.alertSilencedReason}`.

       Example diff shape (the exact integration point depends on the existing layout):
       ```typescript
       // existing imports + getSessionOrThrow / kiosk fetch ...
       import { KioskAdminPanel } from "./kiosk-admin-panel";

       // ... existing form rendering ...
       {session.user.role === "admin" && (
         <div className="mt-6">
           <KioskAdminPanel
             kioskId={kiosk.id}
             isSilenced={kiosk.alertSilencedAt !== null}
             currentReason={kiosk.alertSilencedReason}
           />
         </div>
       )}
       ```

    3. Verify import paths (`Card`, `Button`, `Textarea`) match the existing UI primitives in this codebase (likely `@/components/ui/...`). If `Textarea` does not exist in `@/components/ui/`, use the existing native `<textarea>` styling pattern from elsewhere in the codebase.

    4. Verify TS compiles clean.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "kiosk-admin-panel|kiosks/\[id\]" || echo OK</automated>
  </verify>
  <done>
    - `test -f "src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx"` exits 0.
    - `grep -c "KioskAdminPanel" "src/app/(app)/kiosks/[id]/page.tsx"` returns at least 2 (one import, one render call).
    - `npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -c "kiosk-admin-panel"` returns 0.
    - Brand tokens in the silenced-info panel: `grep -c "#00A6D3" "src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx"` returns at least 1 AND `grep -c "#CCEDF6" "src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx"` returns at least 1.
    - Disabled state when reason too short: `grep -c "reason.trim().length < 3" "src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx"` returns at least 1.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Integration test — silence/unsilence server actions + audit</name>
  <files>tests/kiosks/silence-toggle.integration.test.ts</files>
  <read_first>
    - tests/email/send-email-fn.integration.test.ts — Testcontainers + dbRef mock pattern.
    - .planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md row (i).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § Testcontainers integration-test scaffold.
  </read_first>
  <behavior>
    - it("silenceKiosk throws Forbidden for non-admin"): mock requireRole to throw; assert.
    - it("silenceKiosk validates reason length"): admin session, reason="ab" → returns { ok: false, error: matches /at least 3/i }.
    - it("silenceKiosk validates kioskId is uuid"): admin session, kioskId="not-a-uuid" → returns { ok: false }.
    - it("silenceKiosk returns Kiosk not found for unknown id"): admin session, kioskId=valid-but-not-in-DB → returns { ok: false, error: "Kiosk not found" }.
    - it("silenceKiosk sets alert_silenced_at + reason + writes audit row WITH metadata.reason"): seed a kiosk; call silenceKiosk; assert kiosks row updated; assert audit_logs row exists with entityType='kiosk', entityId=kiosk.id, action='silence_alerts', AND assert `audit_logs.metadata->>'reason'` equals the input reason (W12 — proves the typed metadata path round-trips through Drizzle without the `as any` cast).
    - it("unsilenceKiosk clears alert_silenced_at + reason + writes audit row"): seed a kiosk with alert_silenced_at=NOW(); call unsilenceKiosk; assert columns NULL; assert audit_logs row with action='unsilence_alerts'. When `reason` is provided, assert `metadata->>'reason'` matches; when omitted, assert metadata is NULL.
  </behavior>
  <action>
    1. Create tests/kiosks/silence-toggle.integration.test.ts using Testcontainers + vi.hoisted pattern.
    2. Mock `@/lib/rbac` for the success/fail RBAC cases.
    3. For audit assertions, query `audit_logs` directly and assert action + entity_id + metadata columns.
    4. For `revalidatePath` — mock it (vi.fn()) so the test doesn't fail when running outside Next.js runtime.
    5. Run the test.
  </action>
  <verify>
    <automated>npx vitest run --project integration tests/kiosks/silence-toggle.integration.test.ts</automated>
  </verify>
  <done>
    - All 6 cases pass — `npx vitest run --project integration tests/kiosks/silence-toggle.integration.test.ts` exits 0.
    - The metadata-roundtrip assertion in case 5 (W12 evidence) passes — `audit_logs.metadata->>'reason'` returns the input reason text.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Playwright spec against preview alias + manual UAT</name>
  <files>tests/kiosks/silence.spec.ts</files>
  <what-built>
    - Playwright E2E spec at tests/kiosks/silence.spec.ts that:
      - signs in as admin (via tests/helpers/auth.ts signInAsAdmin).
      - navigates to a kiosk detail page (use a known seed-data kiosk id, or query the DB ahead of the test).
      - asserts the "Alert silencing (admin only)" panel is visible.
      - types a reason ("Playwright UAT — silencing test").
      - clicks "Silence alerts".
      - asserts toast "Alerts silenced for this kiosk" appears.
      - reloads the page.
      - asserts the panel now shows "Currently silenced" + the reason.
      - clicks "Unsilence alerts".
      - asserts toast "Alerts re-enabled for this kiosk" appears.
      - reloads.
      - asserts the panel is back to the "Silence alerts" form state.
    - Spec must clone the structure of tests/admin/cache-purge.spec.ts (auth helper + page navigation + role + click + toast assertion).
    - Per CLAUDE.md: this MUST run against the preview alias (PLAYWRIGHT_BASE_URL=git-branch alias) — `--list` is insufficient.
  </what-built>
  <how-to-verify>
    Operator-driven verification (Claude cannot run Playwright against preview deploy autonomously):

    1. Confirm the branch is deployed to Vercel preview (likely already done in plan 09-05's checkpoint). If not, push + wait for deploy + verify alias exists.

    2. Confirm the preview env vars are set (BETTER_AUTH_URL pointed at git-branch alias, etc.) and the migration 0043 + migration 0044 have been applied to the preview's DB.

    3. Run the spec:
       ```bash
       PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-phase-09-poc-underperformance-alerts-vedant-kalbag-wkgs-projects.vercel.app \
       TEST_ADMIN_EMAIL=<from .env.test> \
       TEST_ADMIN_PASSWORD=<from .env.test> \
         npx playwright test tests/kiosks/silence.spec.ts
       ```

    4. Manual UAT in the browser at the preview alias:
       - Sign in as admin.
       - Visit a kiosk detail page (any /kiosks/[id]).
       - Confirm the "Alert silencing (admin only)" card is visible BELOW the existing form.
       - Try clicking "Silence alerts" with no reason — confirm the button is disabled OR the toast says "Provide a reason".
       - Type a reason and silence — confirm toast + page state changes after refresh.
       - Sign in as a non-admin user — confirm the panel does NOT appear.
       - Sign back in as admin — unsilence — confirm round-trip works.

    5. (Optional but recommended) After silencing one kiosk, click "Run now" on /admin/performance-alerts — open the Inngest dashboard — confirm the silenced kiosk did NOT appear in any classified-state writes (would require seed data to fully verify, but the SQL filter in classify-kiosks.ts is the enforcement point).
  </how-to-verify>
  <resume-signal>Type "approved" once the Playwright spec passes against preview AND the manual UAT checklist is green. Or describe any issues — the planner can revise the panel UI or the server action.</resume-signal>
</task>

</tasks>

<verification>
- `grep -q "silence_alerts" src/lib/audit.ts; grep -q "unsilence_alerts" src/lib/audit.ts; grep -q "trigger" src/lib/audit.ts; grep -q "performance_alert_run" src/lib/audit.ts` (W6 — APPEND-only; confirms 09-03's prior additions are preserved alongside this plan's new ones)
- `grep -c "as any" src/app/\(app\)/kiosks/\[id\]/silence-actions.ts` returns 0 (W12 — no cast on writeAuditLog)
- `grep -q "silenceKiosk" src/app/(app)/kiosks/[id]/silence-actions.ts`
- `grep -q "unsilenceKiosk" src/app/(app)/kiosks/[id]/silence-actions.ts`
- `grep -q "KioskAdminPanel" src/app/(app)/kiosks/[id]/page.tsx`
- `npx vitest run --project integration tests/kiosks/silence-toggle.integration.test.ts` exits 0
- (Operator) Playwright spec passes against preview alias.
- (Operator) Silenced kiosk does not appear in subsequent cron classify-kiosks output (cross-plan invariant — the WHERE filter from plan 09-03 is the enforcement; visible in the admin page silenced count vs. classified count delta).
</verification>

<success_criteria>
1. Admin-only KioskAdminPanel renders on /kiosks/[id] for admin sessions.
2. Silence + unsilence flows update kiosks columns correctly + write audit_logs.
3. Zod validation enforces non-empty 3..500 char reason on silence.
4. Cron classify-kiosks (plan 09-03) excludes silenced kiosks per its WHERE alert_silenced_at IS NULL clause.
5. Integration tests cover RBAC + validation + DB writes + audit (including W12 metadata-roundtrip).
6. Playwright + manual UAT cover the round-trip flow.
7. W6 — `src/lib/audit.ts` APPENDs `silence_alerts` + `unsilence_alerts` to the post-09-03 action union without removing 09-03's prior `trigger` / `performance_alert_run` additions.
8. W12 — silence-actions.ts contains zero `as any` casts; the typed writeAuditLog signature accepts metadata directly.
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-06-SUMMARY.md` with:
- Files created
- Files modified (page.tsx, audit.ts)
- Integration test runtime
- Playwright spec result against preview alias (operator confirms)
- Manual UAT checklist sign-off
- Confirmation that silenced kiosks were excluded from a manual "Run now" classification (cross-plan invariant from 09-03 + 09-05 + this plan)
- W6 confirmation: audit.ts APPEND was clean (the post-09-03 entries `trigger` + `performance_alert_run` are still present alongside the new `silence_alerts` + `unsilence_alerts`)
- W12 confirmation: zero `as any` casts in silence-actions.ts; the metadata-roundtrip integration test case (#5) passed
- Any deviations: copy tweaks, alternate placement, etc.
</output>
