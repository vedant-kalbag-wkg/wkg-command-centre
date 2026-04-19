# Bug Report — findings during UI modernization (2026-04-19)

Bugs and out-of-scope items discovered during the UI modernization sweep on branch `ui/modernize-shadcn-magic`. These are NOT addressed by the sweep (which is token/theme + shell work); they need separate fixes.

---

## A. Backend / data-layer bugs (highest priority)

### A.1 Analytics queries fail with hardcoded `outlet_code = 'TEST'` exclusion

**Pages affected:**
- `/analytics/heat-map`
- `/analytics/maturity`
- `/analytics/pivot-table`
- `/analytics/portfolio` — hourly/tod analysis section
- Anywhere else running the shared portfolio/analytics queries

**Symptom:** "Failed query" banner on the page with SQL error. Page shell renders but no data.

**Evidence — heatmap query:**
```sql
SELECT "sales_records"."location_id", COALESCE("locations"."outlet_code", '') AS outlet_code,
       "locations"."name", "locations"."num_rooms"::text,
       (SELECT MIN(...) FROM "kiosk_assignments" ...) AS live_date,
       COALESCE(SUM("sales_records"."gross_amount"), 0) AS revenue,
       COUNT(*)::text AS transactions,
       COALESCE(SUM("sales_records"."quantity"), 0)::text
FROM "sales_records" INNER JOIN "locations" ON "sales_records"."location_id" = "locations"."id"
WHERE "sales_records"."transaction_date" >= $1
  AND "sales_records"."transaction_date" <= $2
  AND NOT ("locations"."outlet_code" = $3)
GROUP BY ...
-- params: 2025-01-01, 2025-12-31, TEST
```

**Evidence — maturity query:**
```sql
SELECT CASE WHEN EXTRACT(EPOCH FROM (NOW() - (SELECT MIN(...) FROM "kiosk_assignments" ...))) / 86400 <= 30 THEN '0-30d' ...
FROM "sales_records" INNER JOIN "locations" ON ...
WHERE "sales_records"."transaction_date" >= $1
  AND "sales_records"."transaction_date" <= $2
  AND NOT ("locations"."outlet_code" = $3)
  AND (SELECT MIN(...)) IS NOT NULL
-- params: 2025-01-01, 2025-12-31, TEST
```

**Evidence — pivot query:**
```sql
SELECT l.location_group, TO_CHAR(sr.transaction_date, 'Mon YYYY'), SUM(...)
FROM sales_records sr
  INNER JOIN locations l ON ...
  INNER JOIN products p ON ...
WHERE "sales_records"."transaction_date" >= '2025-01-01'
  AND "sales_records"."transaction_date" <= '2025-12-31'
  AND NOT ("locations"."outlet_code" = 'TEST')
GROUP BY l.location_group, TO_CHAR(...)
ORDER BY ...
LIMIT 10001
```

**Root cause hypothesis:** There's a hardcoded or misconfigured outlet-exclusion list that always passes `'TEST'` as the excluded outlet_code. Either:
- A config/seed migration inserted a `'TEST'` exclusion that doesn't match any real outlet in the current seed; the query errors because of the CTE not evaluating correctly when the param binds, OR
- The exclusion filter is being sent with `'TEST'` as a literal parameter that shouldn't be exclusionary in this environment; the query SQL itself may be structurally correct but the filter is wrong for the data.

**Where to look:**
- Look for where `outletExclusions` / similar is loaded and applied to the analytics query builder. Likely in `src/lib/analytics/queries.ts` or `src/lib/analytics/filters.ts`.
- Check the `/settings/outlet-exclusions` table content in the database — is `'TEST'` the only row and is it being applied globally?
- Check `src/db/seed.ts` and `seed-*.ts` for `'TEST'` outlet exclusion inserts.

**Severity:** High — makes multiple analytics pages unusable.

### A.2 Kiosk config groups import failing

**Page:** `/kiosk-config-groups` (import flow from Monday/CSV).

**Symptom:** (needs reproduction) — user reported "import of kiosk config groups" as failing. Exact error not captured. Investigate by:
1. Triggering the import action (via the UI button or `scripts/import-location-products-from-monday.ts` / similar script).
2. Capturing the server log and network response.

**Update 2026-04-19:** user noted A.2 may not be a real failure — the import may simply not have been allowed to finish its loading state. Park until reproduced with a confirmed error message.

**Severity:** Medium.

### A.4 Commission analytics page broken

**Page:** `/analytics/commission`.

