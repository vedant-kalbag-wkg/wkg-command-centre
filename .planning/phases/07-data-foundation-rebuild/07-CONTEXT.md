# Phase 7: Data Foundation Rebuild - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace v1.0's data layer with a Monday-authoritative wipe-and-rebuild, and ship a first-class admin UI for ongoing location-merge cleanup so destructive operator ops never require a developer running a script again. Subsumes V2-DM-01, V2-DQ-01..03, MIGR-07/08 from v1.0 carryover. Requirements: DATA-01..05.

Out of scope (other phases):
- Email/notifications/scheduled reports → Phase 8/9
- Granular RBAC + custom roles → Phase 10
- Bidirectional Monday sync / drift detection → Phase 11 (V2-MONDAY-01)
- 2024-onwards sales corpus backfill → deferred to `.planning/seeds/v2-sales-corpus-backfill.md`

</domain>

<decisions>
## Implementation Decisions

### Merge UI cardinality (DATA-02 / Plan C)
- **D-01:** Server action accepts N → 1 (not just 2 → 1). Operator can select 3, 4, or 8+ locations and merge them into a single canonical row. Reflects the real-world clusters on prod (e.g. the 8-row Residence Inn group) and is non-negotiable per user direction during this discussion.
- **D-02:** The same UI/server-action stack handles two flows:
  - **Location merge** — N locations → 1 canonical (V2-DM-01 same-name groups)
  - **Sentinel triage** — M kiosks under `LOCATION_NEEDED` → 1 existing real location (lift orphans off the sentinel without deleting the sentinel)
  Both share preview-of-consequences screen, atomic server action, audit_log entry, and snapshot-before-commit (D-03..05).

### Merge undo path (DATA-02 / Plan C)
- **D-03:** Snapshot-before-commit. Inside the same DB transaction as the merge, capture the pre-merge state of every affected row (`locations`, `kiosk_assignments`, `salesRecords` pointers — and any other table the merge mutates) into a `location_merge_snapshots` table keyed by the merge's `audit_log` id.
- **D-04:** "Undo merge" button lives on the audit_log entry detail view; admin-only. Replays the snapshot in reverse inside a single transaction and writes a paired audit entry citing the original merge id.
- **D-05:** Indefinite retention, but **lock the Undo button once any merged `kiosk_assignment` row has been mutated post-merge** (e.g. operator reassigned a kiosk). UI greys out + shows the reason ("kiosk_assignment N modified at <timestamp> after merge"). Detection: compare current row state against snapshot at undo-time. Prevents partial-revert footguns where undo would resurrect stale state.

### LOCATION_NEEDED sentinel (DATA-04 / Plan B)
- **D-06:** **Single global sentinel** row. Name `LOCATION_NEEDED`, region `GLOBAL` (or NULL — Plan A pre-flight to confirm), address `PENDING ASSIGNMENT`. Created once during the wipe-and-rebuild reseed; not regenerated.
- **D-07:** Operator triages on `/locations/<sentinel-id>` using the **Plan C merge UI in sentinel-triage mode** (D-02): multi-select N orphan kiosks + pick destination location → reassign atomically + audit entry. No dedicated "reassign orphan" UI; one merge-UI surface handles both location merge and orphan triage.

### Same-name guardrail surface (DATA-03 / Plan D)
- **D-08:** **Banner on `/locations` + status row on `/admin/health`.** When N > 0 same-name groups exist among `archived_at IS NULL` rows, surface a yellow banner at the top of `/locations`: "N same-name groups detected — review" linking to a filtered list. Mirror as a status row on `/admin/health`. Dismiss = "fixed" (i.e. via merge); banner re-appears if a new dupe sneaks in.
- **D-09:** Detection runs against the live table — does NOT depend on an INSERT failing (the unique partial index already prevents that). The banner exists to surface dupes that get past the index because of timing windows (e.g. both rows still active, or a row was un-archived). Refresh cadence: planning detail.
- **D-10 [informational]:** Email digest of same-name alerts is **out of scope for Phase 7** — gated on Phase 8's Inngest+Resend substrate.

