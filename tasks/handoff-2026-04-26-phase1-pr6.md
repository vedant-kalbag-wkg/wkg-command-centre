# Session Handoff — wkg-kiosk-tool Analytics Audit Fix Plan

**Date**: 2026-04-26
**Branch**: `gsd/audit-quick-wins` (off `main` at `c2a5cfe`)
**Working tree**: clean
**Phase 1 progress**: 5 of 6 PRs landed; **PR-6 is next**.

> New session: start by reading **this file**, then `tasks/todo.md` (Resolved Decisions section) and `tasks/phase-1-pr-plan.md`. Then execute PR-6 per the spec at the bottom of this doc.

---

## What this work is

A deep audit of the wkg-kiosk-tool analytics system was completed 2026-04-25 → 2026-04-26 across 12 dashboards plus a live UAT against production. It found ~70 issues across systemic patterns, math correctness, filter wiring, dashboard-specific bugs, and kiosk-management UI gaps. A structured fix plan was created and execution began with 13 design decisions (D1–D13) resolved.

**Authoritative artefacts:**
- `tasks/analytics-audit/ANALYTICS-LOGIC.md` — per-dashboard metric definitions (1156 lines)
- `tasks/analytics-audit/ANALYTICS-ISSUES.md` — prioritised P0/P1/P2/P3 findings (939 lines)
- `tasks/analytics-audit/KIOSK-MANAGEMENT-AUDIT.md` — UI gap analysis (770 lines)
- `tasks/analytics-audit/LIVE-UAT.md` — live UAT against production (298 lines)
- `tasks/analytics-audit/parts/01–07-*.md` — per-cluster raw audits
- `tasks/analytics-audit/multi-pos-merge-proposal.csv` — 22 clusters / 29 defunct rows / 7,531 sales rows for human review before D8 merge
- `tasks/analytics-audit/multi-kiosk-locations.csv` — 51 active locations × 2 kiosks each for ops review

**Plan artefacts:**
- `tasks/todo.md` — 8-phase fix plan with 70+ tasks + Resolved Decisions D1–D13 at the bottom
- `tasks/phase-1-pr-plan.md` — Phase 1 decomposed into 6 PRs with file paths, acceptance criteria, dependencies, plus resolved cross-cutting open questions (OQ1–OQ5)

---

## Project context

| Field | Value |
|---|---|
| Repo | wkg-kiosk-tool (Next.js 16, React 19, Drizzle, Postgres, Better Auth) |
| Production URL | `https://wkg-command-centre.vercel.app/` (NOT `wkg-kiosk-tool.vercel.app` — that alias was removed 2026-04-26) |
| Prod admin | `vedant.kalbag@weknowgroup.com` / password `Admin123!` (rotated to this 2026-04-26 by UAT agent via `scripts/reset-admin-password.ts`) |
| Prod Neon project | `wkg-command-centre` (id `snowy-brook-77762738`), production branch `br-soft-block-abbitfyw` |
| Prod DATABASE_URL (read-only safe) | `postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require` |
| Active dataset | January 2026 only (Feb–Apr empty). UK region only (AU exists but has no sales). Commission/Experiments/Actions tables are empty. |

**User preferences** (project memory):
- Parallel subagents wherever possible (`superpowers:subagent-driven-development` + `andrej-karpathy-skills:karpathy-guidelines` are the working skills).
- Surgical changes only. No "while I'm here" refactors. No comments unless non-obvious.
- Use `playwright-cli` (CLI tool, NOT the library) with `--browser=chromium` for any browser work.
- Plan first, write to `tasks/todo.md`, commit with summary commits per logical chunk.
- GSD branching: phase branches (`gsd/<phase>-<slug>`).
- npm-ci-lockfile-sync is a real ongoing pain — see `CLAUDE.md` and `~/.claude/CLAUDE.md` before touching deps.

---

## What's landed on `gsd/audit-quick-wins` (19 commits past `main`)

**Audit + plan baseline:**
```
7161ddf docs(audit): analytics deep audit + UAT findings + fix plan
```

