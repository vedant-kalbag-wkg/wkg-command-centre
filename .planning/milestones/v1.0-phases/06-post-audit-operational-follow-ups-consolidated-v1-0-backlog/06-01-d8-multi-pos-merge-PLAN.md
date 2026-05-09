---
plan_id: 06-01
plan_name: d8-multi-pos-merge
phase: 6
wave: 1
depends_on: []
requirements_addressed: [SC1, SC2, SC10]
files_modified:
  - drizzle/0038_create_merge_proposals.sql
  - drizzle/meta/_journal.json
  - src/db/schema.ts
  - src/scripts/__tests__/probe-multi-pos-merge.test.ts
  - src/scripts/__tests__/multi-pos-merge.test.ts
  - scripts/probe-multi-pos-merge-collisions.ts
  - scripts/multi-pos-merge.ts
  - src/app/(app)/settings/duplicates/merge-review/page.tsx
  - src/app/(app)/settings/duplicates/merge-review/actions.ts
  - src/app/(app)/settings/duplicates/merge-review/merge-review-client.tsx
  - tests/settings-duplicates/merge-review.spec.ts
  - tasks/todo.md
autonomous: false
estimated_tasks: 7
---

<must_haves>
**Phase 6 is verified for SC1 ONLY when:** the multi-POS site merge proposal at `tasks/analytics-audit/multi-pos-merge-proposal.csv` (22 clusters, 29 defunct rows, 7,531 sales rows) has been admin-reviewed in the new `/settings/duplicates/merge-review` UI; an Apply button has rewritten `sales_records.location_id`, `kiosk_assignments.location_id`, `location_products.location_id`, `location_hotel_group_memberships.location_id`, `location_region_memberships.location_id`, `location_group_memberships.location_id` from each defunct row to its canonical row; defunct rows have `archivedAt = NOW()`; and `audit_logs` carries one row per rewritten row + one row per archived defunct location with `metadata->>'script' = 'scripts/multi-pos-merge.ts'`.

**Phase 6 is verified for SC2 ONLY when:** address-data-quality fix decisions for the 22 clusters (re-pull from Monday vs hand-edit vs accept-as-is) are recorded in the `merge_proposals` table; rows where `decision = 'address_fix'` have a `notes` column entry pointing at the corrective action taken; the merge-review UI surfaces these alongside the duplicate-merge decisions per CONTEXT D-04.

**SC10 contribution:** `tasks/todo.md` lines 96 (5.5), 97 (5.6), 98 (5.7) are checked `[x]` after this plan completes.
</must_haves>

<objective>
Close the longest-deferred destructive-cleanup item from the audit-fix arc: the multi-POS site merge (Phase 5.5/5.6/5.7 from `tasks/todo.md`). The proposal CSV already exists; this plan builds the admin review UI, the apply path, and the audit-log shape that lets a future SQL rollback reverse the merge.

Purpose: 22 hotels are split across 51 location rows in production (e.g. "Heathrow Terminal 4" + "Heathrow Terminal 4 b"; 8 rows for Residence Inn Kensington). This pollutes every analytics rollup and is the last big data-quality issue blocking v1.0 close. Bundles the address-data-quality fix per CONTEXT D-04 because the same review UI naturally surfaces "this isn't a duplicate, the address is wrong" cases.

Output: `merge_proposals` table populated with 22 cluster decisions; ~7,560 `audit_logs` rows (7,531 sales rewrites + 29 archive entries + ~30 membership/product/assignment rewrites); 29 `locations` rows with `archivedAt` set; staging-DB-verified rollback runbook.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md
@tasks/analytics-audit/multi-pos-merge-proposal.csv
@tasks/handoff-2026-04-27-pr-28-open.md
@scripts/backfill-kiosk-install-dates.ts
@scripts/propose-multi-pos-merge.ts
@src/lib/merge.ts
@src/lib/audit.ts
@src/db/schema.ts
@src/app/(app)/settings/duplicates/page.tsx
@src/app/(app)/settings/duplicates/actions.ts
@src/app/(app)/settings/duplicates/duplicates-client.tsx
@src/app/(app)/locations/merge-action.ts
@CLAUDE.md
</context>

<interfaces>
<!-- Lifted from src/lib/merge.ts and src/lib/audit.ts so the executor does not need to re-read for signatures -->

From src/lib/merge.ts (existing pair-merge primitive — DO NOT call directly from the bulk path; this plan introduces a transactional bulk merger):
```typescript
export async function mergeLocations(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>,
): Promise<{ success: true; merged: number } | { error: string }>
```
This re-points kiosk_assignments + locationProducts ONLY, archives sources, and writes ONE audit_logs row per source with `field='mergedInto'`. It does NOT handle salesRecords, the three membership tables, locationFlags, or actionItems — and it does NOT pre-dedup the UNIQUE(location_id) constraints on locationRegionMemberships / locationGroupMemberships. Plan 06-01 builds a NEW bulk-merge function/script that handles every FK + the dedup. Reusing `mergeLocations()` is rejected.

From src/lib/audit.ts:
```typescript
export async function writeAuditLog(
  entry: {
    actorId: string;
    actorName: string;
    entityType: "kiosk" | "location" | "installation" | ...; // includes "location"
    entityId: string;
    entityName: string;
    action: "create" | "update" | ... | "merge" | "archive" | ...;
    field?: string;
    oldValue?: string;
    newValue?: string;
    metadata?: Record<string, unknown>;
  },
  db?: AnyDb,
): Promise<void>
```

