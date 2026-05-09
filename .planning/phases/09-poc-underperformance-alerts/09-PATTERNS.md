# Phase 9: POC Underperformance Alerts - Pattern Map

**Mapped:** 2026-05-09
**Files analysed:** 19 (16 to create + 3 to modify)
**Analogs found:** 17 / 19 (1 NOVEL — per-kiosk classification SQL; 1 PARTIAL — admin metadata page)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `migrations/0043_phase_09_poc_underperformance_alerts.sql` | migration | write (DDL) | `migrations/0041_phase_08_email_log.sql` + `migrations/0033_locations_iana_timezone_and_admin_settings.sql` | exact (DDL + appSettings seed shape) |
| `src/db/schema.ts` (modify) | schema | drizzle-table-def | `src/db/schema.ts` § `emailLog` (lines 1107-1134) + `kiosks` (117-144) | exact |
| `src/inngest/events.ts` (modify) | inngest-event-shape | type-extension | `src/inngest/events.ts` (current Phase 8 shape, lines 11-24) | exact (one-line union extension) |
| `src/inngest/functions/send-email.ts` (modify) | inngest-fn dispatch | render | `src/inngest/functions/send-email.ts` § `TEMPLATES` (lines 34-38) + plain-text branch (82-93) | exact (extend the dispatch table) |
| `src/inngest/functions/weekly-poc-alerts.ts` | inngest-fn (cron + event) | classify + dispatch | `src/inngest/functions/send-email.ts` (function-shape, step boundaries) + RESEARCH.md § Pattern 1 | role-match (SHAPE clones, internals novel) |
| `src/lib/performance-alerts/classify-dispatch.ts` | utility (pure) | classify | none direct (pure logic, RESEARCH.md § Code Examples line 530-558 is the spec) | NOVEL — compose, do not clone |
| `src/lib/performance-alerts/poc-batching.ts` | utility (pure) | transform | `src/lib/analytics/metrics.ts` § `classifyOutletTier` (pure typed reducer) | partial (same SHAPE, different domain) |
| `src/lib/performance-alerts/iso-week.ts` | utility (pure) | transform | none direct (use `Intl.DateTimeFormat` + ISO week math) | NOVEL — compose |
| `src/lib/performance-alerts/hash.ts` | utility (pure) | transform | RESEARCH.md § Standard Stack `crypto.createHash('sha256')` | trivial — no analog needed |
| `src/lib/performance-alerts/classify-kiosks.ts` (per-kiosk SQL) | analytics-reader | read | `src/lib/analytics/queries/portfolio.ts` § `getOutletTiers` (lines 408-520) — **PER-LOCATION, must be cloned and converted to PER-KIOSK** | **FLAGGED NOVEL** — partial-clone with substantive SQL rewrite |
| `src/emails/poc-underperformance.tsx` | email-template | render | `src/emails/password-changed.tsx` (full file) | exact (clone target) |
| `src/emails/text-versions.ts` (modify) | email-template (text) | render | `src/emails/text-versions.ts` § `passwordChangedText` (lines 62-80) | exact |
| `src/app/(app)/admin/performance-alerts/page.tsx` | admin-route (RSC) | read | `src/app/(app)/admin/cache/page.tsx` (full file) | exact |
| `src/app/(app)/admin/performance-alerts/run-now-button.tsx` | admin-component | dispatch | `src/app/(app)/admin/cache/cache-purge-panel.tsx` (full file) | exact |
| `src/app/(app)/admin/performance-alerts/actions.ts` | server-action | dispatch | `src/app/(app)/admin/cache/actions.ts` (full file, RBAC + audit + return shape) | exact |
| `src/app/(app)/kiosks/[id]/silence-panel.tsx` (or section in form) | admin-component | mutate | `src/app/(app)/admin/cache/cache-purge-panel.tsx` (admin RBAC-gated panel shape) | role-match |
| `src/app/(app)/kiosks/[id]/silence-actions.ts` | server-action | mutate | `src/app/(app)/admin/cache/actions.ts` (full file) + `src/app/(app)/kiosks/actions.ts` § `updateKioskField` (lines 288-345) | exact (clone + extend allow-list) |
| `src/app/api/inngest/route.ts` (modify) | route-mount | dispatch | `src/app/api/inngest/route.ts` (current shape, full file) | exact (one-line `functions: [...]` extension) |
| `src/lib/audit.ts` (modify — type unions) | utility (types) | type-extension | `src/lib/audit.ts` (current entityType + action union, lines 13 + 17-35) | exact (extend the closed unions) |

### Tests

