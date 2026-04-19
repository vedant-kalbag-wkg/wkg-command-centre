# UI Modernization — Design

**Branch:** `ui/modernize-shadcn-magic`
**Date:** 2026-04-19
**Status:** approved, implementation pending

## Goal

Modernize the UI of the unified kiosk operations + analytics platform. Keep it clean and functional (minimal animation). Ensure visual and structural consistency between the Kiosk Management and Analytics sections — the app must feel like one product, not two bolted-together tools.

## Constraints

- Preserve WeKnow brand tokens: Azure `#00A6D3` as hero, Graphite `#121212`, white, Circular Pro font, azure tints in 20% increments only.
- Preserve existing data model, server actions, analytics queries, auth, and third-party data libraries (recharts, `@svar-ui/react-gantt`, `react-big-calendar`).
- Functional tool — minimal animation, no decorative motion.
- Use shadcn for primitives. Use Magic MCP (21st.dev) for bespoke composite components.

## Decisions

| # | Decision | Chosen |
|---|---|---|
| Q1 | Navigation shell | Left sidebar + top bar |
| Q2 | Sidebar aesthetic | Dark graphite (tokens already exist) |
| Q3 | Sidebar in light mode | Flips with theme (fully themed) |
| Q4 | Surface style | Hybrid — flat bordered content, soft-shadow overlays |
| Q5 | Sequencing | Foundation-first, then reference pages, then sweep |
| Q6 | Reference pages | Two in parallel: `/kiosks` + `/analytics/portfolio` |
| — | Analytics subgroups | Deferred (flat list for now) |
| — | Theme library | `next-themes` |
| — | `wk-*` class sweep | Sweep now, migrate to semantic roles |
| — | System-admin items | Stay in user menu (not sidebar) |

## Design system & tokens

**Kept:** WeKnow brand palette and rules. `--radius: 0.5rem`. Circular Pro. Existing `wk-*` brand tokens as the source layer.

**Added / changed:**
- Full dark-mode mirror of all semantic tokens on `.dark` class.
- `next-themes` provider with localStorage persistence and no-flash hydration.
- Retire direct `wk-*` class usage in component code; everything goes through semantic roles (`bg-background`, `border-border`, `text-foreground`, etc.). `wk-*` tokens remain but are referenced only by the semantic layer.
- New token: `--surface-elevated` for popovers/dialogs/menus — distinguishes the hybrid overlay treatment from `--card`.

**Out of scope:** changing the brand palette, adding brand colors, changing the font.

## Application shell

Built on shadcn `Sidebar` primitive.

**Layout:**
- Left sidebar: `w-60` expanded, `w-14` collapsed, state persists per user.
- Top bar: `h-14`, page title + breadcrumb on left, theme toggle + user menu on right.
- Main: fills remaining space, scrolls independently.

**Sidebar sections (flat for now, subgroups deferred):**
- Header: WK logo + "Command Centre" (collapses to "WK").
- Kiosk Management: Kiosks, Locations, Installations, Products, Kiosk Config Groups.
- Analytics: Portfolio, Heat Map, Trend Builder, Hotel Groups, Regions, Location Groups, Maturity, Pivot Table, Experiments, Compare, Commission, Actions.
- Configure (admin only): Business Events, Analytics Presets, Outlet Exclusions, Thresholds.
- Footer: collapse toggle.

**Top bar:**
- Left: page title + breadcrumbs derived from route.
- Right: theme toggle, user avatar menu (profile, admin-only system items — Settings, Users, Data Import, Data Quality, Audit Log — sign out).

**Mobile (<md):** sidebar becomes a `Sheet` triggered from a hamburger in the top bar.

## Component kit

**Primitives kept as-is (re-verified for light/dark):** `alert`, `avatar`, `badge`, `button`, `checkbox`, `collapsible`, `command`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `progress`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `slider`, `switch`, `tabs`, `textarea`, `tooltip`, `sidebar`, `calendar`.

**Primitives updated:**
- `button` — add `size="sm"` (28px) for dense toolbars.
- `card` — flat by default (1px border, no shadow); add `elevated` variant.
- `input` / `select` / `textarea` — 36px default height; focus ring uses `--ring` (Azure).
- `badge` — add `subtle` variant (tinted background, colored text) for status chips.
- `table` — dense styles: 36px row height, 12px horizontal padding, sticky header, zebra optional, selection row highlight in azure-20.

**Net-new via shadcn registry:**
- `breadcrumb`

**Net-new custom components:**
- `<PageHeader>` — title + description + actions slot.
- `<DataTable>` — thin opinionated TanStack + shadcn `Table` wrapper with standard filter/sort/pagination.
- `<EmptyState>` — icon + headline + description + primary CTA.
- `<ChartCard>` — wraps recharts chart with title, optional action, loading, empty states.