**Symptom:** User reports the commission analytics doesn't work. Exact error not captured (likely "Failed query" banner or blank content). Needs reproduction to identify whether:
- Same `outlet_code = 'TEST'` family as A.1, or
- Different query, different failure mode.

**Where to look:**
- `src/app/(app)/analytics/commission/page.tsx`
- `src/app/(app)/analytics/commission/actions.ts` (or equivalent server actions file)
- `src/lib/analytics/commission.ts` / query builder if present.

**Severity:** High — page is completely non-functional.

**Related feature request:** page also needs a multi-select filter by hotel name (see C.5 below).

### A.3 Kiosks missing asset IDs on localhost (present on Vercel)

**Page:** `/kiosks`.

**Symptom:** On localhost, kiosk rows are missing asset IDs (the asset/serial number column is blank). On Vercel, the same kiosks render with asset IDs populated.

**Root cause hypothesis (needs verification):** environment/data divergence. Candidates:
- Local seed (`npm run db:seed` / `db:seed:kiosks`) doesn't populate `hardwareSerialNumber` (the likely asset-ID field) whereas Vercel's database does. Check `src/db/seed-kiosks.ts` for the fields being seeded.
- An import step (e.g., `db:import:monday`) was run on Vercel but not locally; the asset IDs come from Monday.com import.
- Column visibility state (per-user) — unlikely, but check if `useKioskViewStore` has a default that hides the asset column on a fresh localhost user.

**Where to look:**
- `src/db/seed-kiosks.ts` — confirm asset IDs are seeded.
- `src/components/kiosks/kiosk-columns.tsx` — confirm the asset-ID column exists and is visible by default.
- Local DB: `SELECT id, hardware_serial_number FROM kiosks LIMIT 10;` — see if the column is null on localhost.
- `scripts/import-from-monday.ts` — this is probably the source of asset IDs in production.

**Severity:** Medium — doesn't break localhost UX entirely, but makes it hard to QA anything involving asset IDs (e.g., the new `/kiosks` reference-page rebuild). Suggest running the Monday import script locally or extending `db:seed:kiosks` to populate the field.

## B-prime. Functional feature requests (discovered via UI modernization)

### B-prime.1 Admin needs to create users directly with a default password

**Symptom:** The current user-invite flow (`/settings/users` → "Invite user") relies on email. On localhost, email delivery is not configured, so there's no way to create a new user for testing or for environments without SMTP. The "both apps" phrasing from the user implies this applies to the kiosk tool AND the analytics side (same codebase, same auth — `better-auth`).

**Requested change:** add an admin flow to create a user with a pre-set password, bypassing the email invitation. Ideally:
- New "Create user" action in `/settings/users` (alongside or replacing "Invite user" for admin-created accounts).
- Admin provides: name, email, role, password.
- Backend creates the user via `better-auth`'s server API with the supplied password hashed.
- User can then log in immediately.

**Where to look:**
- `src/lib/auth.ts` + `src/lib/auth-client.ts` — `better-auth` configuration.
- `src/components/admin/invite-user-dialog.tsx` — current invite flow.
- `src/app/(app)/settings/users/*` — admin users surface.
- `better-auth` docs on `auth.api.signUpEmail` or equivalent server-side user creation.

**Severity:** Medium for dev/staging, Low for production (assuming SMTP is configured there). Unblocks localhost QA for everything downstream of "I need another user to test X".

---

## B. Pre-existing functional regressions (not caused by UI sweep)

### B.1 Trend builder — series-wise filtering no longer works

**Page:** `/analytics/trend-builder`

**Symptom:** User reports: "We have broken the trend builder as it does not allow series wise filtering anymore."

**Confirmed NOT caused by UI sweep:**
- Only commit on branch `ui/modernize-shadcn-magic` that touches trend-builder is `2bca656` (the analytics sweep), which only changed class names — no behavioral changes.
- `src/app/(app)/analytics/trend-builder/series-row.tsx` was not touched by the branch at all.

Regression originated in an earlier commit on `main`. Likely suspects (commits that touched trend-builder before our branch):
- `320c391 fix(ui): match original trend builder and pivot table UX`
- `e6cade0 feat(analytics): add rolling average seasonality controls (M12.3)`
- `4f5998c feat(analytics): add YoY comparison toggle to portfolio and trend builder (M12.1)`

**Where to look:**
- `src/app/(app)/analytics/trend-builder/series-row.tsx` — filter UI and handlers.
- `src/lib/stores/trend-store.ts` — series state management.
- `git log -p src/lib/stores/trend-store.ts` to see recent logic changes.

