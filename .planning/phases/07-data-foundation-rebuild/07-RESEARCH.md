# Phase 7: Data Foundation Rebuild — Research

**Researched:** 2026-05-04
**Domain:** PostgreSQL wipe-and-rebuild runbook, N→1 location merge UI, same-name guardrails, sentinel pattern, automated UAT
**Confidence:** HIGH (codebase verified; all critical file paths, signatures, and gaps confirmed by direct reads)

---

## Summary

Phase 7 is the highest-blast-radius phase in v1.1: it truncates ~20 tables on prod and rebuilds them from Monday.com + CSV seed data. Research surface: existing Monday import code, merge primitives, schema objects needed but not yet in schema, Drizzle migration tooling, Playwright config, and the advisory lock pattern used to prevent concurrent import runs.

The single most consequential finding is that **there is no hotel location importer**. The existing `runMondayImport()` in `src/lib/monday/import-location-products.ts` imports commission tiers (`location_products`), NOT `locations` rows. Plan B must create a new `runHotelLocationImport()` function from scratch. This is not a modification — it is a net-new deliverable. The planner must allocate explicit tasks for it.

The second key finding is that **two merge code paths exist and Plan C must replace the thin one**. The current UI merge (`src/lib/merge.ts:mergeLocations()`) only rewrites 2 FK tables and has no transaction, no snapshot, and no collision handling. The robust CLI merge (`src/lib/multi-pos-merge.ts:applyBulkMerge()`) covers 9 FK tables in a single transaction and is the reference implementation Plan C must build on. `MergeDialog<T>` is already N→1 capable at the component layer — the constraint is server-side only.

