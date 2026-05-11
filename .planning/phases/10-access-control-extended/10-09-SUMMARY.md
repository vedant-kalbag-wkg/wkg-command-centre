---
phase: 10-access-control-extended
plan: 09
subsystem: database
tags: [drizzle, migration, journal, gap-closure, prod-deploy]

# Dependency graph
requires:
  - phase: 10-access-control-extended
    provides: "Phase 10 SQL migration files 0050-0053 (roles schema, seed/backfill, NOT-NULL flip, unique constraint) — present on disk but previously unregistered in drizzle journal"
provides:
  - "drizzle-kit migrate now discovers and applies migrations 0050, 0051, 0053 (and 0052 if operator-applied) on fresh DBs"
  - "Vercel build-time `drizzle-kit migrate` can deploy Phase 10 schema without operator psql intervention"
affects: [10-13-preview-deploy, 10-14-prod-deploy, any future phase that adds migrations on top of Phase 10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Journal sync as a separate plan when SQL files are hand-applied ahead of drizzle-kit"

key-files:
  created: []
  modified:
    - migrations/meta/_journal.json

key-decisions:
  - "Append 4 entries with monotonic when timestamps (1781300000000, 1781400000000, 1781500000000, 1781600000000) continuing the post-0049 cadence of +100_000_000 ms"
  - "No per-idx snapshot files created — project's drizzle version does not require them (idx 24..49 also lack snapshots and migrate fine)"
  - "0052 (NOT-NULL flip on user_scopes.role_id) is journal-registered but its application remains operator-gated per 10-HUMAN-UAT.md Step 4"

patterns-established:
  - "Journal-only sync: when SQL was hand-applied ahead of journal, append entries by hand (do NOT regenerate via drizzle-kit generate, which would emit divergent SQL)"

requirements-completed: [AUTH-06, AUTH-07]

# Metrics
duration: 5min
completed: 2026-05-11
---

# Phase 10 Plan 09: Drizzle Journal Sync for Phase 10 Migrations Summary

**Registered four Phase 10 SQL migration files (0050-0053) in `migrations/meta/_journal.json` so `drizzle-kit migrate` discovers them on fresh DB deploys, unblocking Vercel build-time prod deploys without operator psql intervention.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-11T11:15:00Z
- **Completed:** 2026-05-11T11:18:01Z
- **Tasks:** 2 (1 edit, 1 verification)
- **Files modified:** 1

## Accomplishments
- Journal now has 54 entries (idx 0..53), four new Phase 10 entries appended after idx 49
- All four entries match the project's existing shape: version="7", breakpoints=true, monotonic when timestamps
- `drizzle-kit migrate` can now discover and apply 0050 (roles schema), 0051 (seed/backfill), 0053 (role_permissions unique constraint) on a fresh DB
- 0052 (operator-gated NOT-NULL flip) is registered but its application remains separate (per runbook)
- No SQL files modified, no snapshot files created — pure journal-only sync

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: Journal sync for 0050-0053 + verification** — `1a35aa5` (chore)

Task 2 was verification-only (no file modifications), so it shares the Task 1 commit.

## Files Created/Modified
- `migrations/meta/_journal.json` — Appended 4 entries (idx 50..53) for tags `0050_phase_10_roles_schema`, `0051_phase_10_seed_and_backfill`, `0052_phase_10_user_scopes_role_id_required`, `0053_phase_10_role_permissions_unique`. Total entries: 50 → 54.

### Entries appended

| idx | when            | tag                                              |
|-----|-----------------|--------------------------------------------------|
| 50  | 1781300000000   | `0050_phase_10_roles_schema`                     |
| 51  | 1781400000000   | `0051_phase_10_seed_and_backfill`                |
| 52  | 1781500000000   | `0052_phase_10_user_scopes_role_id_required`     |
| 53  | 1781600000000   | `0053_phase_10_role_permissions_unique`          |

All four entries:
- `version`: `"7"` (matches every other journal entry — drizzle dialect/journal-format version)
- `breakpoints`: `true` (matches existing journal shape)
- `when`: strictly monotonically increasing, each +100_000_000 ms after the previous, continuing the post-0049 cadence (0049=1781200000000)

### Confirmation: no snapshot files generated

```bash
$ ls migrations/meta/*.json | grep -E '^migrations/meta/00(50|51|52|53)_snapshot\.json$'
# (no output — confirmed)
```

The project's drizzle version does not require per-idx snapshots for migration application (idx 24..49 already lack snapshots and `drizzle-kit migrate` works fine for them).

### Confirmation: no .sql files modified

```bash
$ git diff --name-only HEAD~1 HEAD
migrations/meta/_journal.json
```

Only the journal was touched. The four SQL files on disk (0050, 0051, 0052, 0053) remain byte-identical to what was psql-applied to the preview DB during UAT.

## Decisions Made
- **Manual append, not `drizzle-kit generate`** — regenerating would rewrite the entire journal and potentially emit new SQL diverging from what was already applied to the preview DB. The four .sql files are frozen; only the journal needs to learn about them.
- **No snapshot files** — verified by the existing pattern (idx 24..49 have no snapshots and migrate fine).
- **0052 stays operator-gated** — registering it in the journal makes drizzle-kit aware of it, but its application against prod still requires the pre-check `SELECT COUNT(*) FROM user_scopes WHERE role_id IS NULL = 0` per 10-HUMAN-UAT.md Step 4. The journal entry alone does not auto-apply 0052 in any unsafe way; it's applied in `idx` order along with the rest, and the threat register entry T-10-09-03 documents this is an accepted operator-gated risk.

## Deviations from Plan

None — plan executed exactly as written. Task 1 edit was applied and verified, Task 2 verifications all passed.

## Issues Encountered

**1. Initial Edit applied to wrong working tree (main repo path instead of worktree path)**

- **Found during:** Task 1 verification (length check returned 50, not 54)
- **Cause:** First `Read` of the journal used the relative-style path which resolved to the main repo location, and the subsequent `Edit` wrote to that same path. The worktree journal was untouched.
- **Fix:** Reverted main-repo change with `git checkout -- migrations/meta/_journal.json` (main-repo journal restored to 50 entries, clean state). Re-applied the Edit using the absolute worktree path `/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/.claude/worktrees/agent-a09885b84970c5587/migrations/meta/_journal.json`.
- **Verification:** Worktree journal now reports `jq '.entries | length' = 54` and the main-repo journal is back to 50 (untouched).
- **Impact:** Zero functional impact on the plan output — the worktree commit reflects exactly the entries specified. The misdirected edit was fully reverted before the worktree was modified.

## User Setup Required

None — no external service configuration required. Plan is journal-only.

## Next Phase Readiness

- Journal is internally consistent: idx sequence 0..53 with no gaps, no duplicates.
- All four new tags have corresponding `.sql` files on disk.
- `drizzle-kit --help` exits 0 (drizzle-kit binary is operational against the modified config).
- Ready for Plan 10-13 (preview deploy) and 10-14 (prod deploy) to invoke `drizzle-kit migrate` and have it apply the four Phase 10 migrations end-to-end.

### Operator notes for prod deploy

- On a fresh prod DB, drizzle-kit will attempt to apply migrations 0050, 0051, 0052, 0053 in ascending idx order.
- 0052 will only succeed if `user_scopes.role_id` is fully backfilled (no NULLs). 0051 performs the backfill via the role-id mapping seeded by 0050, so the natural application order (0050 → 0051 → 0052) is safe on a fresh DB.
- For a live prod DB that already has data, follow the operator-gated runbook in `.planning/phases/10-access-control-extended/10-HUMAN-UAT.md` Step 4 before letting drizzle-kit apply 0052.

## Self-Check: PASSED

- File exists: `/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/.claude/worktrees/agent-a09885b84970c5587/.planning/phases/10-access-control-extended/10-09-SUMMARY.md` — written by this step
- Commit exists in `git log --oneline`: `1a35aa5 chore(10-09): register Phase 10 migrations 0050-0053 in drizzle journal` (verified before SUMMARY write)
- Journal verified: `jq '.entries | length' migrations/meta/_journal.json = 54`, idx sequence 0..53 with no gaps, all four new tags match the .sql files on disk

---
*Phase: 10-access-control-extended*
*Completed: 2026-05-11*