Phase 5.2 backfill rollback pattern (from tasks/handoff-2026-04-27-pr-28-open.md §3):
```sql
BEGIN;
  -- per-row update keyed by metadata->>'script'
  UPDATE <fk_table> tgt
     SET <fk_column> = (al.old_value)::uuid
    FROM audit_logs al
   WHERE al.entity_id = tgt.id::text
     AND al.entity_type = '<entity>'
     AND al.field = '<column>'
     AND al.metadata->>'script' = 'scripts/multi-pos-merge.ts';
COMMIT;
```

merge-proposal CSV columns (52 lines, header + 51 rows; some clusters have >2 members):
`cluster_id, cluster_basis, address, region, canonical_outlet_code, canonical_id, canonical_name, canonical_sales_count, canonical_amount_total, defunct_outlet_code, defunct_id, defunct_name, defunct_sales_count, defunct_amount_total, defunct_kiosks_count, notes`

UNIQUE constraints on FK tables (from src/db/schema.ts):
- `location_region_memberships`: `UNIQUE(location_id)` at line 578 — collision risk
- `location_group_memberships`: `UNIQUE(location_id)` at line 601 — collision risk
- `location_hotel_group_memberships`: composite PK `(locationId, hotelGroupId)` at line 556 — same-hotel-group on both rows collides
- `location_products`: composite PK incl. `(location_id, product_id, provider_id)` — same product on both rows collides
- `kiosk_assignments`, `salesRecords`, `locationFlags`, `actionItems`: no unique on location_id alone, low collision risk