**Net-new via Magic MCP (21st.dev):**
- `<StatCard>` — KPI stat card (value, label, delta, optional sparkline).
- `<SparklineCell>` — compact trend cell for tables.

**Role split rule:**
- shadcn → primitives, single-purpose, variant-driven.
- Magic MCP → composite, product-specific, visually distinctive pieces.
- Magic MCP will not be used to regenerate anything shadcn already ships well.

## Reference pages (phase 2)

### `/kiosks`
- `<PageHeader>`: title "Kiosks" with count, description, primary "Add kiosk" action, overflow menu (bulk import, export, merge).
- Toolbar row: segmented view switcher (Table · Kanban · Gantt · Calendar — all four surfaced, not buried), right-aligned filters (stage multi-select, market select, cmd+k search).
- Saved views pill row (if any exist).
- Content: new `<DataTable>` with dense styling, sticky header, checkbox column, row actions on hover. Kanban/Gantt/Calendar views restyle only.
- Empty state: `<EmptyState>` component.

### `/analytics/portfolio`
- `<PageHeader>`: title "Portfolio", description, right-side comparison mode toggle (MoM/YoY), date range picker, export menu.
- Sticky filter bar: date range, market, region, outlet group — drives existing `useAnalyticsFilters` store (no data-flow change).
- KPI strip: 4–5 `<StatCard>`s (revenue, orders, AOV, unique outlets, MoM delta — inferred from `AnalyticsSummary` data).
- Drop the accordion. Render sections in a responsive 12-col grid with explicit spans, each wrapped in `<ChartCard>`. Sections remain individually collapsible via chevron on each card; nothing collapsed by default.
- Flags drawer: moves to a right-side `Sheet` triggered from an "Active flags (N)" button in the filter bar.

### Consistency tie
- Identical `<PageHeader>` API on both.
- Identical toolbar/filter-bar treatment (border, padding).
- Identical primary action button variant.
- Shared empty/loading/error patterns from the kit.
- Verification: side-by-side screenshot comparison at end of phase 2.

## Phasing

### Phase 1 — Foundation
1. Install `next-themes`; add `<ThemeProvider>` to root layout.
2. Add theme toggle to top bar.
3. Define dark-mode semantic tokens in `globals.css`; keep `wk-*` brand tokens untouched.
4. Sweep codebase: replace direct `wk-*` class usage with semantic equivalents.
5. Build new `<AppShell>` (sidebar + top bar) replacing current top-only navbar. Retire per-page `app-shell.tsx` → folds into new `<PageHeader>`.
6. Verify: every existing page renders without regression in light mode; dark-mode flip works on every page.

### Phase 2 — Component kit + reference pages
1. Refresh primitives per component kit spec.
2. Add `breadcrumb` via shadcn registry.
3. Build `<PageHeader>`, `<DataTable>`, `<EmptyState>`, `<ChartCard>`.
4. Build `<StatCard>`, `<SparklineCell>` via Magic MCP.
5. Rebuild `/kiosks` on the new kit.
6. Rebuild `/analytics/portfolio` on the new kit.
7. Verify: Playwright E2E on both pages (happy + one edge case each); visual screenshot pair for consistency review.

### Phase 3 — Sweep
Migrate remaining pages in small PRs:
- Kiosk Management: `/locations`, `/installations`, `/products`, `/kiosk-config-groups`, `/kiosks/[id]`, `/kiosks/new`.
- Analytics: the other 11 analytics pages.
- Settings pages last.
Each PR: related group of pages + Playwright happy-path test.

Rule for phase 3: restyle only. No feature changes. Bugs found during migration → separate issue.

## Verification gate per phase

- `tsc` clean.
- `eslint` clean.
- Playwright: minimum 1 happy-path + 1 edge-case test per new/touched page.
- Manual dark-mode walkthrough.

## Risk register

- **`wk-*` sweep regressions.** Semantic tokens in light mode alias to the same `wk-*` values today, so visual output should be byte-identical. Verified by manual screenshot diff before merging phase 1.
- **Dark mode gaps on third-party libs.** `@svar-ui/react-gantt` and `react-big-calendar` have light-mode-only overrides in `globals.css`. Phase 1 adds dark variants for both.
- **Scope creep during sweep.** Phase-3 PRs restyle only.
- **Magic MCP output quality.** If generated components aren't up to scratch, fall back to hand-building with shadcn primitives.

## Out of scope (end to end)

- Backend / data-model changes
- New features
- Swapping chart / gantt / calendar libraries
- Changing analytics math or queries
- Changing auth / session
- Changing the brand palette or font