**Quick wins (Phase 8.3, 8.4, Phase 5 data CSVs):**
```
7c63745 build: fail Vercel Production build if BETTER_AUTH_SECRET unset
```
(Vercel alias `wkg-kiosk-tool.vercel.app` was also removed via `vercel alias rm` — operational, not a commit.)

**PR-1 (Tasks 1.6 + 1.7 — schema drift sweep + zero-scope safety):**
```
a6ac782 fix(scoping): throw on internal user with zero scopes; add 'system' role for ETL
d37a929 fix(analytics): sweep schema drift left over from migration 0022
fb99936 fix(analytics): pivot booking_fee includes 9991 + 9992 (parity with trend)
eaca7d1 perf(scoping): wrap scopedSalesCondition in React.cache
34d88b0 chore: review nits — comment trims, test rename, brand-correct system badge
```

**PR-2 (Task 1.1 — archived locations):**
```
81659f7 fix(analytics): exclude archived locations from getActiveLocationIds
```

**PR-3 (Task 1.2 — D2 reversal handling):**
```
a58320e feat(schema): add reversal columns to sales_records (D2 Part A)
a839cb9 feat(sales): match reversals at ingest and rewrite outlet attribution (D2 Part B)
bf70915 feat(analytics): reversal-aware KPI helpers in shared.ts (D2 Part C)
a175515 feat(scripts): one-shot backfill for D2 reversal columns (D2 Part D)
```
> **Note**: Migration 0027 was applied to neon-dev for verification; backfill ran on neon-dev showing 1701 full / 33 partial / 36 orphan reversals. **Not run against prod yet.**

**PR-4 (Task 1.3 — D1 + D10 fee semantics + COUNT sweep):**
```
38754d1 feat(schema): rename is_booking_fee → is_weknow_fee + parser sets flag for 9991+9992
156bdb4 refactor(analytics): collapse fee predicates to single-column is_weknow_fee check
59992d1 feat(analytics): D1 sweep — Transactions counts mode-invariant via FILTER aggregates
c0647da fix(analytics): address PR-4 review — CI test, commission scope, missed sweep
```
> **Note**: Migration 0028 applied to neon-dev. Numerical verification on dev: Transactions dropped from 95,103 → 45,672 (2.08× ratio matches live UAT prediction). **Not run against prod yet.**

**Plan refinement:**
```
24a0d7a docs(audit): phase 1 PR-level expansion
```

**PR-5 (Tasks 1.4 + 1.8 — 5-bucket maturity + Zod URL validation):**
```
34ac5de feat(analytics): adopt 5-bucket maturity convention (D3)
a7c90c0 feat(analytics): zod-validate URL filter params with toast (OQ5)
```

**Test state**: `npx vitest run --project unit` → 359 passed + 14 todo + 1 skipped. `npx tsc --noEmit` clean.

---

## Resolved decisions (full spec is in `tasks/todo.md` Resolved Decisions section)

