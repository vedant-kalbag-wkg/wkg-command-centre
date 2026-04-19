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

**Severity:** Medium.

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
| A.1 | High | Backend | Open |
| A.2 | Medium | Backend | Open |
| B.1 | High | Analytics | Open |
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
