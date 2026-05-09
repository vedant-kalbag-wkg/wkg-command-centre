# Phase 7: Data Foundation Rebuild - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 07-data-foundation-rebuild
**Areas discussed:** Merge-UI undo path, LOCATION_NEEDED sentinel granularity, Same-name guardrail admin surface, Wipe-and-rebuild UAT environment

---

## Merge-UI undo path

### Q1 — Undo model

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot before commit | Inside the merge txn, capture pre-merge state of every affected row into `location_merge_snapshots` keyed by audit_log id; "Undo merge" replays the snapshot | ✓ |
| Neon PITR + reverse-merge UI | No in-tool snapshot; recover via fresh reverse merge or Neon PITR citing audit_log timestamp | |
| Audit only — no undo | Merge irreversible by design; only Neon PITR available | |

**User's choice:** Snapshot before commit (recommended)
**Notes:** Self-contained in DB; no Neon-tier dependency.

### Q2 — Undo policy

| Option | Description | Selected |
|--------|-------------|----------|
| Indefinite, admin-only | Snapshots live forever; admin-only Undo button | |
| Indefinite, lock once kiosk_assignment changes | Snapshots live forever, but Undo greys out once any merged kiosk_assignment row is mutated post-merge | ✓ |
| Time-bounded (e.g. 7 days) | Snapshots purged after N days by cron | |

**User's choice:** Indefinite, but lock once a kiosk_assignment is changed post-merge
**Notes:** Prevents partial-revert footguns where undo would resurrect stale state. Detection: compare current row state against snapshot at undo-time.

---

## LOCATION_NEEDED sentinel granularity

### Q1 — Sentinel cardinality

| Option | Description | Selected |
|--------|-------------|----------|
| Single global sentinel | One row, region GLOBAL/NULL; all sales-orphans triage in one place | ✓ |
| Per-region (UK, AU, EU) | Three sentinels keyed by inferable region from POS prefix / currency | |
| Per-Monday-board (4 sentinels) | One per hotel board (Live Estate, Ready to Launch, Removed, AU DCM) | |

**User's choice:** Single global sentinel (recommended)
**Notes:** Matches v2-data-reset-decision.md wording "a single canonical LOCATION_NEEDED location".

### Q2 — Operator triage UX

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Plan C merge UI | Multi-select N orphan kiosks + open the same merge picker; reassignment shares preview/audit/snapshot stack with location merge | ✓ |
| Dedicated 'Reassign orphan' flow | Separate UI affordance with its own server action under /locations/<sentinel> | |
| Per-orphan inline action | Each orphan row has its own 'Move to real location' single-kiosk dialog | |

**User's choice:** Reuse Plan C, but add the requirement to merge multiple locations into one at once (not just two into one)
**Notes:** This was the most consequential addition of the discussion. It pushes the merge server action from "pair-wise (2→1) like the legacy `multi-pos-merge.ts`" to "N→1 where N can be 3, 4, 8+ (e.g. the 8-row Residence Inn cluster on prod)". The Plan C UI must therefore handle two flows on one server-action stack: (a) location merge (N locations → 1 canonical) and (b) sentinel triage (M kiosks under sentinel → 1 existing location). Captured as D-01/D-02 in CONTEXT.md.

---

## Same-name guardrail admin surface

### Q1 — Surface location

| Option | Description | Selected |
|--------|-------------|----------|
| Banner on /locations + /admin/health | Yellow banner "N same-name groups detected — review" + status row on health page; no email | ✓ |
| Email digest via Phase 8 substrate | Daily digest once Inngest+Resend ships in Phase 8; gated on Phase 8 | |
| Hard error in import job ledger | Surfaced only during/after import runs in the job ledger | |
| All three layered | Banner + import warning + email digest | |

**User's choice:** Banner on /locations + /admin/health (recommended)
**Notes:** Email digest deferred to Phase 8 — Phase 7 is detection + always-on banner only.