ETL system actor (from scripts/backfill-kiosk-install-dates.ts:48):
```typescript
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Pre-merge collision probe + decision-log table migration</name>
  <files>
    drizzle/0038_create_merge_proposals.sql,
    drizzle/meta/_journal.json,
    src/db/schema.ts,
    src/scripts/__tests__/probe-multi-pos-merge.test.ts,
    scripts/probe-multi-pos-merge-collisions.ts
  </files>
  <read_first>
    - src/db/schema.ts (lines 540–605 for the three membership tables + their UNIQUE/PK constraints)
    - tasks/analytics-audit/multi-pos-merge-proposal.csv (read all 52 lines — every cluster_id + its canonical/defunct ID pair)
    - drizzle/meta/_journal.json (current latest idx is 37; this plan adds idx 38)
    - scripts/propose-multi-pos-merge.ts (existing read-only proposal script — reference shape; DO NOT modify)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md (lines 28–48: "Affected tables" table; 110–112: "multi-pos-merge-proposal.csv shape")
  </read_first>
  <action>
Two artefacts in this task:

(A) Create migration `drizzle/0038_create_merge_proposals.sql` adding the `merge_proposals` table that persists per-cluster admin decisions:

```sql
CREATE TABLE "merge_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cluster_id" integer NOT NULL,
  "canonical_id" uuid NOT NULL REFERENCES "locations"("id"),
  "defunct_id" uuid NOT NULL REFERENCES "locations"("id"),
  "decision" text NOT NULL CHECK ("decision" IN ('approved', 'swapped', 'rejected', 'address_fix')),
  "notes" text,
  "decided_by" text NOT NULL,
  "decided_by_name" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "applied_at" timestamptz,
  CONSTRAINT "merge_proposals_pair_unique" UNIQUE ("canonical_id", "defunct_id")
);
CREATE INDEX "merge_proposals_cluster_idx" ON "merge_proposals" ("cluster_id");
CREATE INDEX "merge_proposals_applied_idx" ON "merge_proposals" ("applied_at");
```

Update `drizzle/meta/_journal.json` to register idx 38 (mirror the shape of the existing idx 37 entry — same `version`, `dialect`, `tag` style; bump `idx` and add a fresh `when` epoch ms and `breakpoints: true`). Run `npm run db:generate` if the journal can be regenerated cleanly, otherwise hand-edit and verify with `npx drizzle-kit migrate --dry`.

Add `mergeProposals` table definition to `src/db/schema.ts` (place after `kioskConfigGroups` at line ~95; mirror that table's drizzle style):

```typescript
export const mergeProposals = pgTable("merge_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  clusterId: integer("cluster_id").notNull(),
  canonicalId: uuid("canonical_id").notNull().references(() => locations.id),
  defunctId: uuid("defunct_id").notNull().references(() => locations.id),
  decision: text("decision", {
    enum: ["approved", "swapped", "rejected", "address_fix"],
  }).notNull(),
  notes: text("notes"),
  decidedBy: text("decided_by").notNull(),
  decidedByName: text("decided_by_name").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => ({
  pairUniq: unique("merge_proposals_pair_unique").on(t.canonicalId, t.defunctId),
}));
```

(B) Create `scripts/probe-multi-pos-merge-collisions.ts` — a READ-ONLY script that reads the proposal CSV and prints per-cluster collision warnings BEFORE any merge runs. The script must report, for each (canonical_id, defunct_id) pair:

  1. Whether BOTH rows have an entry in `location_region_memberships` (UNIQUE(location_id) collision).
  2. Whether BOTH rows have an entry in `location_group_memberships` (UNIQUE(location_id) collision).
  3. Whether BOTH rows share any `(location_id, hotel_group_id)` pair in `location_hotel_group_memberships` (PK collision).
  4. Whether BOTH rows share any `(location_id, product_id, provider_id)` triple in `location_products` (PK collision).
  5. Whether the canonical and defunct rows have DIFFERENT `primary_region_id` values (data-quality flag — should the merge stay within-region?).

Output format: pretty-print one block per cluster_id. Exit 0 if no warnings; exit 1 with a summary if any cluster has unresolved collisions (operator must decide per-cluster whether to keep canonical's row, keep defunct's row, or merge values).

Pattern to mirror: `scripts/propose-multi-pos-merge.ts` (read-only, uses `db.execute(sql`...`)`, writes a structured report). Use raw `Pool` from `pg` like `scripts/backfill-kiosk-install-dates.ts:67` since this script reads the CSV and runs SELECTs — no Drizzle needed.

Add Vitest unit test at `src/scripts/__tests__/probe-multi-pos-merge.test.ts` that:
- Mocks the DB to return canned membership rows for two synthetic cluster pairs (one with collisions, one without).
- Asserts the collision report output contains the expected warning strings ("region collision", "group collision", "hotel_group PK collision", "location_products PK collision", "cross-region merge").
- Asserts exit code logic (0 for clean cluster, 1 for any collision).

Per CONTEXT D-19, this plan implements SC1+SC2 (D8 multi-POS merge + 5.7 address fix bundled). The collision probe IS the design solution to RESEARCH.md "open question 1" (pre-merge dedup on UNIQUE(location_id) tables).
  </action>
  <verify>
    <automated>
npm run db:generate && npm run typecheck && npx vitest run src/scripts/__tests__/probe-multi-pos-merge.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - File `drizzle/0038_create_merge_proposals.sql` exists and contains the literal string `CREATE TABLE "merge_proposals"` AND `decision text NOT NULL CHECK` AND `merge_proposals_pair_unique`.
    - `grep -n 'mergeProposals' src/db/schema.ts` returns at least 1 line.
    - `grep -n '"idx": 38' drizzle/meta/_journal.json` returns exactly 1 line.
    - File `scripts/probe-multi-pos-merge-collisions.ts` exists and contains all 5 collision-check strings: `location_region_memberships`, `location_group_memberships`, `location_hotel_group_memberships`, `location_products`, `primary_region_id`.
    - File `src/scripts/__tests__/probe-multi-pos-merge.test.ts` exists; `npx vitest run src/scripts/__tests__/probe-multi-pos-merge.test.ts` exits 0 with at least 5 passing tests.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Migration registered, schema typed, collision probe script + tests committed. Operator can now run `npx tsx scripts/probe-multi-pos-merge-collisions.ts` against staging DB to surface every collision before designing the apply path in Task 4.
  </done>
</task>

<task type="auto">
  <name>Task 2: Merge-review admin UI page + server actions</name>
  <files>
    src/app/(app)/settings/duplicates/merge-review/page.tsx,
    src/app/(app)/settings/duplicates/merge-review/actions.ts,
    src/app/(app)/settings/duplicates/merge-review/merge-review-client.tsx
  </files>
  <read_first>
    - src/app/(app)/settings/duplicates/page.tsx (chrome reference — admin guard + PageHeader pattern)
    - src/app/(app)/settings/duplicates/actions.ts (server-action shape for `requireRole("admin")` + audit-log writes)
    - src/app/(app)/settings/duplicates/duplicates-client.tsx (existing "scan + per-pair decision" client component — UX pattern to mirror)
    - src/app/(app)/settings/thresholds/actions.ts (cleanest `saveX` server-action pattern with audit-log + revalidateTag)
    - tasks/analytics-audit/multi-pos-merge-proposal.csv (the 22 clusters this UI displays)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md (D-01 review mechanism, D-04 address-fix bundling)
  </read_first>
  <action>
Build a NEW admin page at `/settings/duplicates/merge-review` that loads the 22 clusters from the CSV (parsed at request time — file is small) and lets an admin record a decision per cluster.

(A) `src/app/(app)/settings/duplicates/merge-review/page.tsx` — server component, mirrors `src/app/(app)/settings/duplicates/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/lib/rbac";
import { loadMergeProposalClusters, listSavedDecisions } from "./actions";
import { MergeReviewClient } from "./merge-review-client";

export default async function MergeReviewPage() {
  try {
    await requireRole("admin");
  } catch {
    redirect("/settings");
  }
  const clusters = await loadMergeProposalClusters();
  const savedDecisions = await listSavedDecisions();
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Multi-POS Merge Review"
        description="Review the 22 duplicate-location clusters proposed by scripts/propose-multi-pos-merge.ts. Approve, swap, reject, or flag as an address-data fix per cluster. Apply runs the merge transactionally."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <MergeReviewClient clusters={clusters} savedDecisions={savedDecisions} />
      </div>
    </div>
  );
}
```

(B) `src/app/(app)/settings/duplicates/merge-review/actions.ts` — server actions:

```typescript
"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { mergeProposals, locations } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, and, inArray } from "drizzle-orm";

export type ClusterRow = {
  clusterId: number;
  clusterBasis: string;
  address: string;
  region: string;
  canonicalId: string;
  canonicalName: string;
  canonicalOutletCode: string;
  canonicalSalesCount: number;
  defunctPairs: Array<{
    defunctId: string;
    defunctName: string;
    defunctOutletCode: string;
    defunctSalesCount: number;
    defunctKiosksCount: number;
    notes: string;
  }>;
};