| New Test File | Type | Closest Analog |
|---|---|---|
| `src/lib/performance-alerts/classify-dispatch.test.ts` | unit | (no Phase 8 unit-pure analog; same shape as any vitest unit) |
| `src/lib/performance-alerts/poc-batching.test.ts` | unit | same |
| `src/lib/performance-alerts/iso-week.test.ts` | unit | same |
| `src/emails/__tests__/poc-underperformance.test.ts` | unit (snapshot) | `src/emails/__tests__/helpers/render-snapshot.ts` (helper) |
| `tests/performance-alerts/eligibility.integration.test.ts` | integration | `tests/email/send-email-fn.integration.test.ts` (full file — Testcontainers + step shim + mocked Resend) |
| `tests/performance-alerts/null-poc-skip.integration.test.ts` | integration | same |
| `tests/performance-alerts/idempotency.integration.test.ts` | integration | `tests/email/send-email-fn.integration.test.ts` § "two events with same (kind, payloadHash)" (lines 119-158 — RESEARCH explicitly flags this as the test to swap to `template:"poc-underperformance"`) |
| `tests/admin/performance-alerts.integration.test.ts` | integration | (no exact integration analog for admin actions; pattern is RBAC + server-action + audit assertion) |
| `tests/kiosks/silence-toggle.integration.test.ts` | integration | same |
| `tests/admin/performance-alerts.spec.ts` | e2e (Playwright) | `tests/admin/cache-purge.spec.ts` (full file — sign-in + visit + click + toast + audit assertion) |
| `tests/kiosks/silence.spec.ts` | e2e (Playwright) | `tests/kiosks/assignee-edit.spec.ts` or `tests/admin/cache-purge.spec.ts` |

---

## Pattern Assignments

### `migrations/0043_phase_09_poc_underperformance_alerts.sql` (migration, write/DDL)

**Analog:** `migrations/0041_phase_08_email_log.sql` (table + indexes) + `migrations/0033_locations_iana_timezone_and_admin_settings.sql` (alter-table + appSettings seed)

**Header pattern (`0041` lines 1-18):**
```sql
-- Phase 8 Plan 08-01 — email_log audit table (EMAIL-01 + EMAIL-04).
--
-- One row per email send, regardless of transport. Partial unique index on
-- (kind, payload_hash) WHERE payload_hash IS NOT NULL enforces digest
-- idempotency at the DB; auth-flow sends pass payload_hash=NULL so they
-- never collide.
--
-- Each statement is `IF NOT EXISTS` / idempotent so re-running on the UAT
-- branch (where the table may already exist from an earlier apply) is a
-- no-op.
--
-- Hand-authored rather than generated: drizzle-kit's snapshot history is
-- incomplete pre-0023 (see 0039's header for full rationale).
--
-- Deltas:
--   1. email_log table.
--   2. partial unique idx on (kind, payload_hash) WHERE payload_hash IS NOT NULL.
--   3. recipient + created_at desc helper idx for "recent sends to recipient" lookups.
```

**Table-creation pattern (`0041` lines 20-31):**
```sql
-- ── Delta 1 — email_log table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "recipient" text NOT NULL,
  "resend_message_id" text,
  "inngest_run_id" text,
  "status" text NOT NULL,
  "last_error" text,
  "payload_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

**ALTER + seed pattern (`0033` lines 29-30 + 56-59):**
```sql
ALTER TABLE "locations" ADD COLUMN "iana_timezone" text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint

INSERT INTO "app_settings" ("key", "value")
  VALUES ('analytics_display_timezone', 'local')
  ON CONFLICT ("key") DO NOTHING;
```

**CHECK constraint pattern (`0042` lines 13-23) — for `kiosk_performance_alert_state.tier`:**
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_log_status_check'
  ) THEN
    ALTER TABLE "email_log"
      ADD CONSTRAINT "email_log_status_check"
      CHECK (status IN ('sent', 'failed'));
  END IF;
END $$;
```

---

### `src/db/schema.ts` (modify — schema, drizzle-table-def)

**Analog (table-def):** `src/db/schema.ts` § `emailLog` (lines 1107-1134)

**Pattern — pgTable with partial unique idx + helper idx (lines 1112-1134):**
```typescript
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    resendMessageId: text("resend_message_id"),
    inngestRunId: text("inngest_run_id"),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    lastError: text("last_error"),
    payloadHash: text("payload_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    kindPayloadHashUq: uniqueIndex("email_log_kind_payload_hash_uq")
      .on(t.kind, t.payloadHash)
      .where(sql`payload_hash IS NOT NULL`),
    recipientCreatedAtIdx: index("email_log_recipient_created_at_idx").on(
      t.recipient,
      t.createdAt.desc(),
    ),
  }),
);
```

**Analog (column-add to `kiosks`):** `src/db/schema.ts` § `kiosks` (lines 117-144). Add `alertSilencedAt` + `alertSilencedReason` adjacent to existing nullable timestamp/text columns. The `archivedAt` column at line 143 is the structural twin of `alertSilencedAt`:
```typescript
archivedAt: timestamp("archived_at", { withTimezone: true }),
```