**Severity:** High (user-visible, functional).

---

## C. Design / feature requests (user feedback — Phase 2 or 3 scope)

### C.1 Trend builder — weather conditional display

"The weather should only be allowed to be displayed when a single region, city or location group is filtered."

**Proposed implementation:**
- Disable/hide the weather series/toggle when the filter resolves to more than one region (or city/location group).
- Show a tooltip or inline message: "Weather data is available only when a single region, city, or location group is selected."
- Evaluate by checking active filter state from `useAnalyticsFilters` — count of regions/cities/location-groups ≤ 1 → enabled, otherwise disabled.

**Where:** `src/app/(app)/analytics/trend-builder/series-builder-panel.tsx` + `series-row.tsx` where the weather series option is offered.

### C.2 Hotel Groups page redesign

**Current:** Cards listing hotel groups.

**Wanted:** When a user selects a hotel group, the top panel (card list) collapses and the page shows analytics for that group. Cards should be replaced with a dropdown filter showing:
- Hotel group name
- Number of hotels in the group
- Revenue

The dropdown filter then applies globally to the rest of the page.

**Where:** `src/app/(app)/analytics/hotel-groups/page.tsx` + `src/app/(app)/analytics/hotel-groups/group-selector.tsx`.

### C.3 Location Groups page redesign

Same pattern as C.2 but for location groups.

**Where:** `src/app/(app)/analytics/location-groups/page.tsx` + `location-selector.tsx`.

### C.4 Regions page — empty-state prompt

Keep the regions-as-cards layout, but add an empty-state prompt like "Select a region to see its performance metrics" visible when no region is selected.

**Where:** `src/app/(app)/analytics/regions/page.tsx` + `region-selector.tsx`.

### C.5 Commission page — hotel-name multi-select filter

**Context:** `/analytics/commission` is broken (see A.4) and also needs a multi-select hotel-name filter so users can scope commission views to a subset of hotels.

**Proposed UI:** a `MultiSelectFilter` (same component used by the analytics layout filter bar) labeled "Hotels" (or "Locations" / "Hotel Name" — match terminology used elsewhere), populated from the locations table. Selection flows into the commission query's WHERE clause.

**Where:** once A.4 is fixed, add to `src/app/(app)/analytics/commission/page.tsx`. Consider whether the hotel filter should be page-local or joined into the shared analytics filter bar (currently the shared bar has "Locations" already — check if that filter is applied to commission queries; if yes, the request may reduce to "make sure commission respects the existing Locations filter").

### C.7 Portfolio — Low Performer Patterns section

**Context:** `/analytics/portfolio` now surfaces "High Performer Patterns" (traits shared by top-tier outlets) as the lead chart card. The symmetric counterpart — a "Low Performer Patterns" section describing traits shared by bottom-tier outlets — does not exist yet.

**Requested:**
- A new `LowPerformerPatterns` component mirroring `HighPerformerPatterns`: insight bullets, KPI values, distribution tables, and any related top/bottom products breakdown.
- A backing server action (likely sibling to `fetchHighPerformerPatterns`) — e.g., `fetchLowPerformerPatterns` — that returns the same shape computed against the bottom tier instead of the top.
- Render on `/analytics/portfolio` immediately below High Performer Patterns as a full-width ChartCard.

**Where:**
- `src/app/(app)/analytics/portfolio/high-performer-patterns.tsx` → copy to a new `low-performer-patterns.tsx`.
- `src/app/(app)/analytics/portfolio/actions.ts` → add `fetchLowPerformerPatterns`.
- `src/app/(app)/analytics/portfolio/page.tsx` → add the new ChartCard and wire data fetching.
- `src/lib/analytics/types.ts` → mirror whatever types support high-performer data.

**Severity:** Medium feature — not blocking the UI modernization but a clear symmetry gap in the portfolio dashboard.

### C.6 Heat-map weights — user customizable with validation

**Page:** `/analytics/heat-map`.

**Context:** the heat-map composite score currently uses fixed weights (30% Revenue, 20% Transactions, 25% Rev / Room, 15% Txn / Kiosk, 10% Avg Basket per the existing `Score Weights` card). Users want to customize this mix.

**Requested:**
- Editable fields for each weight (0–100%, integer percentages OK).
- Live validation: UI must enforce total = 100%. Options: auto-normalize on change, or block "Apply" button until user manually balances to 100 and show a red warning banner with current sum.
- Persist per-user preferences (probably in `analytics-filter-store` or a new `heatmap-weights-store`).
- Default preset (matching current fixed weights) + a reset button.