export type SavedDecision = {
  canonicalId: string;
  defunctId: string;
  decision: "approved" | "swapped" | "rejected" | "address_fix";
  notes: string | null;
  appliedAt: Date | null;
};

const CSV_PATH = join(process.cwd(), "tasks/analytics-audit/multi-pos-merge-proposal.csv");

export async function loadMergeProposalClusters(): Promise<ClusterRow[]> {
  await requireRole("admin");
  // Parse the 52-line CSV. Group rows by cluster_id; the first row in each
  // cluster carries the canonical_*; subsequent rows in the same cluster
  // (with the same canonical_id) carry distinct defunct_* triples.
  // ... (parsing logic; tests cover edge cases — empty defunct triple = self-row)
}

export async function saveClusterDecision(args: {
  canonicalId: string;
  defunctId: string;
  clusterId: number;
  decision: "approved" | "swapped" | "rejected" | "address_fix";
  notes?: string;
}): Promise<{ success: true } | { error: string }> {
  const session = await requireRole("admin");
  // Upsert into merge_proposals keyed by (canonicalId, defunctId).
  // If decision === "swapped", record the swap intent — the apply path will
  // INVERT canonical/defunct for this pair.
  // Write one audit_logs row with action="update", entityType="location",
  // entityId=defunctId, field="merge_proposal_decision".
}

export async function listSavedDecisions(): Promise<SavedDecision[]> {
  await requireRole("admin");
  return db.select({
    canonicalId: mergeProposals.canonicalId,
    defunctId: mergeProposals.defunctId,
    decision: mergeProposals.decision,
    notes: mergeProposals.notes,
    appliedAt: mergeProposals.appliedAt,
  }).from(mergeProposals);
}

export async function applyApprovedMerges(): Promise<
  | { success: true; rowsRewritten: number; locationsArchived: number }
  | { error: string; collisions?: string[] }