**Analog (FK to users — TEXT not UUID):** `kiosks.internalPocId` (line 138):
```typescript
internalPocId: text("internal_poc_id").references(() => user.id),
```
RESEARCH § Pitfall 6 confirms `user.id` is text. The new `kiosk_performance_alert_state` table FKs to `kiosks.id` (uuid) ON DELETE CASCADE, no user FK.

---

### `src/inngest/events.ts` (modify — inngest-event-shape, type-extension)

**Analog:** `src/inngest/events.ts` (full current file)

**Current shape (lines 11-24):**
```typescript
export type EmailKind = "password_changed" | "digest_daily" | "kiosk_offline";
export type EmailTemplate = "password-changed";

export type EmailSendRequested = {
  name: "email/send.requested";
  data: {
    kind: EmailKind;
    to: string;
    subject: string;
    template: EmailTemplate;
    templateProps: Record<string, unknown>;
    payloadHash?: string;
  };
};
```

**Phase 9 extension shape (RESEARCH.md § Code Examples lines 622-637):**
```typescript
export type EmailKind = "password_changed" | "digest_daily" | "kiosk_offline" | "underperforming_poc";
export type EmailTemplate = "password-changed" | "poc-underperformance";

// NEW second event-type for the "Run now" trigger:
export type PerformanceAlertsRunRequested = {
  name: "performance-alerts/run.requested";
  data: { actorId: string; actorName: string };
};
```

---

### `src/inngest/functions/send-email.ts` (modify — render-dispatch)

**Analog:** `src/inngest/functions/send-email.ts` (lines 34-38 + 82-93)

**`TEMPLATES` dispatch table (lines 34-38) — extend with one entry:**
```typescript
const TEMPLATES = {
  "password-changed": PasswordChangedEmail,
} as const;
```
Phase 9 adds: `"poc-underperformance": PocUnderperformanceEmail`.

**Plain-text branch (lines 82-93) — extend with parallel branch:**
```typescript
if (template === "password-changed") {
  const props = templateProps as { changedAt: string; contactAdminUrl: string };
  text = passwordChangedText({
    changedAt: props.changedAt,
    contactAdminEmail: props.contactAdminUrl.replace(/^mailto:/, ""),
  });
} else {
  text = await render(element, { plainText: true });
}
```
Phase 9 adds an `else if (template === "poc-underperformance")` branch calling `pocUnderperformanceText({ kiosks, ... })` from text-versions.ts.

---

### `src/inngest/functions/weekly-poc-alerts.ts` (NEW — inngest-fn cron + event multi-trigger)

**Analog:** `src/inngest/functions/send-email.ts` (full file — function-shape, env-var pattern, step boundaries, retry wrapper) + RESEARCH.md § Patterns 1, 3, 5

**Imports + lazy-init pattern (`send-email.ts` lines 1-30):**
```typescript
import { render } from "@react-email/render";
import { sql } from "drizzle-orm";
import { Resend } from "resend";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { PasswordChangedEmail } from "@/emails/password-changed";
import { passwordChangedText } from "@/emails/text-versions";

import { inngest } from "../client";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
```
Phase 9 imports drizzle, schema tables (kiosks, kioskPerformanceAlertState, appSettings, user, emailLog, pipelineStages), `inngest` from `../client`, the analytics readers (`getOutletTierThresholds`, `classifyOutletTier`), the new pure utilities, and the `writeAuditLog` helper. **No Resend imports** — fan-out is via `step.sendEvent("email/send.requested", ...)`, which `sendEmailFn` consumes.

**`createFunction` shape (`send-email.ts` lines 141-158, multi-trigger pattern from RESEARCH § Pattern 1):**
```typescript
export const sendEmailFn = inngest.createFunction(
  {
    id: "send-email",
    name: "Send Email",
    retries: 5,
    triggers: [{ event: "email/send.requested" }],
  },
  async ({ event, step, runId }) => {
    await _handleSendEmail({
      event: event as unknown as Parameters<typeof _handleSendEmail>[0]["event"],
      step: step as unknown as StepShim,
      runId,
    });
  },
);
```

**Phase 9 createFunction shape (RESEARCH § Code Examples lines 440-450):**
```typescript
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
  async ({ step, runId }) => { /* steps below */ },
);
```

**Step-boundary pattern (`send-email.ts` lines 71-133) — three named `step.run` calls each returning a typed value, with `await step.run("name", async () => { ... })`:**
```typescript
const { html, text } = await step.run("render-html", async () => {
  const Component = TEMPLATES[template as TemplateKey];
  if (!Component) {
    throw new Error(`Unknown email template: ${template}`);
  }
  // ...
  return { html, text };
});

const sendResult = await step.run("resend-send", async () => {
  return await getResend().emails.send({ /* ... */ });
});

await step.run("log", async () => {
  await db.insert(emailLog).values({ /* ... */ }).onConflictDoNothing({ /* ... */ });
});
```
Phase 9 has 7 steps (load-config, classify-kiosks, diff-state, write-state, emit-poc-emails, emit-skip-rows, write-run-audit) — see RESEARCH § Code Examples lines 451-525 for the per-step skeleton.