**Where:**
- `src/app/(app)/analytics/heat-map/page.tsx` + `score-legend.tsx` (which currently renders the weight swatches).
- Likely need a new form component for weight editing (e.g., `<WeightEditor>` or similar).
- Backend query that applies the weights — needs to accept weight params instead of using hardcoded values.

**Severity:** Medium feature — not blocking the UI modernization but a clear product gap.

---

## D. UI follow-ups — deferred to Phase 2/3 (in scope, not blocking Phase 1)

### D.1 Hardcoded `bg-white` usages break dark mode

Classes not caught by the `wk-*` / hex-literal sweep but visibly broken in dark mode:

- `src/components/kiosks/kiosk-card.tsx` — kanban card body uses `bg-white` directly. Dark mode shows white-on-dark cards.
- `src/components/calendar/calendar-view.tsx` — empty-state overlays use `bg-white/90`, `bg-white/80`.
- `src/app/(app)/settings/data-import/sales/sales-import-client.tsx:101` — `file:bg-white` on file input button.
- `src/app/(app)/settings/duplicates/duplicates-client.tsx:126` — candidate-pair rows use `bg-white`.

**Fix:** sweep to `bg-card` or `bg-background` semantic tokens.

### D.2 Hex grey/blue utilities break dark mode

Hex values outside the sweep regex (`#00A6D3|121212|F41E56|68D871`):

- `src/components/admin/user-table.tsx:45-47` — role badges use inline `[#F4F4F4]` (light-grey), `[#E5F1F9]` (sky-blue), `[#575A5C]` (night-grey). In dark mode: grey-on-dark, unreadable.

**Fix:** map to semantic tokens (`bg-muted text-muted-foreground`, etc.) or use `var(--color-wk-*)` with proper dark overrides.

### D.3 Admin role badge — fixed-dark → white-on-white

Pattern `bg-wk-graphite text-white` (or `bg-[#121212] text-white`) was meant to be "dark badge always". After mapping to semantic `bg-foreground`, flips to near-white-on-white in dark mode.

Fixed in some places (user-table.tsx, installation-table.tsx) with `bg-secondary text-secondary-foreground` substitution. Remaining instance:
- `src/components/layout/portal-navbar.tsx` — admin `RoleBadge` variant. (`app-navbar.tsx` was deleted, so its variant is gone.)

**Fix:** apply the `bg-secondary text-secondary-foreground` substitution to `portal-navbar.tsx` when portal chrome is revisited.

### D.4 ThemeToggle SSR/CSR hydration warning

Visible on every reload in dev. `resolvedTheme` is `undefined` server-side → server renders Moon, client renders Sun (or vice versa) → hydration mismatch warning in console.

**Fix options:**
- Add `suppressHydrationWarning` to the button.
- Gate render with a `mounted` effect (useEffect → setMounted(true) → render icon only when mounted).
- Render both icons stacked with CSS opacity swap based on class on `<html>`.

**Where:** `src/components/theme-toggle.tsx`.

### D.5 `hover:bg-primary` no-op after sweep

All `bg-wk-azure` / `bg-wk-sea-blue` variants mapped to `bg-primary`. Buttons that previously had `hover:bg-wk-sea-blue` on a `bg-wk-azure` base now have `hover:bg-primary` on a `bg-primary` base → visually identical, no hover affordance.

**Fix options:**
- Define `--primary-hover` token (~10% darker than primary in light mode, ~10% lighter in dark mode) and use `hover:bg-primary-hover` consistently.
- Or standardize on `hover:bg-primary/90` wherever the original intent was a darker hover.

### D.6 Gantt / react-big-calendar — backdrop dimming on overlays

When popovers or dialogs open from inside the gantt or calendar views, the background content is not dimmed. Feels visually disconnected from the rest of the app.

**Fix:** confirm shadcn `Dialog` / `Popover` use a backdrop (`<DialogOverlay>` / equivalent). They should by default — investigate whether these components are wrapped in a way that bypasses the overlay, or whether the gantt/calendar library is rendering popovers in its own portal that escapes the shadcn overlay.

**Where:**
- `src/components/calendar/calendar-event-popover.tsx`
- `src/components/gantt/milestone-quick-add-popover.tsx`
- `src/components/gantt/gantt-view.tsx` / any detail sheets launched from gantt bars.

### D.7 Portfolio page visual defects

- **Expand/collapse button** has a half-height vertical line next to it (visible artifact — likely a `<Separator>` with height mismatch or a stray `border-r` on the wrong element).
- **Filter bar** has excessive empty vertical space (padding + margin stacking).

