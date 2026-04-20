# Vercel Bug Sweep 2026-04-20 — Design

Bundled fix + feature pass addressing 15 issues found on the deployed Vercel app. Shipped as a single bugfix branch / PR so related touchpoints (filter bar, analytics store, Monday import) land atomically.

## Items

| # | Title | Type |
|---|---|---|
| 1 | Missing Asset IDs & unassigned venues for outlet 2W on /kiosks | Data / import |
| 2 | /locations missing addresses + all params inline-editable (esp. assignee / internal POC, app-wide) | Feature |
| 3 | New installation should redirect to /installations after save | Bugfix |
| 4 | Calendar `< today >` + Month/Week/Day buttons don't match theme | Bugfix |
| 5 | /products row click no-ops + stale "coming soon" toast | Bugfix |
| 6 | Kiosk config groups not imported from Monday (col 1466686598), linked via Location | Feature / import |
| 7 | Low Performer Patterns + configurable R/Y/G threshold on portfolio | Feature |
| 8 | High Performer Patterns: Revenue/Room instead of Kiosks/Location | Change |
| 9 | Remove Apply Filters button — filters auto-apply | Bugfix |
| 10 | Heat-map composite score weights user-configurable, horizontal stacked bar viz | Feature |
| 11 | Trend builder weather requires exactly one location group | Feature |
| 12 | Kill inflight analytics query on tab navigation | Bugfix |
| 13 | Hotel/Location group selectors show names (not UUIDs), empty-state overlay à la regions | Bugfix / UX |
| 14 | Maturity buckets based on user-selected end date, not NOW() | Bugfix |
| 15 | Pivot table 500 Server Components render error | Bugfix |

## Scope decisions (user-confirmed)

- **#2 editable fields:** all location columns editable inline, with assignee / internal POC editable across every table in the app where those fields exist.
- **#6 data model:** kiosk config group is a property of the **location** (not the kiosk). Import writes `locations.kiosk_config_group_id`.
- **#7 threshold:** two inputs (green cutoff %, red cutoff %) drive both High and Low pattern sections symmetrically.
- **#8:** Period-total revenue ÷ period-total rooms. Not per-day normalized.
- **#10:** Hard-block Apply while sum ≠ 100; red banner shows current sum. Full-width horizontal stacked bar replaces transparency swatches. Reset button returns 30/20/25/15/10.
- **#13:** Single-select dropdown (hotel group + location group), matching regions layout. Overlay prompt until a group is picked.

## Approach

1. **Branch:** `fix/vercel-bug-sweep-20260420` off `main`.
2. **Parallel execution** via subagents where files don't overlap. Wave plan in the accompanying plan doc.
3. **Per-item commits** with conventional prefixes (`fix(...)`, `feat(...)`), so the PR diff can be reviewed issue-by-issue.
4. **Playwright smoke** per user-visible change (mandated by project CLAUDE.md).
5. **PR:** opens against `main` with summary linking each commit back to the item number.

## Out of scope

- Anything not in the 15-item list. No opportunistic refactors. No dark-mode backlog. No new abstractions.

## Risk / rollback

- Each commit is atomic → bisectable.
- `locations.kiosk_config_group_id` (#6) is additive — nullable column + migration. Safe to ship with empty values.
- Heat-map weight store (#10) has a default preset equal to current fixed weights → zero behaviour change if user never interacts.