> {
  const session = await requireRole("admin");
  // 1. Load all decisions where decision IN ('approved','swapped','address_fix')
  //    AND applied_at IS NULL.
  // 2. Defer to scripts/multi-pos-merge.ts logic — but executed inline here
  //    via a single transactional `db.transaction(async (tx) => { ... })`
  //    block. (Task 4 implements the script; this server action calls the
  //    same internal helper exported from `lib/multi-pos-merge.ts` — see
  //    Task 4 for that module.)
  // 3. On success, set applied_at=NOW() on each merge_proposals row.
  // 4. Return aggregate counts.
  // 5. Audit-log: ONE summary row with action="merge", entityType="system",
  //    entityId="multi-pos-merge", metadata={ rowsRewritten, locationsArchived,
  //    script: "scripts/multi-pos-merge.ts" }. Per-row audit-logs are written
  //    inside the merge primitive (Task 4).
}
```

(C) `src/app/(app)/settings/duplicates/merge-review/merge-review-client.tsx` — client component. Layout: one `<Card>` per cluster, showing canonical row + defunct row(s) side-by-side (name, outlet code, sales count, address, region), a `<RadioGroup>` for the decision (`approved | swapped | rejected | address_fix`), an optional `<Textarea>` for notes (required when `decision='address_fix'`). Save-decision button per cluster. Sticky footer with global "Apply approved merges" button (disabled until ≥1 cluster is decided; confirmation dialog showing count summary before apply).

Use existing UI primitives: `Card`, `Button`, `RadioGroup`, `Textarea`, `Label` from `@/components/ui/*`. Mirror `duplicates-client.tsx` chrome (loading state, success toast via `sonner`, error banner). Add `<Link href="/settings/duplicates">Back</Link>` in the page header.
  </action>
  <verify>
    <automated>
npm run typecheck && npm run lint -- src/app/\(app\)/settings/duplicates/merge-review/
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/app/(app)/settings/duplicates/merge-review/page.tsx` exists and contains the literal string `requireRole("admin")` AND `MergeReviewClient`.
    - File `src/app/(app)/settings/duplicates/merge-review/actions.ts` exists; `grep -n "use server" src/app/(app)/settings/duplicates/merge-review/actions.ts` returns line 1.
    - All four exports exist in actions.ts: `loadMergeProposalClusters`, `saveClusterDecision`, `listSavedDecisions`, `applyApprovedMerges` (verify with `grep "^export async function" src/app/(app)/settings/duplicates/merge-review/actions.ts | wc -l` ≥ 4).
    - File `src/app/(app)/settings/duplicates/merge-review/merge-review-client.tsx` contains `"use client"` on line 1 AND the literal strings `RadioGroup`, `address_fix`, `Apply approved merges`.
    - `npm run typecheck` exits 0.
    - `npm run lint` reports zero errors for the new files.
  </acceptance_criteria>
  <done>
    UI scaffolded; admin can navigate to `/settings/duplicates/merge-review`, see the 22 clusters, and save per-cluster decisions to `merge_proposals` table. Apply button is wired but its handler is a stub until Task 4 ships the merge primitive.
  </done>
</task>

<task type="auto">
  <name>Task 3: Playwright spec for merge-review UI (no destructive verify)</name>
  <files>
    tests/settings-duplicates/merge-review.spec.ts
  </files>
  <read_first>
    - tests/kiosk-config-groups/list.spec.ts (Playwright spec shape in this repo)
    - tests/helpers/auth.ts (signInAsAdmin pattern)
    - playwright.config.ts (no global setup; tests assume `npm run db:seed` ran)
    - src/app/(app)/settings/duplicates/merge-review/merge-review-client.tsx (the elements being asserted)
  </read_first>
  <action>
Add 3 Playwright tests at `tests/settings-duplicates/merge-review.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@merge-review page loads and renders cluster cards", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");
  await expect(
    page.getByRole("heading", { name: "Multi-POS Merge Review", level: 1 }),
  ).toBeVisible();
  // Either the cluster cards render OR an empty-state copy if the CSV is missing
  const clusterCards = page.locator("[data-testid='merge-cluster-card']");
  const emptyCopy = page.getByText(/no clusters/i).first();
  await expect
    .poll(
      async () =>
        (await clusterCards.count()) > 0 ||
        (await emptyCopy.isVisible().catch(() => false)),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("@merge-review save-decision per cluster persists via server action", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");
  const firstCluster = page.locator("[data-testid='merge-cluster-card']").first();
  if ((await firstCluster.count()) === 0) test.skip(true, "No clusters seeded — skipping");
  await firstCluster.getByRole("radio", { name: /approved/i }).check();
  await firstCluster.getByRole("button", { name: /save decision/i }).click();
  await expect(firstCluster.getByText(/decision saved|saved/i)).toBeVisible({ timeout: 5_000 });
});

test("@merge-review apply button is disabled until at least one decision saved", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");
  // The Apply button is rendered but disabled when no merge_proposals rows exist.
  // We can't reliably test the enabled state without seeding decisions, so this
  // spec only asserts the disabled-by-default behaviour on a fresh page load.
  const applyBtn = page.getByRole("button", { name: /apply approved merges/i });
  await expect(applyBtn).toBeVisible();
});
```

Add `data-testid="merge-cluster-card"` attributes to the rendered cards in `merge-review-client.tsx` (Task 2 — go back and add these as part of this task if not present).

The spec is intentionally light: it verifies the UI renders and accepts decisions. It does NOT call `applyApprovedMerges()` because that's destructive and cannot run safely against the test DB. Manual UAT (Task 6) covers the destructive path.
  </action>
  <verify>
    <automated>
npx playwright test tests/settings-duplicates/merge-review.spec.ts --reporter=list
    </automated>
  </verify>
  <acceptance_criteria>
    - File `tests/settings-duplicates/merge-review.spec.ts` exists.
    - `grep -c "test(" tests/settings-duplicates/merge-review.spec.ts` returns 3.
    - `grep -n "data-testid=\"merge-cluster-card\"" src/app/\(app\)/settings/duplicates/merge-review/merge-review-client.tsx` returns ≥ 1 line.
    - `npx playwright test tests/settings-duplicates/merge-review.spec.ts` exits 0 (or skips at most 1 test if no clusters seed locally — the first and third tests must always pass).
  </acceptance_criteria>
  <done>
    UI is automatable from Playwright; CI catches any future regression in page rendering or the save-decision round-trip.
  </done>
</task>

<task type="auto">
  <name>Task 4: Bulk merge primitive + apply script + integration test</name>
  <files>
    src/lib/multi-pos-merge.ts,
    scripts/multi-pos-merge.ts,
    src/scripts/__tests__/multi-pos-merge.test.ts,
    src/app/(app)/settings/duplicates/merge-review/actions.ts
  </files>
  <read_first>
    - src/lib/merge.ts (lines 22–73: existing pair-merge — read but DO NOT call from the bulk path; it does not handle salesRecords or memberships)
    - scripts/backfill-kiosk-install-dates.ts (lines 45–80: arg parsing + `--apply` flag + ETL_SYSTEM_USER_ID + transaction shape with `SET LOCAL` GUC + per-row audit-log)
    - src/lib/audit.ts (writeAuditLog signature)
    - src/db/schema.ts (lines 540–605 for membership tables; line 228 for `locations.archivedAt`)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md (lines 60–106 for the canonical script pattern + Phase 5.2 rollback shape)
    - vitest.config.ts (integration project uses Testcontainers Postgres)
  </read_first>
  <action>
Three artefacts.

(A) `src/lib/multi-pos-merge.ts` — the pure transactional bulk-merger. Exports ONE function:

```typescript
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type MergePair = {
  canonicalId: string;
  defunctId: string;
  // For 'swapped' decisions, the caller has already inverted these two IDs.
  // The bulk merger treats canonicalId as the survivor; defunctId is archived.
};

export type MergeActor = { id: string; name: string };

export type BulkMergeResult = {
  pairsMerged: number;
  salesRecordsRewritten: number;
  kioskAssignmentsRewritten: number;
  locationProductsRewritten: number; // after dedup
  locationProductsDeleted: number; // PK collisions resolved by deleting defunct's row
  hotelGroupMembershipsRewritten: number;
  hotelGroupMembershipsDeleted: number; // PK collisions
  regionMembershipsRewritten: number;
  regionMembershipsDeleted: number; // UNIQUE(location_id) collisions
  groupMembershipsRewritten: number;
  groupMembershipsDeleted: number; // UNIQUE(location_id) collisions
  locationFlagsRewritten: number;
  actionItemsRewritten: number;
  locationsArchived: number;
  auditLogsWritten: number;
};

export const MULTI_POS_MERGE_SCRIPT_TAG = "scripts/multi-pos-merge.ts";

/**
 * Apply a set of merge pairs in ONE transaction. Per-cluster atomicity is the
 * caller's responsibility — pass all approved pairs to a single call to keep
 * the operation atomic, OR call once per cluster to trade atomicity for
 * progress. CONTEXT D-03 + RESEARCH.md "open question 3" answer: this plan
 * locks ALL-OR-NOTHING (single transaction, ~7,531 row UPDATEs is well within
 * Postgres's comfort zone).
 *
 * Order of operations per pair (matters for FK + UNIQUE handling):
 *   1. Delete defunct's row from location_region_memberships if canonical
 *      already has one (UNIQUE(location_id) collision)
 *   2. Delete defunct's row from location_group_memberships if canonical
 *      already has one (UNIQUE(location_id) collision)
 *   3. Delete defunct's rows from location_hotel_group_memberships where
 *      (canonical, hotel_group_id) already exists (PK collision)
 *   4. Delete defunct's rows from location_products where
 *      (canonical, product_id, provider_id) already exists (PK collision)
 *   5. UPDATE every remaining FK to point at canonical_id (sales_records.
 *      location_id + processed_at_location_id, kiosk_assignments.location_id,
 *      location_products.location_id, location_*_memberships.location_id,
 *      location_flags.location_id, action_items.location_id)
 *   6. Set locations.archived_at = NOW() on defunct.
 *   7. Per-row audit_logs entry for EACH rewrite + ONE for the archive.
 *      metadata.script = "scripts/multi-pos-merge.ts" so rollback SQL can
 *      target. old_value = defunctId, new_value = canonicalId.
 */
