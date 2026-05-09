# Deferred items — Phase 06

Out-of-scope discoveries logged during plan execution. Not fixed in this phase; tracked here for future cleanup.

## From plan 06-03 (KPI tooltip sweep)

### Pre-existing lint errors (`react-hooks/set-state-in-effect`)

Two files in this plan's scope have a pre-existing `useEffect → loadData()` pattern that lints clean against most rules but fails `react-hooks/set-state-in-effect`. These predate plan 06-03 — git blame:

- `src/app/(app)/analytics/commission/page.tsx:120` — commit `98a172a` (2026-04-18)
- `src/app/(app)/analytics/maturity/page.tsx:61` — commit `a3b6c8e` (2026-04-18)

Both are flagged by ESLint as errors but the same pattern repeats across every analytics dashboard's data-fetching `useEffect`. Refactoring them is out of scope for a tooltip-text sweep — would require either inlining the data-fetch in a render-time effect cycle, switching to a Suspense-based RSC pattern, or introducing a request-keyed cache. None of those changes belong in plan 06-03.

Proper place to address: a dedicated "analytics dashboards: migrate data-loading effects off setState-in-effect" pass, sized as its own plan, ideally bundled with the broader RSC-first refactor that the post-v1 work implies.