**Where:** `src/app/(app)/analytics/portfolio/page.tsx` + `src/components/analytics/section-accordion.tsx` (if used for the expand/collapse).

These will be resolved naturally in Phase 2 when `/analytics/portfolio` is rebuilt as a reference page with the new `PageHeader` + `ChartCard` grid per the plan.

---

## E. Tracking

| ID | Severity | Owner | Status |
|---|---|---|---|
| A.1 | High | Backend | Fixed in `78728e2` (heat-map GROUP BY + maturity ORDER BY) |
| A.2 | Medium | Backend | Parked — likely non-bug (user may not have let loading finish); re-open when reproduced |
| A.3 | Medium | Backend/data | Fixed (docs) in `d61b62e` — followup F.1 below |
| A.4 | High | Backend/Analytics | Fixed in `1fabd3d` (duplicate React keys from shared hotel names) |
| B.1 | High | Analytics | Fixed in `90bfb4b` (per-series filter UI was never surfaced) |
| B-prime.1 | Medium | Auth/admin | Fixed in `94ddc27` (admin create-user w/ password via `auth.api.createUser` + `setRole`) |
| C.5 | Feature | Analytics | Backlog |
| C.6 | Feature | Analytics | Backlog |
| C.7 | Feature | Analytics | Backlog |
| C.1 | Design | TBD | Backlog |
| C.2 | Design | TBD | Backlog |
| C.3 | Design | TBD | Backlog |
| C.4 | Design | TBD | Backlog |
| D.1 | Low (cosmetic dark-mode) | UI sweep | Phase 2 |
| D.2 | Low (cosmetic dark-mode) | UI sweep | Phase 2 |
| D.3 | Low (cosmetic dark-mode) | UI sweep | Phase 3 |
| D.4 | Low (dev warning) | UI polish | Any time |
| D.5 | Low (cosmetic) | UI sweep | Phase 2 |
| D.6 | Medium (UX) | UI sweep | Phase 2 |
| D.7 | Low (cosmetic) | UI sweep | Phase 2 (ref-page rebuild) |

---

## F. Followups surfaced during the backend-fix wave (2026-04-19)

These came out of the A.1 / A.3 / A.4 / B.1 / B'.1 fixes but were intentionally scoped out.

### F.1 Monday import doesn't write `hardware_serial_number`
`scripts/import-from-monday.ts` upsert (around lines 296–304) omits `hardwareSerialNumber` from the values object. A.3's fix was docs-only — the seed already populates the field for its 8 rows, and the doc change points users at `db:seed:kiosks` for localhost. If Vercel shows populated asset IDs on Monday-imported kiosks, there's an unknown backfill path (grep for a migration copying `kiosk_id` → `hardware_serial_number`). Long-term fix: add the Monday column ID to `importKiosks()` once product confirms the source column.

### F.2 Portfolio `getPortfolioData` swallows sub-query errors
`src/lib/analytics/queries/portfolio.ts:340-345` wraps each sub-query in `.catch(() => [])`. This would have masked the A.1 bug from users (blank sections instead of an error banner). Consider surfacing sub-query failures instead of silently emptying — ideally a structured error per section so the UI can render a per-card error state.

### F.3 Localhost `commission_ledger` table is empty
124,598 `sales_records` locally but 0 `commission_ledger` rows. The ledger is populated by `calculateCommissionsForRecords` during sales-import; pre-existing seeded sales never flowed through it. A.4 was reproduced by seeding 500 synthetic ledger rows. Teee up a small script to backfill the ledger locally (and confirm Vercel is populated) so the commission page has real data to render.

### F.4 Other trend-builder Playwright specs reference renamed text
Three pre-existing specs in `tests/analytics/trend-builder.spec.ts` look for `"Series Builder"` text that was renamed to `"Builder Panel"` in `320c391`. One-line fix — parked out of B.1's scope.

### F.5 `outlet_exclusions` has a single harmless `'TEST'` row
Matches no real outlet; the A.1 SQL is structurally correct, so this is a no-op. If cleaning up the seed noise is wanted: `DELETE FROM outlet_exclusions WHERE outlet_code = 'TEST';`.

### F.6 Phase4 worktree bootstrap papercut
The worktree lacked `.env.local` and its `node_modules` was a symlink that tripped Turbopack with `Symlink node_modules is invalid, it points out of the filesystem root`. Reproduction required copying both from the main worktree. Worth a short "worktree bootstrap" note in `docs/DEVELOPMENT.md` for future parallel-agent runs.