| # | Topic | Resolution headline |
|---|---|---|
| D1 | Booking fee in COUNT(*) | Counts mode-invariant; SUMs mode-dependent. `buildSalesTxnCondition` filters fees + reversals from every count. |
| D2 | Reversal handling | New columns `is_reversal`, `original_record_id`, `processed_at_location_id`, `is_partial_reversal`. Refunds matched by `(ref_no, opposite sign, equal magnitude)`; refund's `location_id` rewritten to original's. |
| D3 | Maturity buckets | 5 buckets in months: `0-1`, `1-3`, `3-6`, `6-9`, `9+`. Reference date is `filters.dateTo` (never `NOW()`). Left-inclusive / right-exclusive boundaries. |
| D4 | Maturity install-date backfill | Source = `locations.liveDate` (Monday "Live Estate"). Per-kiosk granularity unrecoverable historically. 23 active outlets with no liveDate AND no sales stay NULL ("not yet installed"). |
| D5 | Membership dedupe | (regions) 1-per-location + UNIQUE constraint + cleanup of bogus UK memberships. (location groups) same. (hotel groups) keep N:N for legitimate JVs; split 34 comma-encoded JV rows into proper multi-memberships against existing standalone groups; archive the JV rows. Per-location dedup at query layer for hotel groups only. **Not yet implemented — this is PR-6.** |
| D6 | Hourly TZ | New `locations.iana_timezone` column. Region-default backfill mapping. Editable on detail form. Admin setting `analytics_display_timezone: local | utc`. |
| D7 | Heat Map normalisation | Postgres `PERCENT_RANK()` per metric (optimistic ties). Composite over global-filter-bar population. |
| D8 | Multi-POS sites | Locations = sites; kiosks = POS units. 18+ sites split across multiple location rows. Programmatic clustering by address; canonical record per cluster; merge with audit-log trail. CSV proposal already in `tasks/analytics-audit/multi-pos-merge-proposal.csv`. |
| D9 | Internal-account exclusion | Add `'internal'` to `locations.locationType`. Tag `BK` (Customer Service). Default-exclude with opt-in toggle. |
| D10 | Fee column rename | `is_booking_fee` → `is_weknow_fee`. Parser sets TRUE for 9991 + 9992. **Implemented in PR-4.** |
| D11 | freeTrialEndDate | Analytics handling parked until maintenance-fee story exists. Trial-ending-soon notification on kiosk-management UI. |
| D12 | Vercel alias | `wkg-kiosk-tool.vercel.app` removed. Canonical = `wkg-command-centre.vercel.app`. **Done.** |
| D13 | Kiosk config group UI | Picker on location detail (editor-level access). Drop dead `kiosks.kioskConfigGroupId` column. Member-management view on existing admin page. Source of truth = Monday column 1466686598. |

**Plus 5 OQs resolved in `tasks/phase-1-pr-plan.md`:**
- OQ1 (D2 backfill scope) — yes, rewrite all historical refunds.
- OQ2 (refund refNo grammar) — `-b`/`-c` are fee-companion markers (NOT reversal markers); refunds are plain negative-amount rows sharing the same `ref_no`.
- OQ3 (region UNIQUE shape) — keep composite PK + add UNIQUE(location_id).
- OQ4 (zero-scope safety) — new `role='system'`; ETL user promoted; **already implemented in PR-1.**
- OQ5 (invalid URL params) — toast/banner explaining what was ignored. **Already implemented in PR-5 via sonner.**

---

## What's left

### PR-6 — Tasks 1.5 + 1.9 (next session starts here)

This is the **last PR in Phase 1**. After it lands, all 9 systemic root causes are addressed and Phase 2 (math correctness fixes) opens. See spec at the bottom of this doc.

### After PR-6 — Phase 2 onwards

`tasks/todo.md` lists 8 phases. Phase 1 (root causes) ends with PR-6. Phases 2–8 are smaller, more independent units:
- **Phase 2** — math correctness (SUM(DISTINCT), Avg-monthly division, plateau detection, Heat Map composite, Hourly TZ, region distribution clamp, Pivot grand totals)
- **Phase 3** — filter wiring + scoping (Trend Builder + Pivot consume global filter bar, Commission scoping, Experiments temporal pass full filters, etc.)
- **Phase 4** — per-dashboard surface bugs (Category Performance, Performer Pattern metricMode, Outlet Tiers truncation, Bottom-20 overlap, Actions Dashboard UX, etc.)
- **Phase 5** — data restoration (Maturity install-date backfill, multi-POS merge after CSV review, address-data-quality fix)
- **Phase 6** — UX/cosmetic (outlet code disambiguation, threshold settings, tooltips, lat/lng population, admin TZ display flag)
- **Phase 7** — kiosk management (locationType editable, multi-select hotel-group picker, etc.)
- **Phase 8** — process/regression (CI smoke test, metric-mode invariant test, alias cleanup [done])

Plus follow-ups surfaced during Phase 1 execution (added to Phase 4 in `tasks/todo.md`):
- 4.20 — Compare dashboard's location entity-picker missing archived filter
- 4.21 — Experiments peer-matching missing archived filter
- 4.22 — D2 in-batch partial-refund matcher (closes 2% orphan gap)
- 4.23 — D2 reversal matcher cross-batch ORDER BY for determinism
- 4.24 — D2 reversal matcher cents-math for canonical equality