---

## Wipe-and-rebuild UAT environment

### Q1 — Clone-of-prod mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Neon branch from prod | Fork prod into throwaway Neon branch via copy-on-write; Vercel preview points at branch URL | ✓ |
| Explicit pg_dump + restore | Dump prod, restore into a freshly-provisioned Neon project | |
| Permanent staging DB, reset per UAT | Long-lived Neon project reset from a canonical dump before each UAT | |

**User's choice:** Neon branch from prod (recommended)
**Notes:** Cheapest, fastest, copy-on-write reproducibility. BETTER_AUTH_URL + DATABASE_URL on the preview point at the Neon-branch DB. Branch deleted after sign-off.

### Q2 — Sign-off bar

| Option | Description | Selected |
|--------|-------------|----------|
| 06-HUMAN-UAT.md pattern, scoped to data-reset | Markdown checklist mirroring v1.0 Phase 6 destructive-UAT doc | |
| Lighter checklist + Vedant-only sign-off | Markdown checklist only, Vedant validates, no formal invariant doc | |
| Full destructive-UAT doc + second reviewer | 06-HUMAN-UAT shape + a second human (e.g. Aman) sign-off | |
| (Free-text)| User wrote in: "I want it automated- full automated UAT followed by a go/no go decision" | ✓ |

**User's choice:** Free-text — automated UAT followed by a go/no-go decision (replaces the 06-HUMAN-UAT.md pattern as the primary gate)
**Notes:** Significant deviation from v1.0 Phase 6 precedent. Driver: "no manual SQL for ops" lock + Phase 7's destructive blast radius justifies machine-checked invariants over manual operator UAT.

### Q3 — Where does the UAT suite run + how is go/no-go surfaced

| Option | Description | Selected |
|--------|-------------|----------|
| CLI script + structured output + admin UI button | scripts/verify-data-reset.ts emits JSON+markdown; /admin/data-reset UI page shows pass/fail + 'Approve prod cutover' button | |
| CLI script only | Just the script; operator reads terminal output and decides go/no-go in shell | |
| CI-gated check on every PR | GitHub Action against ephemeral Neon branch on every PR touching the runbook | |
| (Free-text) | User wrote in: "Automated UAT to be run by Claude and summary presented to me for a go/no go after highlighting any issues or inconsistencies" | ✓ |

**User's choice:** Free-text — Claude drives the UAT cycle; presents synthesised summary for a single conversational go/no-go
**Notes:** Operating model is operator-via-Claude, not self-service. Plan E ships the invariant suite (`scripts/verify-data-reset.ts` or equivalent) with structured output; Claude (in execution) runs the runbook on the Neon branch → runs verify → synthesises summary highlighting issues/inconsistencies → operator decides go/no-go in conversation → on go, Claude runs the runbook on prod and re-runs verify, presenting the final report.

---

## Claude's Discretion

- Snapshot table column shape, indexing, JSONB vs normalised typed columns
- Banner refresh cadence / detection mechanism (cron, on-route-load query, materialised view)
- Invariant suite output format details (Markdown? JSON? both?)
- Plan ordering within the phase (strawman A→B→C→D→E is a starting point)
- Pre-wipe Neon point-in-time snapshot mechanics (Plan A inventory step)
- Whether the runbook lives as a single `scripts/v2-reset.ts` orchestrator or N composable scripts

## Deferred Ideas

- Email digest for same-name guardrail alerts — gated on Phase 8 Inngest+Resend substrate
- Bidirectional Monday sync / drift detection — V2-MONDAY-01, scoped for Phase 11
- 2024-onwards sales corpus backfill — already deferred to `.planning/seeds/v2-sales-corpus-backfill.md`
- CI-gated invariant check on every PR touching the runbook — plausible follow-up after the verify script proves out manually
- Banner refresh cadence + materialised view for same-name detection — planning detail, pick during Plan D