**Test-shim split pattern (`send-email.ts` lines 41-67) — extract `_handleWeeklyPocAlerts({ step, runId })` so integration tests can drive it without spinning up the Inngest dev server:**
```typescript
type StepShim = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

export async function _handleSendEmail({ event, step, runId }: { /* ... */ }): Promise<void> {
  // ... handler body ...
}
```

---

### `src/lib/performance-alerts/classify-dispatch.ts` (NEW — utility, pure)

**Analog:** No direct codebase analog (pure logic). RESEARCH.md § Code Examples lines 530-558 is the canonical spec.

**Reference shape (RESEARCH lines 541-558):**
```typescript
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function decideAlert(
  prior: { tier: Tier; lastAlertedAt: Date | null } | null,
  newTier: Tier,
  now: Date,
): Decision {
  if (newTier !== "bottom") return "no-alert";
  if (!prior || prior.tier !== "bottom") return "flip-in";
  if (
    prior.lastAlertedAt === null ||
    now.getTime() - prior.lastAlertedAt.getTime() >= THIRTY_DAYS_MS
  ) {
    return "chronic";
  }
  return "no-alert";
}
```

**Note:** RESEARCH § Open Questions Q1 + Assumption A3 — the cron stores `"Premium"|"Standard"|"Developing"|"Emerging"` (output of `classifyOutletTier` per `metrics.ts` lines 111-119) and treats `"Emerging"` as the bottom-tier sentinel. Planner must lock this mapping.

---

### `src/lib/performance-alerts/poc-batching.ts` (NEW — utility, pure)

**Analog (shape):** `src/lib/analytics/metrics.ts` § `classifyOutletTier` (lines 111-119) — pure typed function over a small input shape.

**Pattern — pure typed reducer:**
```typescript
export function classifyOutletTier(
  percentile: number,
  config: OutletTierConfig,
): OutletTier {
  if (percentile >= config.top) return "Premium";
  if (percentile >= config.mid) return "Standard";
  if (percentile >= config.bottom) return "Developing";
  return "Emerging";
}
```

Phase 9 `groupByPoc(rows)` returns `Array<{ userId: string | null, email: string, name: string, kiosks: KioskRow[] }>` — kiosks with NULL POC bucket into a sentinel group the cron emits as skip rows.

---

### `src/lib/performance-alerts/iso-week.ts` (NEW — utility, pure)

**Analog:** No direct codebase analog. RESEARCH § Pitfall 1 + Standard Stack `date-fns/getISOWeek` + `Intl.DateTimeFormat` is the spec.

**Pattern (RESEARCH § Pitfall 1 lines 320-323):** compute in `Europe/London` wall-clock first, then derive ISO week. Round to the nearest Monday in London zone before hashing. Unit-test the boundary cases: 2026-12-28 Mon (week 53), 2027-01-04 Mon (week 1).

---

### `src/lib/performance-alerts/classify-kiosks.ts` (NEW — analytics-reader)

**FLAGGED NOVEL** — partial-clone with substantive SQL rewrite.

**Closest analog:** `src/lib/analytics/queries/portfolio.ts` § `getOutletTiers` (lines 408-520).

**Why it cannot be cloned wholesale (RESEARCH § Anti-Patterns lines 296):** `getOutletTiers` `GROUP BY locations.id` (per-LOCATION aggregation) and returns 4-tier classification. CONTEXT D-05 + D-03 require **per-kiosk** aggregation with the same percentile-cutoff approach. The shape to clone is:

**Shape that IS cloneable (lines 415-419 + 491-495 + 510-517):**
```typescript
const [whereClause, tierConfig] = await Promise.all([
  buildPortfolioWhere(filters, userCtx),
  getOutletTierThresholdsCached(),
]);

// percentile-rank SQL pattern — rank within sorted revenues array:
const sortedRevenues = parsed.map((r) => r.revenue).sort((a, b) => a - b);
const rows: OutletTierRow[] = parsed.map((row) => {
  const rank = binarySearchRank(row.revenue, sortedRevenues);
  const percentile = sortedRevenues.length > 0 ? (rank / sortedRevenues.length) * 100 : 0;
  // ...
  return {
    // ...
    tier: classifyOutletTier(percentile, tierConfig),
    // ...
  };
});
```

**What changes for Phase 9:**
1. `GROUP BY kiosks.id` not `locations.id`.
2. `JOIN kiosks JOIN sales_records ON sales_records.outlet_code = kiosks.outlet_code` (per-kiosk).
3. Eligibility WHERE: `kiosks.archived_at IS NULL AND kiosks.outlet_code IS NOT NULL AND kiosks.alert_silenced_at IS NULL AND kiosks.pipeline_stage_id = $liveStageId` (resolved via `appSettings.pipeline_stage_id_live`).
4. Trailing window: `transaction_date >= NOW() - INTERVAL '$windowDays days'` where `windowDays` reads from `appSettings.underperformance_window_days`.
5. Returns `Array<{ kioskId, locationId, internalPocId, kioskRowIdHumanFacing, locationName, region, revenue, percentile, tier }>`.
6. **DO NOT call `getOutletTiers()`** — anti-pattern (per-location, 4-tier wrong shape).