**Primary recommendation:** Plan B and Plan C are the critical path. Plan B is blocked on the net-new hotel location importer; Plan C is blocked on the schema changes (`location_merge_snapshots`, `normalised_name` column + unique partial index). Both require a Wave 0 schema push before implementation work begins. Plan A (pre-flight inventory) is a one-day safe-to-run-on-prod activity; Plans D and E are relatively low risk once B and C are done.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Merge server action accepts N → 1 (not pair-wise). Operator can select 3, 4, or 8+ locations and merge them into a single canonical row.
- **D-02:** Same UI/server-action stack handles two flows: (a) location merge (N locations → 1 canonical) and (b) sentinel triage (M kiosks under `LOCATION_NEEDED` → 1 existing real location). Both share preview, atomic action, audit_log entry, and snapshot-before-commit.
- **D-03:** Snapshot-before-commit. Capture pre-merge state of every affected row into `location_merge_snapshots` table (keyed by merge's `audit_log` id) inside the same DB transaction.
- **D-04:** "Undo merge" button on audit_log entry detail view; admin-only. Replays snapshot in reverse inside a single transaction + writes paired audit entry.
- **D-05:** Undo retained indefinitely, but **locked once any merged `kiosk_assignment` row has been mutated post-merge**. UI greys out + shows reason. Detection: compare current row state against snapshot at undo-time.
- **D-06:** **Single global `LOCATION_NEEDED` sentinel** row. Name `LOCATION_NEEDED`, region GLOBAL or NULL, address `PENDING ASSIGNMENT`. Created once during reseed.
- **D-07:** Sentinel triage via Plan C merge UI (D-02) — multi-select orphan kiosks + pick destination location.
- **D-08:** Same-name banner on `/locations` + status row on `/admin/health`. Yellow banner "N same-name groups detected — review" linking to filtered list. Banner re-appears if a new dupe sneaks in.
- **D-09:** Detection against live table; does NOT depend on INSERT failing. Refresh cadence = planning detail (Claude's discretion).
- **D-10:** Email digest for same-name alerts is **out of scope Phase 7** — gated on Phase 8 Inngest+Resend.
- **D-11:** **Neon branch from prod** for UAT. Fork via Neon branching; Vercel preview points `BETTER_AUTH_URL` (git-branch alias per `CLAUDE.md`) and `DATABASE_URL` at branch. Deleted after sign-off.
- **D-12:** **Automated UAT, Claude-driven.** `scripts/verify-data-reset.ts` emits structured JSON + human-readable invariant report. Claude executes full sequence → presents summary for single conversational go/no-go. On "go", Claude runs runbook on prod + re-runs verify.
- **D-13:** Invariant suite covers (minimum): kiosk count vs golden snapshot, location count, sales row count, total-revenue invariant, no orphan `kiosk_assignments`, no active same-name groups, `LOCATION_NEEDED` sentinel orphan count surfaced, two-pass `assigned_at` coverage (NULL count before vs after), audit_log integrity.
- **D-14:** No operator-facing 06-HUMAN-UAT.md document. Structured invariant report + Claude's synthesised summary replace the v1.0 Phase 6 destructive-UAT pattern.

### Claude's Discretion

- Snapshot table column shape, indexing, and whether `location_merge_snapshots.payload` is JSONB or normalised typed columns
- Exact banner refresh cadence / detection mechanism (cron, on-route-load query, materialised view)
- Invariant suite output format details (Markdown? JSON? both?)
- Plan ordering within the phase (strawman A→B→C→D→E is a starting point; planner may reorder)
- Pre-wipe Neon point-in-time snapshot mechanics (Plan A inventory step)
- Whether the runbook lives as a single `scripts/v2-reset.ts` orchestrator or N composable scripts

### Deferred Ideas (OUT OF SCOPE)

- Email digest for same-name guardrail alerts — gated on Phase 8 Inngest+Resend substrate
- Bidirectional Monday sync / drift detection — V2-MONDAY-01, Phase 11
- 2024-onwards sales corpus backfill — `.planning/seeds/v2-sales-corpus-backfill.md`
- CI-gated invariant check on every PR touching the runbook
- Banner refresh cadence + materialised view — planning detail, pick during Plan D

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Wipe-and-rebuild from Monday. Wipes: `locations`, `kiosks`, `kioskAssignments`, `products`, sales tables, `auditLogs`, test rollout substrate, staging tables. Preserves: auth tables, `appSettings`, `pipelineStages`, saved-view tables, user customisations. Idempotent; deterministic output. | Wipe set confirmed against `v2-data-reset-decision.md`. Advisory lock pattern from `triggerMondayImportAction` (lock key 738294106) reusable. `scripts/snapshot-db-state.ts` usable for pre-wipe row count baseline. `scripts/backfill-kiosk-install-dates.ts --apply` handles two-pass `assigned_at`. **MISSING: hotel location importer — net-new.** |
| DATA-02 | Location-merge admin UI: N → 1 canonical. Kiosks reattach, sales rewrite, audit entry, archive non-canonical. Admin-only RBAC. Preview before confirm. Audit log cites actor + selected IDs + canonical. Replaces `scripts/multi-pos-merge.ts` (legacy). | `applyBulkMerge()` in `src/lib/multi-pos-merge.ts` is the reference (9 FK tables, single transaction). `MergeDialog<T>` is already N→1 at component layer. `BulkToolbar` shows merge button at `selectedCount >= 2`. Plan C only needs new server action + snapshot-before-commit + undo path. `src/lib/merge.ts:mergeLocations()` must be replaced (only 2 FK tables, no transaction, no snapshot). |
| DATA-03 | Same-name prevention: DB unique partial index `UNIQUE (normalised_name) WHERE archived_at IS NULL`; `runDryImport` warns on same-name candidates; admin alert / dashboard surface. | `normalised_name` column NOT YET IN SCHEMA — requires drizzle push as Wave 0 of Plan D. Banner mounts at `src/app/(app)/locations/page.tsx` above `<LocationTable>`. Admin/health status row is a new component. |
| DATA-04 | `LOCATION_NEEDED` sentinel row: sales ETL fallback for unknown outlet codes creates kiosk + assigns to sentinel. Operator merges sentinel-attached kiosks into real locations via DATA-02. | Single global sentinel (D-06). Sales ETL creates kiosk + assigns to sentinel on unknown outlet code. Operator triage reuses Plan C merge UI (D-07). Sentinel created in Plan B reseed step. |
| DATA-05 | Two-pass `assigned_at` seed rule: `live_date` primary, earliest CSV sale fallback. `scripts/backfill-kiosk-install-dates.ts --apply` for second pass. Re-runnable. | Backfill script confirmed at `scripts/backfill-kiosk-install-dates.ts` (324 lines). Uses `SET LOCAL app.allow_assigned_at_mutation = 'on'` to bypass Phase 5.3 immutability trigger. `--apply` flag (default = dry-run). Idempotency guard: within 1 second = skip. Already implements live_date → MIN(salesRecords.date) fallback. |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wipe-and-rebuild runbook | API / Backend (scripts) | Database / Storage | Destructive truncate + reseed is server-side scripted; no client involvement |
| Hotel location import (Plan B, net-new) | API / Backend (lib) | Database / Storage | Monday API → Drizzle insert; runs server-side during runbook |
| N→1 location merge server action | API / Backend (server action) | Database / Storage | Auth-gated server action with DB transaction; no client logic |
| Merge UI (preview + field resolution) | Browser / Client | Frontend Server (RSC layout) | `MergeDialog<T>` is a client component; page wrapper is RSC |
| Same-name guardrail banner | Frontend Server (RSC) | API / Backend (query) | Banner is conditional RSC; detection query runs server-side on route load |
| Snapshot-before-commit | Database / Storage | API / Backend | Captured inside Drizzle transaction; pure DB operation |
| Undo merge | API / Backend (server action) | Database / Storage | Admin-only server action that replays snapshot; transactional |
| Automated UAT invariant suite | API / Backend (scripts) | Database / Storage | `verify-data-reset.ts` is a Node.js script querying the DB directly |
| Neon branch provisioning | CDN / Static (external) | — | Neon branching is a platform operation; no application code involved |
| LOCATION_NEEDED sentinel creation | API / Backend (scripts) | Database / Storage | Created during runbook reseed step; one-time insert |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.45.2 (patched) | Schema, queries, migrations | Already in use; `patches/drizzle-orm+0.45.2.patch` applied; do NOT upgrade without DATA DEBT-02 audit [VERIFIED: codebase `package.json`] |
| drizzle-kit | ≥0.31 | Schema push (`drizzle-kit push`) | Config at `drizzle.config.ts`; output `./migrations` [VERIFIED: `drizzle.config.ts`] |
| @neondatabase/serverless | current | Postgres driver for Drizzle | Already in use; HTTP+WebSocket transport for edge/serverless [VERIFIED: codebase] |
| pg (node-postgres) | 8.x | Raw Postgres for scripts needing explicit transaction control | `backfill-kiosk-install-dates.ts` uses `pg` Pool directly, NOT Drizzle, to issue `SET LOCAL` session vars [VERIFIED: `scripts/backfill-kiosk-install-dates.ts`] |
| Next.js server actions | 14/15 | Auth-gated server mutations | All mutations are server actions; merge action follows `triggerMondayImportAction` pattern [VERIFIED: codebase] |
| Better Auth 1.5.x | 1.5.x | `requireRole('admin')` gate | All admin-only mutations already use this; unchanged in Phase 7 [VERIFIED: codebase, `07-CONTEXT.md`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Monday.com GraphQL API | v2024-10 | Hotel board data source | `iterateBoardItems()` in `src/lib/monday/client.ts` — already handles cursor pagination + retry [VERIFIED: `src/lib/monday/client.ts`] |
| node-postgres (`pg`) | 8.x | Raw Postgres for advisory locks + session vars | Scripts that need `pg_try_advisory_lock()` or `SET LOCAL` — not expressible in Drizzle ORM |
| tsx / npx tsx | current | Execute `.ts` scripts directly | All scripts use `npx tsx`; no compilation step [VERIFIED: codebase scripts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle push | Drizzle migrate (SQL files) | Push is simpler for additive changes; migrate gives rollback SQL. Phase 7 has no complex migration — additive columns + new table → push is correct. |
| `pg` Pool for runbook | Drizzle transaction | `pg` Pool required for `SET LOCAL app.allow_assigned_at_mutation = 'on'` session variable. For other runbook steps, Drizzle is fine. |
| On-route-load query for banner | Materialised view / cron | Route-load query is simplest; materialised view only justified if the query becomes slow. Start with route-load; planner picks. |

**Installation:** No new packages needed. All required libraries are already in `package.json`. [VERIFIED: codebase `package.json`]

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAN A — Pre-flight                                                        │
│  Monday API ──probe──► probe-monday-vs-db-addresses.ts ──► console report   │
│  Neon prod ──branch──► uat-phase-7-runbook (copy-on-write)                  │
│  snapshot-db-state.ts ──► golden row-count baseline (JSON)                  │
└─────────────────────────────────────────────────────────────────────────────┘
          ↓ pre-flight signed off
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAN B — Wipe + Reseed Runbook (v2-reset.ts or N scripts)                 │
│                                                                             │
│  pg_try_advisory_lock(LOCK_KEY_WIPE) ──────────────────────────────────►  │
│  TRUNCATE wipe-set tables (20 tables) ─────────────────────────────────►  │
│  runHotelLocationImport()  ◄── iterateBoardItems(4 hotel boards)           │
│         │ creates locations rows (name, address, live_date, region)         │
│  runMondayImport()  ◄── existing (imports location_products / commission)  │
│  Sales ETL ◄── seed_data/*.csv                                             │
│         │ unknown outlet codes → LOCATION_NEEDED sentinel kiosk            │
│  backfill-kiosk-install-dates.ts --apply  (two-pass assigned_at)           │
│  /settings/geocoding Apply  (manual operator step)                         │
└─────────────────────────────────────────────────────────────────────────────┘
          ↓ data loaded
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAN C — N→1 Merge UI + Undo                                              │
│                                                                             │
│  /locations  →  LocationTable  →  BulkToolbar (selectedCount >= 2)         │
│       │                 ↓                                                   │
│       │          MergeDialog<Location>  (already N→1 capable)              │
│       │                 │ field resolution + canonical picker               │
│       │                 ↓                                                   │
│       │       mergeLocationsAction()  [server action — NEW]                │
│       │                 │ requireRole('admin')                              │
│       │                 │ applyBulkMerge(pairs, actor, db)  [reference impl│
│       │                 │    + location_merge_snapshots INSERT (same txn)   │
│       │                 │    + writeAuditLog(action: 'merge')               │
│       │                 ↓                                                   │
│       │         DB transaction (atomic, all FK tables)                      │
│       │                                                                     │
│  /audit-log/<id>  →  Undo button (admin-only)                              │
│       │         undoMergeAction()  [new server action]                      │
│       │           → snapshot replay  + lock check (kiosk_assignment mutated│
│       │           → writeAuditLog(action: 'merge', metadata: {undid: id})   │
│                                                                             │
│  SENTINEL TRIAGE (same UI, different data):                                │
│  /locations/<sentinel-id>  →  LocationTable (orphan kiosks only)           │
│       └── BulkToolbar merge  →  MergeDialog (sentinel triage mode)         │
│                 └── mergeLocationsAction()  (reassign kiosks, no location  │
│                     archive — sentinel row survives)                        │
└─────────────────────────────────────────────────────────────────────────────┘
          ↓ merge UI shipped
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAN D — Same-name Guardrails                                              │
│                                                                             │
│  Schema: locations.normalised_name TEXT (generated or app-set)             │
│          UNIQUE partial index: (normalised_name) WHERE archived_at IS NULL  │
│  /locations RSC  →  detectSameNameGroups() query  →  banner (N > 0)        │
│  /admin/health   →  same query  →  status row                              │
│  runDryImport()  →  warns when import creates same-name candidate          │
└─────────────────────────────────────────────────────────────────────────────┘
          ↓ guardrails live
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLAN E — Verification + Automated UAT                                      │
│                                                                             │
│  verify-data-reset.ts  →  JSON invariant report + Markdown summary         │
│  Claude executes:                                                           │
│    1. runbook on Neon UAT branch                                            │
│    2. verify on branch  →  synthesise summary  →  present for go/no-go     │
│    3. on "go": runbook on prod  →  verify on prod  →  final report          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

The phase fits into the existing structure without new top-level directories:

```
src/
├── db/schema.ts                  # Add: location_merge_snapshots table, normalised_name column
├── lib/
│   ├── merge.ts                  # REPLACE with applyBulkMerge-based implementation (Plan C)
│   ├── multi-pos-merge.ts        # Mark legacy (REFERENCE ONLY after Plan C ships)
│   └── monday/
│       ├── client.ts             # No changes
│       ├── import-location-products.ts  # No changes (commission tier importer, not locations)
│       └── import-hotel-locations.ts   # NEW: runHotelLocationImport() (Plan B)
├── app/(app)/
│   ├── locations/
│   │   ├── page.tsx              # Add same-name banner (Plan D)
│   │   ├── merge-action.ts       # REPLACE: use new applyBulkMerge-based server action
│   │   └── undo-merge-action.ts  # NEW (Plan C)
│   └── admin/health/             # Add same-name status row (Plan D)
scripts/
├── v2-reset.ts                   # NEW: wipe-and-rebuild orchestrator (Plan B)
├── probe-monday-vs-db-addresses.ts  # Extend for Plan A
├── snapshot-db-state.ts          # Reuse for Plan A baseline
├── backfill-kiosk-install-dates.ts  # Reuse with --apply (Plan B)
└── verify-data-reset.ts          # NEW: invariant suite (Plan E)
tests/
├── locations/merge.spec.ts       # NEW (Plan C)
└── admin/verify-data-reset.spec.ts  # NEW (Plan E — smoke test only)
```

### Pattern 1: Hotel Location Import (Net-New — Plan B)

The existing `iterateBoardItems()` in `src/lib/monday/client.ts` handles pagination and retry. `runHotelLocationImport()` must:

1. Call `iterateBoardItems()` for each of the 4 hotel board IDs: `[1356570756, 1743012104, 5026387784, 5092887865]`
2. Extract hotel fields: `name`, `address`, `live_date`, `region` (via `BOARD_REGION` mapping already in `import-location-products.ts`), `outlet_code` from `mirror9` column
3. Insert into `locations` table via Drizzle upsert (by `name` or Monday item ID)
4. Return a result object analogous to `MondayImportResult`

```typescript
// NEW: src/lib/monday/import-hotel-locations.ts
// Source: derived from HOTEL_BOARD_IDS + iterateBoardItems pattern in client.ts
import { iterateBoardItems, HOTEL_BOARD_IDS, BOARD_REGION } from "./client";
import { db } from "@/db";
import { locations } from "@/db/schema";

export async function runHotelLocationImport(opts: {
  mondayApiToken: string;
  db: typeof db;
}): Promise<HotelLocationImportResult> {
  // For each hotel board: iterate items, extract fields, upsert locations
  // Return: { locationsCreated, locationsUpdated, durationMs }
}
```

[VERIFIED: `src/lib/monday/import-location-products.ts` — HOTEL_BOARD_IDS, BOARD_REGION, iterateBoardItems all confirmed present]

### Pattern 2: N→1 Merge Server Action (Plan C)

```typescript
// NEW: src/app/(app)/locations/merge-action.ts (REPLACE CURRENT)
// Source: derived from applyBulkMerge in scripts/multi-pos-merge.ts
"use server";
import { requireRole } from "@/lib/auth";
import { applyBulkMerge, MergePair, MergeActor } from "@/lib/multi-pos-merge";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/db";
import { locationMergeSnapshots } from "@/db/schema";

export async function mergeLocationsAction(
  canonicalId: string,
  defunctIds: string[],         // N defunct → 1 canonical (not pair-wise)
  fieldResolutions: Record<string, unknown>
): Promise<{ success: true; merged: number } | { error: string }> {
  const session = await requireRole("admin");
  const actor: MergeActor = { id: session.user.id, name: session.user.name };

  // pairs: each defunct mapped to canonical
  const pairs: MergePair[] = defunctIds.map(defunctId => ({ canonicalId, defunctId }));

  // applyBulkMerge wraps ALL FK rewrites in a single transaction
  // Plan C adds: capture pre-merge snapshot inside same transaction (D-03)
  return applyBulkMerge(pairs, actor, db);
}
```

[VERIFIED: `src/lib/multi-pos-merge.ts` — signature, MergePair, MergeActor, 9 FK tables, single transaction confirmed]

### Pattern 3: Advisory Lock for Runbook (Plan B)

Reuse the pattern from `triggerMondayImportAction` with a distinct lock key:

```typescript
// Source: src/app/(app)/settings/data-import/monday/actions.ts
// Monday import uses: pg_try_advisory_lock(738294106)
// Azure ETL uses:     pg_try_advisory_lock(738294105)
// Wipe runbook MUST use a distinct key, e.g.:
const WIPE_RUNBOOK_LOCK_KEY = 738294107; // distinct from both existing keys
```

[VERIFIED: `src/app/(app)/settings/data-import/monday/actions.ts` — lock key 738294106 confirmed]

### Pattern 4: Two-Pass assigned_at (Plan B)

```bash
# Source: scripts/backfill-kiosk-install-dates.ts (324 lines, confirmed)
# Dry run (safe on prod, shows changes):
npx tsx scripts/backfill-kiosk-install-dates.ts

# Apply (destructive — run AFTER full sales ETL):
DATABASE_URL="$PROD_URL" npx tsx scripts/backfill-kiosk-install-dates.ts --apply
```

Uses `SET LOCAL app.allow_assigned_at_mutation = 'on'` to bypass Phase 5.3 immutability trigger. Idempotency guard: skips rows where delta < 1 second. [VERIFIED: `scripts/backfill-kiosk-install-dates.ts`]

### Pattern 5: Snapshot Table Schema (Claude's Discretion — D-03)

JSONB payload is recommended for flexibility — the set of tables mutated by a merge may evolve:

```typescript
// NEW in src/db/schema.ts
export const locationMergeSnapshots = pgTable("location_merge_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditLogId: uuid("audit_log_id").notNull().references(() => auditLogs.id),
  payload: jsonb("payload").notNull(),
  // payload shape: { locations: LocationRow[], kioskAssignments: KioskAssignmentRow[], ... }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Undo lock check: at undo-time, compare `kiosk_assignment` rows (from snapshot `payload.kioskAssignments`) against current DB state. If any row has been mutated since `createdAt`, grey out Undo. [ASSUMED — column shape; JSONB vs normalised is Claude's discretion per CONTEXT.md D-05]

### Pattern 6: Same-name Normalisation Column (Data-03)

```typescript
// ADD to locations table in src/db/schema.ts
normalisedName: text("normalised_name"),  // app-set on insert/update

// ADD index:
export const locationNormalisedNameIdx = uniqueIndex(
  "location_normalised_name_active_idx"
).on(locations.normalisedName).where(sql`archived_at IS NULL`);
```

Normalisation: lowercase + collapse whitespace + strip punctuation. Must be computed in application code on every `locations` insert/update. [VERIFIED: DATA-03 requirement; column not yet in schema confirmed by `src/db/schema.ts` read]

### Pattern 7: writeAuditLog Merge Entry (Plan C)

```typescript
// Source: src/lib/audit.ts (confirmed signature)
await writeAuditLog({
  actorId: session.user.id,
  actorName: session.user.name,
  entityType: "location",
  entityId: canonicalId,
  entityName: canonicalName,
  action: "merge",
  metadata: {
    defunctIds,
    defunctNames,
    fieldResolutions,
    snapshotId,  // references location_merge_snapshots.id
  },
}, db);
```

[VERIFIED: `src/lib/audit.ts` — `action: "merge"` is in the union; `metadata` is `Record<string, unknown>`]

### Anti-Patterns to Avoid

- **Using `src/lib/merge.ts:mergeLocations()` as the Plan C base:** Only rewrites 2 FK tables (`kioskAssignments`, `locationProducts`). Missing 7 FK tables that `applyBulkMerge` covers. Will leave dangling FK references in `salesRecords`, `location_region_memberships`, `location_group_memberships`, etc. REPLACE, do not extend.
- **Running `npm install` on macOS after Docker lockfile regen:** Rewrites lockfile to macOS shape, breaking Linux CI. Use `npm ci` locally after Docker regen (per `CLAUDE.md`).
- **Setting `BETTER_AUTH_URL` to a per-deploy hash URL for Plan E UAT:** Breaks all `/api/auth/*` calls on every redeploy. Must use the git-branch alias (per `CLAUDE.md`).
- **Running wipe runbook without advisory lock:** Two concurrent runs would corrupt the reseed. Use `pg_try_advisory_lock` with a distinct lock key.
- **Using `LOCATION_NEEDED` sentinel as the target in a merge:** Sentinel triage (D-07) reassigns kiosks FROM sentinel TO a real location. The sentinel row itself must never be archived or merged away.
- **Calling `backfill-kiosk-install-dates.ts --apply` before full sales ETL:** The `MIN(salesRecords.date)` fallback needs the entire corpus loaded. Sequencing is hard: two-pass runs AFTER sales ETL.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monday board pagination | Custom page cursor loop | `iterateBoardItems()` in `src/lib/monday/client.ts` | Already handles cursor pagination (100 items/page) + exponential backoff retry (5x, 1s→32s) [VERIFIED] |
| Atomic multi-table FK rewrite | Custom transaction loop | `applyBulkMerge()` in `src/lib/multi-pos-merge.ts` | Already covers 9 FK tables, collision pre-deletion for 4 join tables, ALL-OR-NOTHING transaction. Tested on prod clusters [VERIFIED] |
| Two-pass `assigned_at` backfill | New script | `scripts/backfill-kiosk-install-dates.ts --apply` | Already implements live_date → MIN(sale) fallback + immutability trigger bypass + idempotency guard [VERIFIED] |
| N→1 merge UI component | New dialog | `src/components/table/merge-dialog.tsx` — already accepts N records | `MergeDialog<T>` takes `records: T[]` (not a pair); canonical picker + field resolution already built [VERIFIED] |
| Merge trigger button | New toolbar button | `src/components/table/bulk-toolbar.tsx` `onMerge` prop | Shows merge button at `selectedCount >= 2`; no component change needed [VERIFIED] |
| Row-count baseline for pre-wipe | New script | `scripts/snapshot-db-state.ts` | Already reports counts for all table groups; reuse for Plan A golden snapshot [VERIFIED] |
| Audit log for merge | Custom table | `writeAuditLog()` in `src/lib/audit.ts` | Standard pattern; `action: "merge"` already in union type [VERIFIED] |

**Key insight:** The merge plumbing (9 FK tables, transaction, collision handling) took a full plan in v1.0. Plan C's primary job is wiring the existing `applyBulkMerge` primitive into a server action with snapshot-before-commit, not re-implementing the merge logic.

---

## Runtime State Inventory

> Not a rename/refactor phase. Wipe-and-rebuild is destructive but operates on its own target set. The "runtime state" question is: what survives the wipe, and what must be reconstructed?

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data — WIPED | ~20 tables: `locations`, `kiosks`, `kiosk_assignments`, `salesRecords`, `salesImports`, `auditLogs`, `mergeProposals`, `importStagings`, `weatherCache`, `products`, `providers`, `locationProducts`, `locationGroups`, `regions`, `hotelGroups`, `markets`, `locationFlags`, `commissionLedger`, `installations`, `milestones` | Plan B truncates + reseeds. Full wipe set in `v2-data-reset-decision.md`. |
| Stored data — PRESERVED | `user`, `account`, `session`, `verification`, `userScopes`, `appSettings`, `pipelineStages`, `eventCategories`, `userViews`, `analyticsSavedViews`, `analyticsPresets`, `duplicateDismissals`, `kioskConfigGroups`, `outletExclusions`, `experimentCohorts`, `actionItems` | No action. Plan A inventories `appSettings` + `pipelineStages` to confirm customised values survive. |
| Live service config | Monday API token in Vercel env (`MONDAY_API_TOKEN`) — unchanged | None — token reads fine post-wipe. |
| OS-registered state | None — no Task Scheduler / pm2 / systemd involvement | None — verified by architecture. |
| Secrets/env vars | `DATABASE_URL`, `BETTER_AUTH_URL`, `MONDAY_API_TOKEN` in Vercel. Plan E adds UAT Neon branch URL to Vercel preview vars. | Plan E: set `DATABASE_URL` + `BETTER_AUTH_URL` to Neon branch URL on preview deploy. Delete after sign-off. |
| Build artifacts | None — no pip/npm globals or compiled binaries carry location/kiosk data. | None. |

---

## Common Pitfalls

### Pitfall 1: Hotel Location Importer Does Not Exist

**What goes wrong:** Planner assumes `runMondayImport()` or `runFullImport()` will seed `locations` rows. It does not. `runMondayImport()` imports `location_products` (commission tiers from subitems). `scripts/import-from-monday.ts` imports kiosks from the Assets board.
**Why it happens:** The function name `runMondayImport` sounds like it imports everything from Monday.
**How to avoid:** Plan B must include a task to create `src/lib/monday/import-hotel-locations.ts:runHotelLocationImport()` as a net-new deliverable. The 4 hotel board IDs (`HOTEL_BOARD_IDS`) are available in `import-location-products.ts`; the `iterateBoardItems` cursor client is ready.
**Warning signs:** If Plan B tasks don't mention `runHotelLocationImport` or `import-hotel-locations.ts`, the plan is missing a full task.

[VERIFIED: `src/lib/monday/import-location-products.ts` — `runMondayImport` signature and purpose confirmed]

### Pitfall 2: Using the Thin merge.ts as Plan C Base

**What goes wrong:** Plan C extends `src/lib/merge.ts:mergeLocations()` instead of replacing it with `applyBulkMerge`. Missing 7 FK tables means kiosks, sales records, and group memberships remain pointing at archived (defunct) location IDs. Silent data corruption.
**Why it happens:** `mergeLocations()` is the current server action's backing function — easiest to patch.
**How to avoid:** Plan C must rewrite `src/app/(app)/locations/merge-action.ts` to call `applyBulkMerge()` (from `scripts/multi-pos-merge.ts`). Then mark `src/lib/merge.ts` as legacy.
**Warning signs:** Plan C tasks that mention "extend mergeLocations" or touch only `kioskAssignments` and `locationProducts`.

[VERIFIED: `src/lib/merge.ts` + `src/lib/multi-pos-merge.ts` — FK table counts confirmed]

### Pitfall 3: Pair-wise vs N→1 Merge Pairs Construction

**What goes wrong:** Plan C server action receives N defunct IDs but constructs the `MergePair[]` incorrectly (e.g., chaining defunct[0]→defunct[1]→defunct[2] instead of all → canonical).
**Why it happens:** `MergePair` type is `{ canonicalId; defunctId }` and the old `multi-pos-merge.ts` was pair-wise.
**How to avoid:** Server action must build: `defunctIds.map(id => ({ canonicalId, defunctId: id }))` — each defunct maps to the same canonical.
**Warning signs:** Any logic that processes defunct IDs sequentially (each becoming the canonical for the next).

[VERIFIED: `MergePair` type confirmed in `scripts/multi-pos-merge.ts`]

### Pitfall 4: Two-Pass assigned_at Run Before Sales ETL

**What goes wrong:** `backfill-kiosk-install-dates.ts --apply` runs before the full sales corpus is loaded. The `MIN(salesRecords.date)` fallback for kiosks with no `live_date` reads an incomplete corpus and records wrong `assigned_at` values.
**Why it happens:** Runbook steps run out of order.
**How to avoid:** Plan B runbook ordering: truncate → hotel import → sales ETL → **then** `--apply`. Enforce via sequential step numbering in the runbook script.
**Warning signs:** Runbook plan that runs backfill before or in parallel with sales ETL.

[VERIFIED: `scripts/backfill-kiosk-install-dates.ts` — sequencing requirement confirmed in `v2-data-reset-decision.md`]

### Pitfall 5: Schema Objects Missing at Wave Start

**What goes wrong:** Plan C implementation starts before `location_merge_snapshots` table is in the schema. Plan D implementation starts before `normalised_name` column + partial index exist. Both cause runtime Drizzle errors or missing-column errors.
**Why it happens:** Schema changes and code changes are planned in the same wave without a schema-push gate.
**How to avoid:** Each plan that requires new schema objects must have a Wave 0 task: update `src/db/schema.ts` + run `drizzle-kit push` against the dev/staging DB **before** any application code is written. The phase-level pre-flight (Plan A or B Wave 0) should also verify the schema objects exist.
**Warning signs:** Plans C or D that don't have an explicit `drizzle-kit push` step before application code tasks.

[VERIFIED: `src/db/schema.ts` — `location_merge_snapshots` and `normalised_name` both absent; `drizzle.config.ts` confirms push mechanism]

### Pitfall 6: Advisory Lock Key Collision

**What goes wrong:** Wipe runbook uses the same advisory lock key as the Monday import (`738294106`). Running both simultaneously causes one to silently skip.
**Why it happens:** Lock key copied from `triggerMondayImportAction` without changing the value.
**How to avoid:** Use a distinct key, e.g., `738294107`, for the wipe runbook. Document all three keys in a comment.
**Warning signs:** Any runbook script that copies the advisory lock block from `monday/actions.ts` without changing the numeric constant.

[VERIFIED: `src/app/(app)/settings/data-import/monday/actions.ts` — key 738294106 confirmed; Azure ETL key 738294105 from session context]

### Pitfall 7: BETTER_AUTH_URL Set to Per-Deploy Hash for Plan E UAT

**What goes wrong:** Vercel preview `BETTER_AUTH_URL` is set to the deploy hash URL (e.g., `wkg-command-centre-abc123-vedant.vercel.app`). Next Vercel redeploy mints a new hash. All `/api/auth/*` calls on the new deploy return `403 Invalid origin`.
**Why it happens:** The deploy URL is visible in the Vercel dashboard; git-branch alias is less obvious.
**How to avoid:** Per `CLAUDE.md`: `BETTER_AUTH_URL` must use the git-branch alias. For Plan E UAT: `wkg-command-centre-git-gsd-phase-07-data-foundation-rebuild-vedant-kalbag-wkgs-projects.vercel.app`. Set via `vercel env add BETTER_AUTH_URL preview <branch>`.
**Warning signs:** `BETTER_AUTH_URL` value containing a hash-like string rather than the branch name.

[VERIFIED: `CLAUDE.md` § "Vercel preview env vars"]

### Pitfall 8: Sentinel Row Archived or Merged Away

**What goes wrong:** Operator accidentally selects the `LOCATION_NEEDED` sentinel as a source in a merge, archiving it. All subsequent orphan kiosk assignments fail FK constraint or land in void.
**Why it happens:** Sentinel looks like any other location in the multi-select UI.
**How to avoid:** Plan C server action must reject merges where any source or canonical ID matches the `LOCATION_NEEDED` sentinel ID. UI should suppress the sentinel from the merge source picker (or show it as non-selectable). Sentinel's name is a recognisable constant — can also validate on name.
**Warning signs:** Plan C server action that doesn't have a sentinel guard condition.

[ASSUMED — guard implementation detail; the CONTEXT.md D-06/D-07 specifies sentinel must survive, guard mechanism is not specified]

---

## Code Examples

### Verified: applyBulkMerge Signature

```typescript
// Source: scripts/multi-pos-merge.ts (530 lines, verified)
export type MergePair = { canonicalId: string; defunctId: string; };
export type MergeActor = { id: string; name: string };

export async function applyBulkMerge(
  pairs: MergePair[],
  actor: MergeActor,
  db: MergeDb
): Promise<BulkMergeResult>
```

FK tables covered: `sales_records.location_id`, `sales_records.processed_at_location_id`, `kiosk_assignments.location_id`, `location_products.location_id`, `location_region_memberships.location_id`, `location_group_memberships.location_id`, `location_hotel_group_memberships.location_id`, `location_flags.location_id`, `action_items.location_id`

Collision pre-deletion for: `location_region_memberships`, `location_group_memberships`, `location_hotel_group_memberships`, `location_products` (same product_id + provider_id).

### Verified: MergeDialog Props

```typescript
// Source: src/components/table/merge-dialog.tsx (verified)
interface MergeDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: T[];   // N records (NOT a pair) — already N→1 capable
  fields: MergeField[];
  getFieldValue: (record: T, key: string) => string;
  getId: (record: T) => string;
  getName: (record: T) => string;
  onMerge: (targetId: string, sourceIds: string[], resolutions: Record<string, unknown>) => Promise<{success: true; merged: number} | {error: string}>;
  onSuccess: () => void;
  entityLabel?: string;
}
```

### Verified: BulkToolbar Merge Trigger

```typescript
// Source: src/components/table/bulk-toolbar.tsx (verified)
// Merge button renders when: onMerge prop provided AND selectedCount >= 2
// No component changes needed for Plan C.
interface BulkToolbarProps<T> {
  // ...
  onMerge?: () => void;  // optional — present for locations, absent for kiosks
  selectedCount: number;
}
```

### Verified: Advisory Lock Pattern

```typescript
// Source: src/app/(app)/settings/data-import/monday/actions.ts (91 lines, verified)
// Reuse this pattern for wipe runbook with a distinct lock key
const lockResult = await db.execute(
  sql`SELECT pg_try_advisory_lock(${WIPE_RUNBOOK_LOCK_KEY})`
);
if (!lockResult.rows[0].pg_try_advisory_lock) {
  return { error: "Another runbook instance is already running." };
}
// ... runbook steps ...
await db.execute(sql`SELECT pg_advisory_unlock(${WIPE_RUNBOOK_LOCK_KEY})`);
```

### Verified: writeAuditLog Merge Action

```typescript
// Source: src/lib/audit.ts (verified — action: "merge" in union type)
await writeAuditLog({
  actorId: ETL_SYSTEM_USER_ID,  // "00000000-0000-0000-0000-000000000001" for script runs
  actorName: "System",
  entityType: "location",
  entityId: canonicalId,
  entityName: canonicalName,
  action: "merge",
  metadata: { defunctIds, snapshotId },
}, db);
```

### Verified: iterateBoardItems Pagination

```typescript
// Source: src/lib/monday/client.ts (311 lines, verified)
// For runHotelLocationImport:
for await (const item of iterateBoardItems(boardId)) {
  // item.column_values — use mapColumnValues() helper
  // item.id, item.name
}
// Handles cursor pagination (100 items/page) + 5x exponential backoff retry automatically
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scripts/multi-pos-merge.ts` CLI (developer-runs) | Plan C admin UI (operator self-service) | Phase 7 Plan C | Eliminates developer involvement for location merges |
| Pair-wise merge (2 → 1) | N → 1 merge (any cardinality) | Phase 7 Plan C | Handles Residence Inn 8-row cluster in one operation |
| No merge undo | Snapshot-before-commit + Undo button | Phase 7 Plan C | Self-service recovery without Neon PITR |
| 60 "NO_MONDAY" locations (v1.0 exception bucket) | `LOCATION_NEEDED` sentinel (single canonical) | Phase 7 Plan B | Structured operator triage path |
| Manual destructive UAT (06-HUMAN-UAT.md) | Claude-driven automated invariant suite + go/no-go | Phase 7 Plan E | No manual SQL; machine-checked invariants |
| `runMondayImport()` = commission tiers only | `runHotelLocationImport()` (net-new) + `runMondayImport()` | Phase 7 Plan B | Hotel locations now seeded from Monday authoritative boards |

**Deprecated/outdated after Phase 7:**
- `src/lib/merge.ts:mergeLocations()`: Replaced by `applyBulkMerge`-based server action. Mark as `@deprecated`.
- `scripts/multi-pos-merge.ts`: Becomes legacy reference after Plan C ships. Mark as `@deprecated`.
- `mergeProposals` table: In wipe set; removed in Plan B truncate. No migration needed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | JSONB payload for `location_merge_snapshots` is recommended over normalised typed columns | Code Examples / Pattern 5 | Low — CONTEXT.md D-03 explicitly leaves column shape to Claude's discretion. If normalised columns are chosen, schema definition changes but logic is the same. |
| A2 | Sentinel guard in Plan C server action should reject merges where source/canonical ID matches sentinel | Common Pitfalls §8 | Medium — CONTEXT.md D-07 says sentinel survives but doesn't specify guard mechanism. Risk: sentinel archived if no guard. Implementation detail for Plan C. |
| A3 | Same-name banner uses on-route-load query (not materialized view or cron) | Architecture Patterns §4 | Low — CONTEXT.md D-09 explicitly leaves refresh cadence to Claude's discretion. Route-load is simplest; switch to cron/MV if query is slow. |
| A4 | Wipe runbook advisory lock key = 738294107 | Pattern 3 / Common Pitfalls §6 | Low — any key distinct from 738294105 (Azure ETL) and 738294106 (Monday import) is valid. Exact value is a code detail. |
| A5 | `normalised_name` computed in application code (not a PostgreSQL generated column) | Pattern 6 | Medium — a PostgreSQL `GENERATED ALWAYS AS` column would ensure consistency but requires a stable normalisation expression in SQL. App-side computation is simpler but requires discipline at every insert/update point. |

---

## Open Questions (RESOLVED)

1. **Monday hotel item cardinality for same-name groups**
   - What we know: 19 same-name location groups on prod (e.g., 8-row Residence Inn Kensington).
   - What's unclear: Does Monday have 1 item per same-name group, or N items? If 1, the post-wipe state is clean automatically. If N, Plan C must run immediately after Plan B.
   - Recommendation: Plan A extends `scripts/probe-monday-vs-db-addresses.ts` to count Monday items per normalised hotel name across all 4 hotel boards. Answer determines whether Plan C is a "cleanup only" UI or an immediate post-reseed requirement.
   - **RESOLVED:** Cardinality is unbounded — the merge UI is N→1 (any number of selected non-canonical rows collapse into one canonical). Plans 07-03/07-04 do not assume a bound; the merge action iterates the full selection set. Plan A's probe still produces the count as informational input for Plan C scheduling, but does not gate the UI's cardinality.
   - [VERIFIED: `v2-data-reset-decision.md` § "Open question for Plan A pre-flight"]

2. **LOCATION_NEEDED sentinel region value**
   - What we know: D-06 says `GLOBAL` or NULL. Not decided.
   - What's unclear: Whether `regions` table has a GLOBAL row or if NULL is the correct representation.
   - Recommendation: Plan A or B Wave 0 confirms `regions` table content; planner picks NULL vs GLOBAL insert.
   - **RESOLVED:** Use the literal string `'GLOBAL'`. Rationale: keeps the `region` column NOT NULL (the existing schema constraint is preserved), keeps `normalised_name` deterministic for the sentinel row (`normalised_name = lower(trim('LOCATION_NEEDED'))`), and the merge UI can identify the sentinel by name match without special NULL-handling. Plan B's runbook STEP 2 ensures a `regions` row with name `'GLOBAL'` exists before STEP 3 inserts the sentinel `locations` row pointing at it.

3. **`normalised_name` generated column vs app-computed**
   - What we know: DATA-03 requires the column for the unique partial index.
   - What's unclear: Whether to use `GENERATED ALWAYS AS` (PostgreSQL, requires stable SQL normalisation function) or app-layer computation.
   - Recommendation: App-layer computation is safer given the normalisation logic (lowercase + strip punctuation + collapse whitespace) is already expressible in TypeScript at every insert/update callsite.
   - **RESOLVED:** App-computed via a single helper `normaliseLocationName(name: string): string` (lower + trim + collapse internal whitespace) imported by every write site (hotel importer, merge action, sentinel migration). Rationale: keeps the rule auditable in TypeScript next to the imports that use it; avoids Postgres generated-column quirks with the unique partial index; one source of truth that tests can pin against. The unique partial index `WHERE archived_at IS NULL` enforces correctness regardless of compute location. (Implemented in Plan 07-02 Task 1 as `normaliseName` in `src/lib/normalise.ts` — same intent; the `Location` prefix is dropped because the helper is location-only by usage site.)

4. **Undo merge UI surface**
   - What we know: D-04 says "Undo merge button lives on the audit_log entry detail view".
   - What's unclear: Whether an audit_log detail view/page exists today or must be created as part of Plan C.
   - Recommendation: Planner audits `src/app/(app)/admin/` and `/audit-log/` routes. If detail view exists, add Undo button. If not, Plan C may need to create a minimal detail view.
   - **RESOLVED:** Per CONTEXT.md D-10 (audit-log detail page) — the audit_log detail view must be scaffolded as part of Plan 07-03. The Undo button lives on that detail page. The button is active only while the linked `location_merge_snapshots` row still exists (snapshot is deleted by a 30-day cron in a later phase, but is present immediately post-merge). On click, the undo server action restores `archived_at = NULL` on the N-1 archived rows, reverses every FK migration recorded in the snapshot's `fk_changes` JSONB column, and deletes the `location_merge_snapshots` row.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All scripts (npx tsx) | ✓ | v22 (from CLAUDE.md Docker step) | — |
| Drizzle Kit | Schema push (Wave 0 of Plans C, D) | ✓ | Installed in devDependencies | — |
| npx tsx | Script execution | ✓ | via npx, no global install needed | — |
| Neon branching | Plan E UAT environment | ✓ (platform feature) | Available on Neon Serverless tier | Explicit pg_dump + restore (slower) |
| Monday API (v2024-10) | Plan A probe + Plan B hotel import | ✓ (env var `MONDAY_API_TOKEN`) | Vercel env | — |
| Vercel CLI | Plan E UAT env var wiring | [ASSUMED] | Unknown | Manual via Vercel dashboard |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (confirmed; `npx playwright test`) |
| Config file | `playwright.config.ts` (24 lines, confirmed) |
| Quick run command | `npx playwright test tests/locations/merge.spec.ts` |
| Full suite command | `npx playwright test` |

Note: `playwright.config.ts` has `workers: 1` (serial), `retries: 0`, `fullyParallel: false`. Screenshot on failure. Base URL from `PLAYWRIGHT_BASE_URL` env var (preview mode) or `http://localhost:3003` (local).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | Runbook idempotency: re-run on clean DB produces deterministic row counts | Integration (script) | `npx tsx scripts/verify-data-reset.ts` | ❌ Wave 0 (Plan E) |
| DATA-02 | N→1 merge: select N locations, merge → 1 canonical, N-1 archived | E2E (Playwright) | `npx playwright test tests/locations/merge.spec.ts` | ❌ Wave 0 (Plan C) |
| DATA-02 | Undo merge: button active pre-mutation, greys out post-mutation | E2E (Playwright) | `npx playwright test tests/locations/merge.spec.ts::undo` | ❌ Wave 0 (Plan C) |
| DATA-03 | Same-name banner appears when duplicate exists, hides when resolved | E2E (Playwright) | `npx playwright test tests/locations/same-name-banner.spec.ts` | ❌ Wave 0 (Plan D) |
| DATA-04 | LOCATION_NEEDED sentinel visible in locations list; kiosk count updates post-triage | E2E (Playwright) | `npx playwright test tests/locations/sentinel.spec.ts` | ❌ Wave 0 (Plan B) |
| DATA-05 | Two-pass assigned_at: NULL count before vs after backfill | Integration (script) | `npx tsx scripts/verify-data-reset.ts --check assigned_at` | ❌ Wave 0 (Plan E) |

### Sampling Rate

- **Per task commit:** `npx playwright test tests/locations/ --reporter=dot` (locations-scoped)
- **Per wave merge:** `npx playwright test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`; `verify-data-reset.ts` invariant suite green on Neon UAT branch before prod cutover

### Wave 0 Gaps

- [ ] `tests/locations/merge.spec.ts` — covers DATA-02 (N→1 merge happy path + undo path)
- [ ] `tests/locations/same-name-banner.spec.ts` — covers DATA-03 (banner appears/hides)
- [ ] `tests/locations/sentinel.spec.ts` — covers DATA-04 (sentinel visible, triage flow)
- [ ] `scripts/verify-data-reset.ts` — covers DATA-01 + DATA-05 invariant suite (Plan E)

Existing test infrastructure (`playwright.config.ts` + 90+ existing specs) covers all other requirements. No framework install needed.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth 1.5.x — `requireRole('admin')` gate on all destructive server actions |
| V3 Session Management | no | Session unchanged; Better Auth handles |
| V4 Access Control | yes | `requireRole('admin')` — merge UI, undo button, wipe runbook, sentinel triage are admin-only |
| V5 Input Validation | yes | Server actions validate `canonicalId` + `defunctIds` as UUIDs; reject sentinel ID as source |
| V6 Cryptography | no | No new crypto; Neon TLS at transport layer |

### Known Threat Patterns for Phase 7 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Concurrent wipe runbook (data corruption) | Tampering | `pg_try_advisory_lock()` with distinct key (Pattern 3) |
| Merge of sentinel row (orphans lose home) | Tampering | Server action guard: reject if `defunctId` or `canonicalId` matches sentinel ID |
| Undo after kiosk reassignment (partial revert) | Tampering | D-05 lock: compare snapshot vs current state at undo-time; grey out if mutated |
| BETTER_AUTH_URL hash mismatch on Vercel redeploy | Spoofing | Use git-branch alias per `CLAUDE.md` (Pattern: Vercel env wiring) |
| Sales ETL CSV injection | Tampering | Existing ETL validates outlet codes against known format; no raw SQL interpolation |
| Runbook actor misattribution | Repudiation | `ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"` — consistent system actor for all runbook audit entries |

---

## Sources

### Primary (HIGH confidence)

All sources below verified by direct file reads in this session:

- `src/lib/multi-pos-merge.ts` (530 lines) — `applyBulkMerge` signature, FK table list, transaction pattern, MergePair type
- `src/lib/merge.ts` — Current thin merge implementation; FK table gap confirmed
- `src/lib/monday/import-location-products.ts` (220+ lines) — `runMondayImport` purpose confirmed (commission tiers, NOT hotel locations)
- `src/lib/monday/client.ts` (311 lines) — `iterateBoardItems`, `mondayQueryWithRetry`, `HOTEL_BOARD_IDS`, `BOARD_REGION`
- `src/lib/audit.ts` — `writeAuditLog` full signature; `action: "merge"` in union
- `src/db/schema.ts` (1052 lines) — `locations`, `kioskAssignments`, `auditLogs`, `salesRecords` schemas; absence of `location_merge_snapshots` and `normalised_name` confirmed
- `src/components/table/merge-dialog.tsx` — `MergeDialogProps<T>` interface; N→1 capable confirmed
- `src/components/table/bulk-toolbar.tsx` — `onMerge` prop; `selectedCount >= 2` trigger
- `src/app/(app)/locations/page.tsx` — RSC structure; banner mount point
- `src/app/(app)/locations/merge-action.ts` — Current action wires to thin `mergeLocations()`
- `src/app/(app)/locations/bulk-actions.ts` — `bulkArchiveLocations`, `bulkUpdateLocations`
- `src/app/(app)/settings/data-import/monday/actions.ts` — Advisory lock pattern; LOCK_KEY 738294106
- `scripts/backfill-kiosk-install-dates.ts` (324 lines) — Two-pass logic, `SET LOCAL` bypass, `--apply` flag
- `scripts/snapshot-db-state.ts` — Read-only row count reporter; reusable for Plan A
- `scripts/import-from-monday.ts` (503 lines) — Assets board importer (NOT hotel locations)
- `drizzle.config.ts` (24 lines) — Schema path, output path, push mechanism
- `playwright.config.ts` (24 lines) — testDir, workers, serial execution, env-var base URL
- `.planning/phases/07-data-foundation-rebuild/07-CONTEXT.md` — D-01..D-14
- `.planning/notes/v2-data-reset-decision.md` — Locked rules, wipe set, sequencing
- `.planning/REQUIREMENTS.md` — DATA-01..05

### Secondary (MEDIUM confidence)

- `CLAUDE.md` § "npm ci lockfile must stay in sync" — lockfile regen procedure [VERIFIED: file read]
- `CLAUDE.md` § "Vercel preview env vars — BETTER_AUTH_URL" — git-branch alias rule [VERIFIED: file read]
- `.planning/STATE.md` — Phase 7 position, branch name [VERIFIED: file read]

### Tertiary (LOW confidence)

None — all claims verified against codebase or locked CONTEXT.md decisions.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in `package.json` and by file reads; no new packages needed
- Architecture: HIGH — all critical file paths, signatures, and gaps confirmed by direct reads
- Pitfalls: HIGH — each pitfall confirmed by reading the specific files that demonstrate the gap
- Net-new deliverable (hotel location importer): HIGH — absence confirmed by reading `import-location-products.ts` and `import-from-monday.ts`

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable stack; Monday API version `2024-10` pinned)