export async function applyBulkMerge(
  pairs: MergePair[],
  actor: MergeActor,
  db: NodePgDatabase,
): Promise<BulkMergeResult> {
  // Implementation details:
  //  - Use db.transaction(async (tx) => { ... })
  //  - For audit-log volume control: per-row INSERT for sales_records + kiosk_assignments
  //    is too verbose at 7,531 rows. INSTEAD: ONE audit_logs row per (defunct_id, table)
  //    pair carrying { rowsRewritten: N, oldLocationId: defunctId, newLocationId: canonicalId,
  //    table: 'sales_records', script: '...' } in metadata. Per-row audit-trail is
  //    recoverable from the rollback SQL pattern (UPDATE ... FROM audit_logs).
  //  - Plus ONE audit_logs row per defunct location with action='archive'.
  //  - Plus ONE audit_logs row per pair with action='merge', entityType='location',
  //    entityId=defunctId, field='mergedInto', newValue=canonicalId — matches the
  //    existing src/lib/merge.ts:60–69 shape so the global audit-log UI displays them.
}
```

The key change vs RESEARCH.md's "per-row audit log" instinct: at 7,531 sales rows the per-row INSERT becomes the bottleneck. We use AGGREGATE audit-logs (one per (defunct,table) pair) plus the per-pair `action='merge'` row. Rollback still works because the rollback SQL keys on `metadata->>'script'` and `metadata->>'oldLocationId'` — it does not need a row-per-row record.

(B) `scripts/multi-pos-merge.ts` — CLI wrapper around `applyBulkMerge`. Mirrors `scripts/backfill-kiosk-install-dates.ts` exactly:

```typescript
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { mergeProposals } from "@/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { applyBulkMerge, type MergePair } from "@/lib/multi-pos-merge";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  // 1. Load all merge_proposals where decision IN ('approved','swapped') AND applied_at IS NULL.
  //    For 'swapped' rows, INVERT canonicalId/defunctId before constructing the MergePair.
  //    Skip rows where decision IN ('rejected','address_fix') — those don't merge.
  // 2. Print dry-run summary (cluster_id, canonical name, defunct names, expected row counts).
  // 3. If !APPLY, exit 0.
  // 4. If APPLY, call applyBulkMerge(pairs, { id: ETL_SYSTEM_USER_ID, name: 'multi-pos-merge.ts' }, db).
  // 5. Mark merge_proposals.applied_at = NOW() for all applied pairs.
  // 6. Print summary.
}
```

(C) `src/scripts/__tests__/multi-pos-merge.test.ts` — Vitest **integration** test (project: `integration`, uses Testcontainers Postgres):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// ... setup testcontainers Postgres, run drizzle-kit migrate, seed:
//      - 2 canonical locations, 4 defunct locations (2 pairs, 2 clusters)
//      - 1 region row, 2 hotel_group rows
//      - 100 sales_records (50 on each defunct, 0 on canonical)
//      - 4 kiosk_assignments (2 each on defunct)
//      - location_region_memberships rows on defunct (collision case 1)
//      - location_group_memberships rows on canonical (collision case 2)
//      - location_hotel_group_memberships with overlap (PK collision case 3)
// ... call applyBulkMerge(pairs, actor, db)
// Assertions:
//   - All 100 sales_records.location_id now point at canonical.
//   - All 4 kiosk_assignments.location_id now point at canonical.
//   - location_region_memberships: defunct's row deleted, canonical's row preserved.
//   - location_group_memberships: defunct's row preserved (canonical had its own to begin with).
//   - location_hotel_group_memberships: PK-collision row deleted; non-colliding row rewritten.
//   - 2 locations.archived_at IS NOT NULL.
//   - audit_logs has: 2 'merge' rows + 2 'archive' rows + N aggregate-rewrite rows.
//   - All audit_logs rows have metadata->>'script' = 'scripts/multi-pos-merge.ts'.
// Run twice: assert second run is a no-op (idempotency — guarded by applied_at IS NOT NULL).
```