**Threshold reader pattern that CAN be cloned (`src/lib/analytics/thresholds-server.ts` lines 41-80):**
```typescript
const OUTLET_TIER_DEFAULTS: OutletTierConfig = { top: 80, mid: 50, bottom: 20 };

export const getOutletTierThresholdsCached = unstable_cache(
  async (): Promise<OutletTierConfig> => {
    const rows = await db
      .select()
      .from(appSettings)
      .where(
        inArray(appSettings.key, [
          "threshold_outlet_tier_top",
          "threshold_outlet_tier_mid",
          "threshold_outlet_tier_bottom",
        ]),
      );

    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      top: Number(map.get("threshold_outlet_tier_top") ?? OUTLET_TIER_DEFAULTS.top),
      mid: Number(map.get("threshold_outlet_tier_mid") ?? OUTLET_TIER_DEFAULTS.mid),
      bottom: Number(map.get("threshold_outlet_tier_bottom") ?? OUTLET_TIER_DEFAULTS.bottom),
    };
  },
  ["analytics", "outlet_tier_thresholds", "v1"],
  { revalidate: 86400, tags: ["analytics", OUTLET_TIER_THRESHOLDS_TAG, "outlet_tiers"] },
);
```

Phase 9 reuses this reader as-is — does not write a new threshold reader.

---

### `src/emails/poc-underperformance.tsx` (NEW — email-template)

**Analog:** `src/emails/password-changed.tsx` (full file — clone target)

**Imports (lines 1-5):**
```typescript
import { Heading, Section, Text } from "@react-email/components";

import { BRAND } from "./brand";
import { CTA } from "./_cta";
import { EmailLayout } from "./_layout";
```
Phase 9 adds `Link` to the `@react-email/components` import (already used in `_layout.tsx`).

**Component shape (lines 20-103) — props-driven, `EmailLayout` wrapper, brand-token inline styles, tinted-panel `Section`, `<CTA>` button:**
```typescript
export function PasswordChangedEmail({
  changedAt,
  contactAdminUrl,
}: {
  changedAt: string;
  contactAdminUrl: string;
}) {
  return (
    <EmailLayout preheader="Your WeKnow password was changed">
      <Heading
        as="h1"
        style={{
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: BRAND.graphite,
          margin: "0 0 14px",
          lineHeight: 1.2,
        }}
      >
        Your password was changed
      </Heading>
      <Text style={{
        fontSize: "15px",
        lineHeight: 1.6,
        color: BRAND.textSecondary,
        margin: "0 0 18px",
      }}>
        The password on your {BRAND.productName} account was just updated.
      </Text>

      <Section style={{
        backgroundColor: BRAND.azure20,
        borderLeft: `3px solid ${BRAND.azure}`,
        borderRadius: "6px",
        padding: "14px 16px",
        margin: "0 0 24px",
      }}>
        {/* tinted info panel — clone for each kiosk row in Phase 9 */}
      </Section>

      <CTA href={contactAdminUrl} label="Contact admin" />
    </EmailLayout>
  );
}
```

Phase 9 props (RESEARCH § Code Examples lines 571-617): `pocName, kiosks: KioskRow[], moreCount, windowDays, runIsoWeek` — kiosks rendered as a tinted-panel-per-row `Section`, CTA points at `${BRAND.prodUrl}/analytics/portfolio`. Cap kiosk count at 25 per Pitfall 3.

---

### `src/emails/text-versions.ts` (modify — email-template-text)

**Analog:** `src/emails/text-versions.ts` § `passwordChangedText` (lines 62-80)

**Pattern — pure string-builder, ends with `FOOTER`:**
```typescript
const FOOTER = "—\nWeKnow Group · Confidential, internal use only";

export function passwordChangedText({
  changedAt,
  contactAdminEmail,
}: {
  changedAt: string;
  contactAdminEmail: string;
}): string {
  return [
    "Your WeKnow password was changed",
    "",
    `The password on your WeKnow Command Centre account was just updated.`,
    "",
    `Changed at: ${changedAt}`,
    "",
    `If this wasn't you, please contact your administrator immediately so they can review and lock the account: ${contactAdminEmail}`,
    "",
    FOOTER,
  ].join("\n");
}
```

Phase 9 adds `pocUnderperformanceText({ pocName, kiosks, moreCount, windowDays })` returning a similar plain-text body.

---

### `src/app/(app)/admin/performance-alerts/page.tsx` (NEW — admin-route, RSC, read)

**Analog:** `src/app/(app)/admin/cache/page.tsx` (full file)

**Pattern — full file (lines 1-34):**
```typescript
import { requireRole } from "@/lib/rbac";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/layout/page-header";
import { CachePurgePanel } from "./cache-purge-panel";