### UAT environment + go/no-go (DATA-01 / Plan E)
- **D-11:** **Neon branch from prod** for the UAT environment. Fork prod via Neon's branching into a throwaway branch (e.g. `uat-phase-7-runbook`). Vercel preview deploy points `BETTER_AUTH_URL` (git-branch alias per `CLAUDE.md`) and `DATABASE_URL` at the branch. Branch deleted after sign-off. Cheapest, fastest, copy-on-write reproducibility.
- **D-12:** **Automated UAT, Claude-driven, presented for go/no-go.** Plan E ships `scripts/verify-data-reset.ts` (or equivalent) emitting a structured JSON + human-readable invariant report. Claude executes the full sequence — runbook against the Neon branch → verify → synthesise summary highlighting any issues/inconsistencies → present to operator for a single conversational go/no-go decision. On "go", Claude runs the runbook against prod and re-runs verify against prod, presenting the final report.
- **D-13:** Invariant suite covers (at minimum, planner to expand): kiosk count vs golden snapshot, location count, sales row count, total-revenue invariant, no orphan `kiosk_assignments` (every assignment points at a live kiosk + live location), no active same-name groups, `LOCATION_NEEDED` sentinel orphan count surfaced not failed, two-pass `assigned_at` coverage (NULL count before vs after), audit_log integrity (entries cite the runbook's actor).
- **D-14:** No operator-facing 06-HUMAN-UAT.md document. The structured invariant report + Claude's synthesised summary replace the v1.0 Phase 6 destructive-UAT pattern as the primary gate. The Phase 6 doc remains a reference for shape, not the bar.

### Claude's Discretion
- Snapshot table column shape, indexing, and whether `location_merge_snapshots.payload` is JSONB or a normalised set of typed columns
- Exact banner refresh cadence / detection mechanism (cron, on-route-load query, materialised view)
- Invariant suite output format details (Markdown? JSON? both?)
- Plan ordering within the phase (strawman A→B→C→D→E is a starting point; planner may reorder)
- Pre-wipe Neon point-in-time snapshot mechanics (Plan A inventory step)
- Whether the runbook lives as a single `scripts/v2-reset.ts` orchestrator or N composable scripts

</decisions>

<specifics>
## Specific Ideas

- "I want it automated — full automated UAT followed by a go/no go decision" — user's own words on the cutover bar; this is why the v1.0 Phase 6 manual destructive-UAT pattern is replaced with a Claude-driven invariant suite.
- "I also want the ability to merge multiple locations into one at once, not just two into one" — non-negotiable N→1 cardinality on the merge server action.
- The legacy `scripts/multi-pos-merge.ts` becomes the reference implementation for the server action's merge logic (incl. the Drizzle `inArray` fix in commit `b58a70b`). It is NOT executed in Phase 7 — its role is to hand its logic over to the Plan C server action and then be marked legacy.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked architectural decisions (read first)
- `.planning/notes/v2-data-reset-decision.md` — Locked rules: Monday is SoT, no manual SQL for ops, LOCATION_NEEDED sentinel, two-pass assigned_at, what-wipes-vs-survives table. **Most load-bearing doc for this phase.**
- `.planning/REQUIREMENTS.md` § A. Data foundation rebuild (DATA-01..05) — Active requirements
- `.planning/ROADMAP.md` § Phase 7: Data Foundation Rebuild — Goal, success criteria (SC1..6), strawman 5-plan structure
- `.planning/seeds/v2-data-reset-phase.md` — Strawman plans A pre-flight, B wipe+reseed, C merge UI, D guardrails, E verification+UAT (likely promoted as-is per ROADMAP)

### Forward-looking + deferred
- `.planning/seeds/v2-sales-corpus-backfill.md` — 2024-onwards sales corpus backfill (deferred; informs two-pass `assigned_at` re-run logic)
- `tasks/v2-carryover-from-v1-phase-6.md` § V2-DM-01, V2-DQ-01, V2-DQ-02, V2-DQ-03, V2-MONDAY-01 — Items Phase 7 subsumes

### Existing code the plans must reuse
- `scripts/multi-pos-merge.ts` — Reference implementation for Plan C merge logic (incl. Drizzle `inArray` fix in commit `b58a70b`). Becomes legacy after Plan C ships.
- `scripts/backfill-kiosk-install-dates.ts` — Two-pass `assigned_at` rule already implements the live_date → MIN(salesRecords.date) fallback; Plan B re-uses with `--apply`.
- `scripts/probe-monday-vs-db-addresses.ts` — Plan A extends to count Monday items per normalised hotel name across the 4 hotel boards (1356570756, 1743012104, 5026387784, 5092887865).
- `scripts/enrich-locations-from-monday.ts` — Read-only Monday enrichment path (one-way, NULL-fields-only); reference for the wipe-and-rebuild's Monday import.
- `seed_data/*.csv` — Sales seed (Jan/Feb/Mar 2026 corpus) for Plan B's sales ETL step

### v1.0 precedents
- `milestones/v1.0-phases/06-01-multi-pos-merge/` — D-03 ALL-OR-NOTHING single-transaction merge precedent
- `milestones/v1.0-phases/06/06-HUMAN-UAT.md` — Reference for destructive-UAT shape (NOT the bar — Phase 7 replaces with automated UAT per D-12/D-14)
- `milestones/v1.0-ROADMAP.md` — Closed v1.0 baseline

### Operational context
- `tasks/handoff-2026-04-27-pr-28-open.md` — Branch + post-merge runbook context (PR #28 is closed; pointers still useful)
- `CLAUDE.md` § "Vercel preview env vars" — `BETTER_AUTH_URL` git-branch alias rule for Plan E preview UAT
- `CLAUDE.md` § "Prod admin password rotation (Phase 8.6)" — Prod admin account context (for any actor-attribution questions)
- `CLAUDE.md` § "npm ci lockfile must stay in sync" — Avoid lockfile drift on any package additions during Phase 7

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Merge server-action substrate** — `scripts/multi-pos-merge.ts` already implements the kiosk reattach + sales rewrite + `archived_at` archival flow inside a single transaction. Plan C's job is to lift this into a reusable server action, add the snapshot-before-commit (D-03), wire the admin UI (D-01/02), and reroute the script to call the server action (or be marked legacy).
- **Two-pass `assigned_at`** — `scripts/backfill-kiosk-install-dates.ts --apply` already implements the `live_date` primary, `MIN(salesRecords.date)` fallback chain. Plan B's runbook just calls it.
- **Monday import** — `runFullImport` (3-step: hardware → hotels → config groups) is the canonical full-import path; `runDryImport` is the warning surface for D-09 same-name candidates.
- **Geocoding** — `/settings/geocoding` Apply (in-memory staging, no `geocoding_stagings` table) handles the post-reseed re-geocoding step.
- **Audit log substrate** — Application-layer audit log with denormalised actor/entity names is the standard; the snapshot table (`location_merge_snapshots`) keys onto its `id`.
- **Locations admin UI** — Existing list view is the host for the merge multi-select + the same-name banner (D-08).

### Established Patterns
- **No manual SQL for recurring operator ops** (locked 2026-05-03) — Plan C must replace `scripts/multi-pos-merge.ts` invocations on prod with the admin UI.
- **D-03 ALL-OR-NOTHING single-transaction merges** — Plan C server action follows this; partial-merge state is unrecoverable for sales rewrites. Snapshot is captured inside the same transaction.
- **Phase branching** (`gsd/phase-07-data-foundation-rebuild` per `git.branching_strategy: "phase"`) — every plan commits to this branch with summary commits per plan + a phase-completion commit before merge.
- **Vercel preview env-var pinning** — `BETTER_AUTH_URL` MUST use the git-branch alias for Plan E UAT (per `CLAUDE.md`).

### Integration Points
- **DB schema** — New: `location_merge_snapshots` table; unique partial index `UNIQUE (normalised_name) WHERE archived_at IS NULL` on `locations`. Modified: `locations` (sentinel row inserted at reseed); `kiosks` / `kiosk_assignments` (sentinel attachment path).
- **Wipe set vs preserve set** — Locked in `.planning/notes/v2-data-reset-decision.md` § "What wipes vs survives"; Plan A inventories `appSettings`, `pipelineStages`, saved-view tables to confirm.
- **Inngest** (Phase 8 substrate) — Phase 7 does NOT depend on Inngest. The same-name guardrail email digest (D-10) is gated on Phase 8 and remains out of scope here.
- **Better Auth** — RBAC `admin` role gates merge UI + undo button + sentinel triage. No changes to Better Auth in Phase 7.

</code_context>

<deferred>
## Deferred Ideas

- **Email digest for same-name guardrail alerts** — Gated on Phase 8 Inngest+Resend substrate. Phase 7 ships banner + admin/health surface only.
- **Bidirectional Monday sync / drift detection** — V2-MONDAY-01, scoped for Phase 11 per ROADMAP.
- **2024-onwards sales corpus backfill** — Already deferred to `.planning/seeds/v2-sales-corpus-backfill.md`. Phase 7 reseeds Jan/Feb/Mar 2026 from `seed_data/`; corpus depth growth is a future op.
- **CI-gated invariant check on every PR touching the runbook** — Plausible follow-up after the verify script proves out manually; not Phase 7 scope.
- **Banner refresh cadence + materialised view for same-name detection** — Planning detail; pick during Plan D, not now.

</deferred>

---

*Phase: 07-data-foundation-rebuild*
*Context gathered: 2026-05-04*