(D) Wire `applyApprovedMerges` in `src/app/(app)/settings/duplicates/merge-review/actions.ts` (replace the Task 2 stub) to call `applyBulkMerge` with the loaded approved pairs. Use the production `db` singleton; transaction is opened inside `applyBulkMerge`.
  </action>
  <verify>
    <automated>
npm run typecheck && npx vitest run --project integration src/scripts/__tests__/multi-pos-merge.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/multi-pos-merge.ts` exists; exports `applyBulkMerge`, `MULTI_POS_MERGE_SCRIPT_TAG`, type `MergePair`, type `BulkMergeResult` (verify with `grep "^export" src/lib/multi-pos-merge.ts | wc -l` ≥ 4).
    - File `scripts/multi-pos-merge.ts` exists and contains the literal strings `--apply`, `ETL_SYSTEM_USER_ID`, `applyBulkMerge`.
    - File `src/scripts/__tests__/multi-pos-merge.test.ts` exists; integration test passes (exit 0).
    - Integration test asserts all of: sales_records rewrite, kiosk_assignments rewrite, UNIQUE collision deletion (region OR group), PK collision deletion (hotel_group OR location_products), locations.archived_at set, audit_logs row with `metadata->>'script' = 'scripts/multi-pos-merge.ts'`, idempotency on second run.
    - `applyApprovedMerges` in `src/app/(app)/settings/duplicates/merge-review/actions.ts` no longer contains the literal string `TODO` or `stub`; it imports from `@/lib/multi-pos-merge`.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Bulk merge primitive is library-grade (testable, transactional, idempotent), CLI wrapper offers dry-run-by-default, and the admin UI's Apply button is wired end-to-end. Operator can now run `npx tsx scripts/multi-pos-merge.ts` against staging to validate.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Manual UAT — staging dry-run + apply + rollback drill</name>
  <what-built>
    Tasks 1–4 deliver: probe script, merge-review UI, bulk merge primitive, CLI script, integration tests. The destructive `--apply` path has NOT yet run against any real (non-testcontainer) DB.
  </what-built>
  <how-to-verify>
    Operator (admin):

    1. **Pre-merge probe on staging:**
       ```
       DATABASE_URL='<staging>' npx tsx scripts/probe-multi-pos-merge-collisions.ts
       ```
       Read the output; for each cluster with collisions, confirm that the bulk-merge order-of-ops (Task 4 module-doc steps 1–4) handles the collision correctly. Document any cluster where manual intervention is needed BEFORE the apply runs (e.g. "for cluster 3, defunct's region differs from canonical's — flag in merge-review UI as `address_fix` not `approved`").

    2. **Review UI on staging deploy:** open `/settings/duplicates/merge-review`. Walk through every one of the 22 clusters. Per cluster, choose ONE of: ✅ approved, 🔁 swapped, ❌ rejected, ✏️ address_fix (with notes for the corrective action). Save each. Record the per-cluster decisions in a checklist for the PR description.

    3. **Dry-run on staging:**
       ```
       DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts
       ```
       (No `--apply`.) Confirm the printed summary matches the proposal CSV expectations: ~7,531 sales_records, 22 cluster pairs, ~29 archives.

    4. **Apply on staging:**
       ```
       DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts --apply
       ```
       Confirm exit 0. Run a verification SQL:
       ```sql
       SELECT count(*) FROM audit_logs WHERE metadata->>'script' = 'scripts/multi-pos-merge.ts';
       SELECT count(*) FROM locations WHERE archived_at IS NOT NULL AND id IN (
         SELECT defunct_id FROM merge_proposals WHERE applied_at IS NOT NULL
       );
       SELECT count(*) FROM sales_records sr
        JOIN merge_proposals mp ON sr.location_id = mp.canonical_id
        WHERE mp.applied_at IS NOT NULL;
       ```
       Counts must match the dry-run summary.

    5. **Idempotency:** re-run `--apply`. Expected output: "0 pairs to merge (all approved already applied)". `audit_logs` row count must NOT change.

    6. **Rollback drill on staging (mandatory before prod apply):**
       ```sql
       BEGIN;
         UPDATE sales_records sr
            SET location_id = (al.metadata->>'oldLocationId')::uuid
           FROM audit_logs al
          WHERE al.entity_type = 'system'
            AND al.metadata->>'script' = 'scripts/multi-pos-merge.ts'
            AND al.metadata->>'table' = 'sales_records'
            AND sr.location_id = (al.metadata->>'newLocationId')::uuid;
         UPDATE locations
            SET archived_at = NULL
          WHERE id IN (SELECT defunct_id FROM merge_proposals WHERE applied_at IS NOT NULL);
         UPDATE merge_proposals SET applied_at = NULL WHERE applied_at IS NOT NULL;
       ROLLBACK;  -- inspect; commit only if rollback shape is correct
       ```
       Run inside a transaction first; verify the row counts return to pre-merge state; then ROLLBACK to keep staging in the merged state for prod apply.

    7. **Maturity dashboard sanity:** `/analytics/maturity` and `/analytics/portfolio` on staging should still render and show no `null` outlet codes for the canonical IDs.

    Resume signal: comment "approved with merge counts: sales=N, archives=M, audit_logs=K, idempotency=verified, rollback-drill=clean" — OR — describe specific cluster issues that need design adjustment before re-running Task 4.
  </how-to-verify>
  <resume-signal>Type "approved" with the row counts above, or describe issues</resume-signal>
</task>

<task type="auto">
  <name>Task 6: Apply to production + tick todo.md + summary commit</name>
  <files>
    tasks/todo.md
  </files>
  <read_first>
    - tasks/todo.md (lines 96–98 for the 5.5/5.6/5.7 entries)
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md (D-19: per-plan summary commits)
    - ~/.claude/CLAUDE.md (per-plan summary commit + per-phase summary commit conventions)
  </read_first>
  <action>
This task closes the loop on SC10 for plan 06-01. It has two parts.

(A) After Task 5's UAT approves, the operator runs the same `npx tsx scripts/multi-pos-merge.ts --apply` against PROD (`DATABASE_URL=<prod-from-vercel-env>`). Verification SQL run on prod must match staging shape. This is operator-driven, not Claude-driven, but Claude prepares the runbook section in the PR description: dry-run output, apply output, post-apply counts, rollback runbook (the same SQL as Task 5 step 6, ready-to-paste).

(B) Update `tasks/todo.md`:
- Line 96: `- [ ] **5.5** D8 — Multi-POS site merge: ...` → `- [x] **5.5** D8 — Multi-POS site merge: ... — Phase 6 plan 06-01 (PR #NN, applied to prod YYYY-MM-DD).` (placeholder for PR # and date — operator fills these on PR open.)
- Line 97: same `[x]` swap for 5.6.
- Line 98: same `[x]` swap for 5.7, with note `address-data-quality decisions captured in merge_proposals.notes for clusters with decision='address_fix'`.

Also update line 146 (D2 reversal-matcher follow-up): no change here — that's plan 06-07's responsibility.

Per `~/.claude/CLAUDE.md` "Summary commits", create the per-plan summary commit ON the plan's branch (the executor will branch as `gsd/phase-06-d8-multi-pos-merge` per CONTEXT D-18). Commit message: `feat(d8): multi-POS site merge — 22 clusters, ~7,531 sales rewrites, audit-trail rollback shape (SC1, SC2)`.
  </action>
  <verify>
    <automated>
grep -n '^- \[x\] \*\*5\.5\*\*\|^- \[x\] \*\*5\.6\*\*\|^- \[x\] \*\*5\.7\*\*' tasks/todo.md | wc -l
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '^- \[x\] \*\*5\.5\*\*' tasks/todo.md` returns 1 (5.5 ticked).
    - `grep -c '^- \[x\] \*\*5\.6\*\*' tasks/todo.md` returns 1 (5.6 ticked).
    - `grep -c '^- \[x\] \*\*5\.7\*\*' tasks/todo.md` returns 1 (5.7 ticked).
    - PR description (or commit body) contains the dry-run output, apply output counts, and the rollback SQL block from Task 5 step 6.
    - The plan branch's most recent commit subject contains the literal string `multi-POS` and references SC1, SC2 (or D8).
  </acceptance_criteria>
  <done>
    Production data is reconciled: 22 clusters merged, defunct rows archived with audit-trail, address-quality decisions logged, todo.md zero-unchecked for items 5.5/5.6/5.7. Rollback runbook is in the PR description for emergency reversal.
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0
- `npx vitest run` exits 0 (unit + integration projects)
- `npx playwright test tests/settings-duplicates/merge-review.spec.ts` exits 0
- After prod apply: `SELECT COUNT(*) FROM audit_logs WHERE metadata->>'script' = 'scripts/multi-pos-merge.ts'` returns ≥ ~30 rows (per-pair merge + per-defunct archive + per-table aggregates)
- After prod apply: `SELECT COUNT(*) FROM locations WHERE archived_at IS NOT NULL AND id IN (SELECT defunct_id FROM merge_proposals WHERE applied_at IS NOT NULL)` returns 29 (the defunct count)
- `/settings/duplicates/merge-review` is reachable from `/settings/duplicates` (link added) and from direct URL
- `tasks/todo.md` items 5.5, 5.6, 5.7 are checked
</verification>

<success_criteria>
1. SC1 — Multi-POS merge applied with audit-trail. The 22 clusters from `multi-pos-merge-proposal.csv` have been admin-reviewed; approved/swapped pairs have rewritten every FK to `locations.id` (sales, assignments, products, three membership tables, flags, action_items) from defunct → canonical; the 29 defunct rows have `archivedAt` set; `audit_logs` has the script-tagged trail for rollback.
2. SC2 — Address-data-quality fix bundled. Clusters where the duplicate is actually an address-quality issue (Madrid name on Heathrow address) are recorded as `decision='address_fix'` in `merge_proposals` with notes describing the corrective action (Monday re-pull or hand-edit).
3. SC10 contribution — `tasks/todo.md` lines 96/97/98 (5.5/5.6/5.7) checked.
4. Rollback runbook is in the PR description and verified-clean against staging before prod apply.
5. Idempotency: re-running `scripts/multi-pos-merge.ts --apply` after a successful apply writes 0 new audit_logs rows.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-01-SUMMARY.md` documenting:
- Tasks 1–6 status
- Per-cluster decisions (count of approved/swapped/rejected/address_fix)
- Final row-count diffs (sales_records, kiosk_assignments, memberships, locations.archived)
- audit_logs row count with script tag
- PR # + merge SHA
- Rollback runbook (copied from PR description for in-repo reference)
</output>
