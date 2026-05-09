# Milestones

## v1.0 MVP — Kiosk Management Platform (Shipped: 2026-04-29)

**Phases:** 7 (1, 2, 3, 4, 4.1, 5, 6) — all complete
**Plans:** 34/34 GSD-tracked (Phase 5 delivered off-GSD via PRs #23 → #29)
**Tasks:** 61
**Timeline:** 2026-03-18 → 2026-04-29 (~6 weeks)
**Source:** 667 TS/TSX/SQL files, ~92.8k LOC; 37 prod DB migrations (0001 → 0037)
**PRs merged:** 11 in this repo + 18 on the feeder kiosk-management codebase that fed into the analytics-audit arc (#13–#29)
**Requirements:** 49/53 v1 complete · 3 deferred to verification sweep · 1 superseded · 17 v2 deferred (incl. 4 EMAIL-V2-* added at milestone close)

### Delivered

A working internal replacement for the Monday.com kiosk-tracking workflow: 1,000+ kiosks across 373+ active locations, four interchangeable views (Table / Kanban / Gantt / Calendar), an analytics arc that turned raw sales data into a pipeline-aware dashboard suite, and a destructive-data toolkit (multi-POS merge, geocoding, threshold settings) hardened by operator UAT against prod.

### Key accomplishments

1. **Foundation (Phase 1)** — Next.js 16 + Drizzle/Neon scaffold, Better Auth 1.5 invite-only with 30-day sliding sessions, RBAC with sensitive-field redaction, full normalised schema with temporal `kiosk_assignments` and configurable pipeline stages.

2. **Core entities & views (Phase 2)** — Kiosk/Location CRUD with assignment history, S3-backed contracts, RBAC-gated banking details, TanStack Table + Zustand View Engine with saved views, dnd-kit Kanban with drag-to-update, bulk edit + CSV export, full audit log UI (per-record + global).

3. **Advanced views (Phase 3)** — `@svar-ui/react-gantt` brand-themed timeline with milestones and resource lanes, `react-big-calendar` view with installation spans + milestone diamonds + trial-expiry events, 4-tab `?view=` URL-bookmarkable navigation across Kiosks page.

4. **Data migration (Phases 4 + 4.1)** — Monday.com GraphQL importer with dry-run, pagination + retry, products/providers/commission tiers from subitems, dedicated Products and Kiosk Config Groups tabs, full kiosk/location table-display correctness pass.

5. **Reporting & analytics arc (Phase 5, off-GSD via PRs #23 → #29)** — Dashboard, Trend Builder, Pivot, Compare, Maturity, Heat Map, Outlet Tiers, Hotel/Location/Region groups, Performer Patterns, Experiments, Commission, Flag Review, Actions Dashboard; perf-optimisation epic; 4 prod backfill scripts; 7 audit-fix migrations (0027–0034) plus structural cleanup migrations (0035 cohort uniqueness, 0036 assigned_at immutable trigger, 0037 drop dead column); portal lockdown.

6. **Phase 6 operational baseline** — D8 multi-POS merge applied to prod (4,171 sales rewrites + 19 location archives); /settings/geocoding admin UI with Google Maps integration (313 lat/lng populated on prod); thresholds-as-settings (outlet-tier cutoffs lifted from constants → appSettings + admin UI); KPI tooltips on 26/27 cards citing the D-decision/PR that defines each metric's math; D2 reversal-matcher determinism fix (id-tiebreaker on tied transactionDate, property-style permutation tests); 14 Monday-client `it.todo` unit tests filled.

### Known gaps (carried into v2)

- **MIGR-07, MIGR-08** — verification sweep against current import output (kiosk-notes cleanliness, key-contacts hotel-vs-internal-POC distinction)
- **MIGR-09** — partial: display-only suffix strip ships in v1.0; bulk same-name location merge tracked under DM-V2-01
- **REPORT-V2-03** — `freeTrialEndDate` analytics deferred; pickup tied to maintenance-fee recurring-revenue work
- **DQ-V2-01/02/03** — 61 NULL-coord active locations + cluster-10 wrong sibling-copied address + 60 NO_MONDAY triage
- **DM-V2-01** — same-name location collapse policy decision (19 distinct names with 2+ active rows)
- **TEST-V2-01/02** — single-pair multi-pos-merge fixture + staging orphan-rate baseline
- **MONDAY-V2-01** — bidirectional Monday sync / drift detection
- **REF-V2-01** — analytics dashboards `useEffect → loadData()` migration
- **EMAIL-V2-01/02/03/04** — Resend integration (Brevo fallback documented), self-serve change-password UI, forgot-password prod deliverability UAT, transactional alerts substrate

### Operational notes

- Prod URL: `https://wkg-command-centre.vercel.app` (legacy `wkg-kiosk-tool.vercel.app` alias deleted 2026-04-28)
- Branching strategy: `phase` — phase branches squash-merged at PR time
- Lockfile drift: regen via `linux/amd64` Docker only — see `CLAUDE.md` "npm lockfile must stay in sync"
- Admin password rotation: `scripts/reset-admin-password.ts` — see `CLAUDE.md` "Prod admin password rotation"

---