export default async function AdminCachePage() {
  await requireRole("admin");

  const recentPurges = await db
    .select({
      id: auditLogs.id,
      actorName: auditLogs.actorName,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, "cache"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Cache management"
        description="Invalidate cached analytics data. Emergency use — caches expire automatically every 24h."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <CachePurgePanel recentPurges={recentPurges} />
      </div>
    </div>
  );
}
```

Phase 9 page also queries `kioskPerformanceAlertState` (counts grouped by `tier`) and `emailLog` (filtered to `kind='underperforming_poc'`) for the metadata panel. Audit query filter changes to `eq(auditLogs.entityType, "performance_alert_run")`.

---

### `src/app/(app)/admin/performance-alerts/run-now-button.tsx` (NEW — admin-component)

**Analog:** `src/app/(app)/admin/cache/cache-purge-panel.tsx` (full file)

**Pattern — `'use client'` + `useTransition` + `toast.success/error` (lines 1-54):**
```typescript
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { purgeAnalyticsCache, type AnalyticsPurgeScope } from "./actions";

export function CachePurgePanel({ recentPurges }: Props) {
  const [scope, setScope] = useState<AnalyticsPurgeScope>("all");
  const [pending, startTransition] = useTransition();

  const handlePurge = () => {
    startTransition(async () => {
      try {
        const result = await purgeAnalyticsCache(scope);
        toast.success(`Purged ${result.tag}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Purge failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Invalidate cache</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={handlePurge} disabled={pending} className="max-w-sm">
            {pending ? "Purging…" : "Purge cache"}
          </Button>
        </CardContent>
      </Card>
      {/* ... recent purges card ... */}
    </div>
  );
}
```
Phase 9 button reads "Run now" / "Queueing run…" — calls `triggerRunNow()` server action and shows `toast.success("Run queued — refresh in ~30 seconds")`.

---

### `src/app/(app)/admin/performance-alerts/actions.ts` (NEW — server-action, dispatch)

**Analog:** `src/app/(app)/admin/cache/actions.ts` (full file, lines 1-26)

**Pattern — `'use server'` + RBAC gate + side-effect + audit:**
```typescript
'use server';
import { revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';

export type AnalyticsPurgeScope =
  | 'all' | 'portfolio' | 'regions' | /* ... */ | 'thresholds';

export async function purgeAnalyticsCache(scope: AnalyticsPurgeScope) {
  const session = await requireRole('admin');
  const tag = scope === 'all' ? 'analytics' : `analytics:${scope}`;
  revalidateTag(tag, 'max');
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: 'cache',
    entityId: tag,
    entityName: tag,
    action: 'purge',
  });
  return { success: true as const, tag };
}
```

Phase 9 `triggerRunNow()` shape (RESEARCH § Pattern 4 lines 240-261):
```typescript
'use server';
import { inngest } from "@/inngest/client";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

export async function triggerRunNow() {
  const session = await requireRole("admin");
  const minuteBucket = Math.floor(Date.now() / 60_000);
  await inngest.send({
    id: `performance-alerts-manual-${session.user.id}-${minuteBucket}`,
    name: "performance-alerts/run.requested",
    data: { actorId: session.user.id, actorName: session.user.name },
  });
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name ?? "unknown",
    entityType: "performance_alert_run",  // NEW union member — see audit.ts modify below
    entityId: "performance_alert_run",
    entityName: "Performance Alert Run",
    action: "trigger",  // NEW union member
  });
  return { ok: true };
}
```

---

### `src/app/(app)/kiosks/[id]/silence-actions.ts` (NEW — server-action, mutate)

**Analog (shape):** `src/app/(app)/admin/cache/actions.ts` (RBAC + audit pattern). 
**Analog (kiosk-mutation):** `src/app/(app)/kiosks/actions.ts` § `updateKioskField` (lines 288-345) — RBAC, allow-list narrowing, audit.

**Allow-list pattern (kiosks/actions.ts lines 282-302):**
```typescript
"internalPocId",
"notes",
] as const;

export type EditableKioskField = (typeof EDITABLE_KIOSK_FIELDS)[number];

export async function updateKioskField(
  kioskId: string,
  field: string,
  value: string | boolean | null,
  oldValue?: string
) {
  try {
    const session = await requireRole("admin", "member");
    if (!(EDITABLE_KIOSK_FIELDS as readonly string[]).includes(field)) {
      return { error: `Invalid field: ${field}` };
    }
    // ...
```

Phase 9 silence action is admin-only (`requireRole("admin")` not `"admin", "member"`) and does not extend the existing allow-list — it's a separate action because the silencing semantics include the `reason` text and a dedicated audit shape.

---

### `src/app/api/inngest/route.ts` (modify — route-mount, dispatch)

**Analog:** `src/app/api/inngest/route.ts` (current full file, lines 1-9)

**Pattern (full file):**
```typescript
import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { sendEmailFn } from "@/inngest/functions/send-email";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendEmailFn],
});
```

Phase 9 adds `weeklyPocAlertsFn` to the `functions: [...]` array.

---

### `src/lib/audit.ts` (modify — type-extension)

**Analog:** `src/lib/audit.ts` (full current file)

**Closed unions to extend (lines 13 + 17-35):**
```typescript
entityType: "kiosk" | "location" | "installation" | "user" | "sales_import" | "analytics_preset" | "outlet_exclusion" | "business_event" | "event_category" | "impersonation" | "app_setting" | "location_flag" | "experiment_cohort" | "action_item" | "commission_ledger" | "product_code_fallback" | "cache" | "system";

action:
  | "create"
  | "update"
  | /* ... */
  | "monday_import_triggered";
```

Phase 9 extends:
- `entityType` adds `"performance_alert_run"` and `"kiosk_alert_silence"` (or piggybacks on `"kiosk"` entityType + a new `field='alert_silenced_at'` audit row — planner's discretion).
- `action` adds `"trigger"` (for run-now) and `"silence"` + `"unsilence"` (for kiosk silencing).

RESEARCH Assumption A6 confirms the underlying DB column is free-form text (`audit_logs.action: text("action").notNull()`), so this is a TypeScript-level union extension only — no migration.

---

## Shared Patterns

### Authentication / RBAC
**Source:** `src/lib/rbac.ts` (lines 25-31)
**Apply to:** All admin routes (admin page, run-now action, silence action, silence panel)
```typescript
export async function requireRole(...roles: Role[]) {
  const session = await getSessionOrThrow();
  if (!roles.includes(session.user.role as Role)) {
    throw new Error("Forbidden");
  }
  return session;
}
```
Call shape: `const session = await requireRole("admin");`. The RSC (`page.tsx`) calls it for read; the server action calls it for write. Both return the same session shape.

### Audit-log writes
**Source:** `src/lib/audit.ts` § `writeAuditLog` (lines 9-59)
**Apply to:** Every server action in this phase (run-now, silence, unsilence) AND the cron's `step.run("write-run-audit", ...)`.
```typescript
await writeAuditLog({
  actorId: session.user.id,
  actorName: session.user.name,
  entityType: 'cache',
  entityId: tag,
  entityName: tag,
  action: 'purge',
});
```
For the cron's `write-run-audit` step, `actorId` = `"system"` (per existing convention from ETL paths) and `actorName` = `"weekly-poc-alerts cron"` or the manual-trigger user when invoked via "Run now".

### Inngest event-emission (`inngest.send`)
**Source:** `src/app/api/account/password-changed/route.ts` (lines 80-98)
**Apply to:** Run-now server action; cron's `step.run("emit-poc-emails", ...)` (which uses `step.sendEvent` instead — see Pattern 5).
```typescript
await inngest.send({
  name: "email/send.requested",
  data: {
    kind: "password_changed",
    to: session.user.email,
    subject: "Your WeKnow password was changed",
    template: "password-changed",
    templateProps: { /* ... */ },
  },
});
```

For the cron's `emit-poc-emails` step, use `step.sendEvent("emit-poc-emails", events)` (RESEARCH § Pattern 5) which is the durable-step equivalent — different from a top-level `inngest.send` call. The wire-shape `{ name, data: { kind, to, subject, template, templateProps, payloadHash } }` is identical to the password-changed call site above.

### Resend lazy-init pattern
**Source:** `src/inngest/functions/send-email.ts` (lines 26-31)
**Apply to:** N/A this phase (the cron does not call Resend directly — fan-out to `sendEmailFn` handles it). Reproduced here for the planner's awareness if a future plan re-introduces the sync send path.
```typescript
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM = process.env.EMAIL_FROM ?? "noreply@command.weknowgroup.com";
```

### Brand tokens for email templates
**Source:** `src/emails/brand.ts` (full file)
**Apply to:** `poc-underperformance.tsx` template (clone-and-modify of `password-changed.tsx`)
```typescript
export const BRAND = {
  azure: "#00A6D3",
  graphite: "#121212",
  azure20: "#CCEDF6",
  textSecondary: "#3F3F3F",
  // ...
  productName: "WeKnow Command Centre",
  prodUrl: "https://wkg-command-centre.vercel.app",
} as const;
```
Use `BRAND.azure20` for tinted-panel backgrounds, `BRAND.azure` for left borders / CTA, `BRAND.graphite` for headings, `BRAND.textSecondary` for body. Kiosk-detail deep links use `${BRAND.prodUrl}/kiosks/${uuid}`; portfolio CTA uses `${BRAND.prodUrl}/analytics/portfolio`.

### Drizzle `onConflictDoNothing` against partial unique idx
**Source:** `src/inngest/functions/send-email.ts` § `step.run("log", ...)` (lines 111-133)
**Apply to:** Skip-row insert in cron's `emit-skip-rows` step (and any other email_log insert path Phase 9 touches).
```typescript
await db
  .insert(emailLog)
  .values({
    kind,
    recipient: to,
    resendMessageId: sendResult.data?.id ?? null,
    inngestRunId: runId,
    status: sendResult.error ? "failed" : "sent",
    lastError: /* ... */,
    payloadHash: payloadHash ?? null,
  })
  .onConflictDoNothing({
    target: [emailLog.kind, emailLog.payloadHash],
    where: sql`payload_hash IS NOT NULL`,  // partial-idx predicate must be re-stated
  });
```
**Critical:** the `where: sql\`payload_hash IS NOT NULL\`` clause is required for Postgres to match the partial unique index — without it the upsert path silently no-ops. RESEARCH Pitfall 5 + send-email.ts comment (lines 127-131) explain this.

### Testcontainers integration-test scaffold
**Source:** `tests/email/send-email-fn.integration.test.ts` (full file, especially lines 1-56)
**Apply to:** All `tests/performance-alerts/*.integration.test.ts` and `tests/kiosks/silence-toggle.integration.test.ts`
```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() { return dbRef; },
}));

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

function makeStepShim() {
  return {
    run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
  };
}

describe("...", () => {
  let ctx: TestDbContext;
  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    process.env.RESEND_API_KEY = "re_test_key";
  }, 180_000);
  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });
  beforeEach(async () => {
    sendMock.mockReset();
    await ctx.db.delete(emailLog);
  });
  // tests ...
});
```
Phase 9 integration tests drive `_handleWeeklyPocAlerts({ step: makeStepShim(), runId })` against the mocked Resend + real Testcontainers Postgres seeded with the synthetic kiosk fleet (RESEARCH § Synthetic test fixtures table).

### Idempotency-test pattern (existing test to swap)
**Source:** `tests/email/send-email-fn.integration.test.ts` (lines 119-158) — the test comment explicitly invites Phase 9 to swap `template: "password-changed"` to `template: "poc-underperformance"`.
**Apply to:** `tests/performance-alerts/idempotency.integration.test.ts` (Wave 0 gap from RESEARCH § Test Map row e).

### Playwright admin spec
**Source:** `tests/admin/cache-purge.spec.ts` (full file)
**Apply to:** `tests/admin/performance-alerts.spec.ts` and `tests/kiosks/silence.spec.ts`
```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@admin/cache purge", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });
  test("admin can purge portfolio cache and see audit log entry", async ({ page }) => {
    await page.goto("/admin/cache");
    await expect(page.getByRole("heading", { name: /cache management/i })).toBeVisible();
    await page.getByRole("button", { name: /purge/i }).click();
    await expect(page.getByText(/purged analytics:portfolio/i)).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.getByText("analytics:portfolio").first()).toBeVisible({ timeout: 5000 });
  });
});
```

---

## No Analog Found (Novel Files)

Files with no close codebase match — planner composes from RESEARCH.md spec + first principles:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/performance-alerts/classify-kiosks.ts` | analytics-reader | read | `getOutletTiers` is per-LOCATION + 4-tier; new SQL is per-KIOSK + 3-tier (top/mid/bottom). RESEARCH § Anti-Patterns + § Deprecated/Outdated explicitly forbid cloning `getOutletTiers`. The percentile-rank shape (binarySearchRank + sorted-array) and threshold-reader integration ARE clonable; the SQL body is novel. |
| `src/lib/performance-alerts/classify-dispatch.ts` | utility (pure) | classify | No prior pure decision-table function exists. Spec is RESEARCH § Code Examples lines 530-558. |
| `src/lib/performance-alerts/iso-week.ts` | utility (pure) | transform | No prior ISO-week computation in the codebase. Standard library + `Intl.DateTimeFormat` is the spec. |

All three files are **pure-functional** with no side effects — easy to unit-test in isolation (Wave 0 gaps cover them). The cron orchestrates them.

---

## Metadata

**Analog search scope:**
- `src/inngest/**` (4 files read)
- `src/emails/**` (5 files read)
- `src/db/schema.ts` (relevant ranges only)
- `src/lib/{rbac,audit,analytics/{thresholds-server,metrics,queries/portfolio}}.ts` (verified)
- `src/app/api/{inngest,account/password-changed}/route.ts`
- `src/app/(app)/admin/cache/{page,actions,cache-purge-panel}.tsx`
- `src/app/(app)/kiosks/[id]/page.tsx` + `kiosks/actions.ts` (relevant ranges)
- `migrations/0033, 0041, 0042` (DDL + appSettings seed shapes)
- `tests/email/*.test.ts`, `tests/admin/cache-purge.spec.ts`
- `src/emails/__tests__/helpers/render-snapshot.ts`

**Files scanned:** ~30 files, all read-only.

**Pattern extraction date:** 2026-05-09