### Pre-prod migration runbook (when ready to deploy)

The PR-3 (migration 0027) and PR-4 (migration 0028) and PR-5 (no migration) are applied to neon-dev only. Before merging to main / deploying to production:
1. Run migrations 0027 + 0028 against the prod Neon branch (`br-soft-block-abbitfyw`).
2. Run `npx tsx scripts/backfill-reversals.ts` against prod (PR-3 Part D) — it's idempotent.
3. Verify: `SELECT COUNT(*) FROM sales_records WHERE is_weknow_fee = true` returns roughly 47,661 (the live-UAT-confirmed fee-row count) — close enough means the fee backfill ran. After PR-6 lands its own migrations, do those too.

---

## Critical context for the next session

### Skills to invoke at session start
1. `superpowers:subagent-driven-development` — executing implementation plans with subagents
2. `andrej-karpathy-skills:karpathy-guidelines` — surgical, simple, goal-driven
3. (If doing browser UAT) `playwright-cli` per user's strict preference (CLI not library, `--browser=chromium`)

### Probing prod (read-only)
Pattern, copied from existing scripts:
```bash
DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx tsx -e "
import { sql } from 'drizzle-orm';
import { db } from '/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/db';
async function main() {
  const r = await db.execute(sql\`SELECT 1 AS ok\`);
  console.log(r);
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

The project's `@/db` reads `process.env.DATABASE_URL` directly and doesn't auto-load `.env.local`, so you can override safely. Templates in `scripts/probe-install-dates.ts`, `scripts/propose-multi-pos-merge.ts`, `scripts/list-multi-kiosk-locations.ts`.

### Verification commands
```bash
npx tsc --noEmit                           # typecheck
npx vitest run --project unit              # unit suite (359 tests)
npx vitest run --project integration       # integration (Testcontainers Postgres)
git log --oneline c2a5cfe..HEAD            # commits since main
```

### Patterns established
- One implementer subagent per task. NEVER parallel implementer subagents (file conflicts).
- Two-stage review per task: spec compliance first, code quality second. Don't run quality if spec fails. Re-review after fixes.
- Commit per logical sub-part (e.g. PR-3 had 4 commits, one per Part).
- Apply migrations to neon-dev for verification; never to prod from a working branch.
- For trivial tasks (under ~30 LoC), inline-implement after the user's signal — don't dispatch agents for tiny edits.

### Things that might trip up a new session
1. **HEAD detachment risk**: an earlier agent did something that detached HEAD; recovered with `git update-ref refs/heads/gsd/audit-quick-wins <sha> && git checkout gsd/audit-quick-wins`. Watch for this if commits seem to "disappear" — they're likely in detached HEAD.
2. **`tsx` is a transitive dep** (via `drizzle-kit` and `vitest`). All `scripts/*.ts` invocations rely on this. Don't drop those packages without adding `tsx` directly first.
3. **Sonner is the toast library**, already mounted in `src/app/layout.tsx`. PR-5 wired the URL-validation warning toast through it.
4. **`wkg-kiosk-tool.vercel.app` is removed**. If a tool or doc references it, redirect to `wkg-command-centre.vercel.app`.
5. **Admin password** was rotated to `Admin123!` against prod by the UAT agent. If you need a different password, use `scripts/reset-admin-password.ts`.

---

## PR-6 spec — what to do next

Bundles two independent Phase-1 tasks. **One implementer agent**, two work parts. Plan reference: `tasks/phase-1-pr-plan.md` Tasks 1.5 + 1.9.

### Task 1.5 — Membership double-counting + data quality (D5)

Three different treatments per dimension (read `tasks/todo.md` Resolved Decisions D5 for the full spec):

**Part A — Region: 1-per-location**
- Migration `migrations/0029_*` adds `UNIQUE(location_id)` on `location_region_memberships` (composite PK `(location_id, region_id)` STAYS — per OQ3, layer the new constraint, don't replace).
- Cleanup script `scripts/cleanup-bogus-uk-memberships.ts`: for every active location with >1 region membership where one is UK, remove the UK membership (default-UK import bug). Idempotent + audit-log.
- Migration runs cleanup THEN adds constraint (or two coordinated migrations).

**Part B — Location groups: 1-per-location** (same shape as Part A)
- `UNIQUE(location_id)` on `location_group_memberships`.
- Cleanup script for the 19 multi-location-group locations the audit found.

**Part C — Hotel groups: keep N:N + split JV-encoded groups**
- Cleanup script `scripts/split-jv-hotel-groups.ts`: for each `hotel_groups` row whose name matches `/.+,.+/` (the 34 comma-encoded JVs from the audit), for each location membered to that JV, ensure memberships exist to BOTH constituent groups (audit confirmed they exist as standalone groups already), then remove the JV membership. After all locations migrated, archive the 34 JV rows (`archived_at = now()`). Idempotent + audit-log.
- No schema change — hotel_groups stays N:N.

**Part D — Import fix (Monday region defaulting)**
- `scripts/import-from-monday.ts:209-282` and `scripts/enrich-locations-from-monday.ts:347` have hardcoded UK defaulting. Stop defaulting; require Monday region; fail loudly if absent.

**Part E — Query layer: per-location dedup for hotel groups**
- `src/lib/analytics/queries/hotel-groups.ts`, `regions.ts` (hotel-groups-in-region), `comparison.ts` (hotel-group entity comparison): replace `INNER JOIN location_hotel_group_memberships AS m WHERE m.hotel_group_id IN (...)` with `WHERE EXISTS (SELECT 1 FROM ... WHERE ...)` to avoid fan-out for multi-group locations.
- Region/location-group queries don't need this anymore (Parts A+B make them 1:N).

### Task 1.9 — Region-scoped outlet exclusions

`outlet_exclusions` currently has just `outlet_code` (no region scoping). Now that AU exists, an exclusion for `Q5` matches `Q5` in EVERY region.

- Migration: add `region_id UUID NOT NULL` FK to `regions`. Backfill existing rows to UK region (verify by probing the table first; all current exclusions are presumably UK-only).
- `src/db/schema.ts` mirror.
- `buildExclusionCondition` in `src/lib/analytics/queries/shared.ts` — match by `(outlet_code, region_id)` jointly.
- Outlet-exclusions admin UI (`src/app/(app)/settings/outlet-exclusions/`): add region picker to create/edit form.

### Acceptance + commit structure for PR-6

**Acceptance** (must verify):
1. `npm run typecheck` passes.
2. Migrations apply cleanly to neon-dev.
3. Post-migration: `SELECT location_id, COUNT(*) FROM location_region_memberships GROUP BY 1 HAVING COUNT(*) > 1` returns 0 rows. Same for `location_group_memberships`.
4. JV-encoded `hotel_groups` rows are archived; their members now bind to standalone groups.
5. Hotel-group analytics queries use `EXISTS` not `INNER JOIN`. Verify with grep.
6. Import scripts no longer default to UK.
7. `outlet_exclusions.region_id` is NOT NULL, FK to regions.
8. Existing tests pass; new tests for dedup behaviour and cleanup script idempotency.

**Commits** (separate, one per Part):
- A: Region 1-per-location migration + cleanup
- B: Location-group 1-per-location migration + cleanup
- C: Hotel-group JV split (cleanup script + archive)
- D: Monday import fix (no UK default)
- E: Query-layer EXISTS rewrite (hotel groups)
- F: outlet_exclusions region_id (Task 1.9)

**Subagent-driven flow**: dispatch one implementer with the prompt above, then a spec+quality reviewer, fix any rework, mark complete.

After PR-6, all of Phase 1 is done. The next session should also (a) update `tasks/todo.md` to mark Phase 1 tasks complete, (b) decide whether to merge `gsd/audit-quick-wins` to `main` and continue from there, or stay on this branch through Phase 2.

---

## Recommended new-session opening line

> "Read `tasks/handoff-2026-04-26-phase1-pr6.md`, then continue with PR-6 per the spec at the bottom. Use `superpowers:subagent-driven-development` and `andrej-karpathy-skills:karpathy-guidelines`."

That should land the next session straight into productive work.
