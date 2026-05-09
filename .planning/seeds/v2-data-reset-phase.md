---
title: v2 first phase — Data reset and rebuild from Monday
trigger_condition: v2 milestone scoping begins (i.e. /gsd-new-milestone is run)
planted_date: 2026-04-29
---

# Seed: v2 Data Reset Phase

When `/gsd-new-milestone` runs for v2, this should surface as the **first** v2 phase candidate. Rationale + locked rules in `.planning/notes/v2-data-reset-decision.md`. Supersedes `tasks/v2-carryover-from-v1-phase-6.md` § V2-DM-01.

## Strawman: 5-plan phase

### Plan A — Pre-flight prep
- Probe Monday cleanliness for the 19 same-name groups (extend `scripts/probe-monday-vs-db-addresses.ts` to count Monday items per normalised hotel name across the 4 hotel boards: 1356570756, 1743012104, 5026387784, 5092887865)
- Decide canonical for `LOCATION_NEEDED` sentinel row (name, address-as-placeholder, region)
- Document `assigned_at` two-pass seed rule + verify `scripts/backfill-kiosk-install-dates.ts` behaviour matches it
- Pre-wipe Neon point-in-time snapshot procedure
- Inventory `appSettings` + `pipelineStages` + saved-view tables to confirm preservation list

### Plan B — Wipe + re-seed runbook
- Scripted truncate of the wipe set (`locations`, `kiosks`, `products`, ..., `auditLogs`, `kioskAssignments`, test-rollout substrate, staging) — preserves auth, app config, user customisations
- Re-run `runFullImport` against the 4 hotel boards
- Sales ETL from `seed_data/*.csv` with `LOCATION_NEEDED` fallback for unknown outlet codes (creates kiosk + assigns to sentinel)
- Run `scripts/backfill-kiosk-install-dates.ts --apply` for two-pass `assigned_at`
- Re-run geocoding batch via `/settings/geocoding`
- Idempotency check: re-run the runbook end-to-end on a fresh DB and verify deterministic output

### Plan C — Location merge UI (admin feature)
- Server action: select N location IDs → merge into 1 canonical (rules: kiosks reattach via `kiosk_assignments`, sales rewrite, audit entry, archive non-canonical with `archived_at`)
- Underlying logic exists in `scripts/multi-pos-merge.ts` (incl. the Drizzle `inArray` fix in commit b58a70b) — lift into a server action
- Admin UI: locations list with multi-select + "merge into..." action, picking canonical, preview of merge consequences, confirm
- RBAC: admin-only; per-action audit_log entry citing actor + selected location IDs + canonical
- Undo path: TBD during plan (snapshot-based recovery vs reverse-via-merge-proposal)
- After Plan C ships, `scripts/multi-pos-merge.ts` is legacy

### Plan D — Same-name prevention guardrails
- DB unique partial index: `UNIQUE (normalised_name) WHERE archived_at IS NULL`
- `runDryImport` warns when import would create a same-name candidate (operator can pre-merge in Monday or accept and merge in-tool post-import)
- Admin alert / dashboard surface if a same-name group sneaks past

### Plan E — Verification + UAT
- Pre-wipe + post-wipe DB snapshots, golden-set diff (kiosk count, location count, sales row count, total-revenue invariant, kiosk-to-location mapping changes)
- Operator UAT on a Vercel preview pointed at a clone of prod that's been put through the runbook
- Bar set by Phase 6 destructive UAT pattern (`06-HUMAN-UAT.md`)
- Sign-off before prod runbook execution

## When this seed surfaces

Run `/gsd-explore` or `/gsd-discuss-phase` against this seed during v2 milestone scoping. If the seed remains accurate at scoping time, promote it to a real phase via `/gsd-add-phase`. If consumer pain (analytics fragmentation) has resolved by other means, demote.
