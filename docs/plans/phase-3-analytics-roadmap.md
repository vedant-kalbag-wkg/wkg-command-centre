# Phase 3 — Analytics Enhancement Roadmap

**Date:** 2026-04-17
**Status:** Planning
**Prerequisite:** Phase 2 complete (M7-M9 merged)

## Context

This roadmap captures analytics feature requests, data quality improvements, and known bugs identified from the original analytics repo demo. These items extend the analytics capabilities built in Phase 1 (M6) and Phase 2 (M7-M9 portal + invite + impersonation).

---

## Known Bugs (Fix First)

| Bug | Page | Description | Est. |
|-----|------|-------------|------|
| **BUG-01** | Trend Builder | Date range selector not showing in the filter bar | 1-2h |
| **BUG-02** | Pivot Table | MoM and YoY comparison columns are all blank | 2-4h |

---

## Milestone Breakdown

### M10 — Bug Fixes + Data Quality Foundations (8-12h)

**M10.1: Bug fixes**
- BUG-01: Trend builder date range selector not rendering
- BUG-02: Pivot table MoM/YoY comparison columns blank
- Investigate and fix any other report-builder interaction issues from demo

**M10.2: Geographic hierarchy standardization**
- Add `market` entity (above region in hierarchy): Market → Region → Location Group
- Schema: `markets` table + `region.marketId` FK
- Seed initial market data
- Update region analytics to show market grouping

**M10.3: Hotel ownership/group mapping**
- Fix hotels under same brand belonging to different operating groups
- Add `operatingGroupId` field to locations (distinct from hotelGroup)
- Data validation: flag locations with missing region/group metadata
- Admin UI: bulk-assign missing metadata

**M10.4: Data quality controls**
- Add data completeness dashboard: % of locations with region, hotel group, market assigned
- Flag records with missing or suspicious values (e.g., zero revenue locations that should have data)
- Add data quality score per location visible on location detail pages

### M11 — Performance Flagging & Kiosk Maturity (10-14h)

**M11.1: Traffic-light thresholds**
- Add configurable revenue thresholds (default: Red <500, Amber 501-1499, Green 1500+)
- Settings page for threshold management (admin only)
- Apply color-coding to heat map, portfolio outlet tiers, and location group views
- Portal users see thresholds on their scoped views

**M11.2: Performance flagging & triage**
- Add "Flag" action on underperforming locations (red/amber)
- Flag types: Relocate, Monitor, Strategic/Loss-Leader Exception
- Flags stored in `locationFlags` table with actor, reason, timestamp
- Flag status visible on location detail, heat map, and portfolio pages
- Audit log integration for flag changes

**M11.3: High-performer comparison**
- Add "What do top performers have in common?" view
- Compare green-tier locations by: hotel group, region, product mix, kiosk count, rooms
- Surface patterns (e.g., "8 of 10 top performers have 2+ kiosks")

**M11.4: Kiosk maturity analytics**
- Calculate maturity buckets from `kiosks.goLiveDate`: 0-1mo, 1-3mo, 3-6mo, 6+mo
- Add maturity as a filter/segment in analytics filter bar
- Performance comparison across maturity stages (revenue curve by age)
- Maturity column in heat map and outlet tier tables

### M12 — Experiment Measurement & Comparison UX (10-14h)

**M12.1: Year-over-year comparison**
- Add YoY toggle to portfolio and trend builder pages
- Compare selected date range vs same period previous year
- Show delta (absolute + percentage) for all KPIs
- Fix the existing pivot table MoM/YoY (BUG-02 in M10) as foundation

**M12.2: Cohort experiment analysis**
- Select a cohort of locations (e.g., "5 hotels across Spain, Germany, UK")
- Save cohorts as named groups (persisted in `experimentCohorts` table)
- Compare cohort metrics to control group (rest of portfolio or named control)
- Overlay intervention dates on trend charts

**M12.3: Seasonality controls**
- Add period-normalized views: compare performance adjusted for seasonal patterns
- Rolling averages (7-day, 30-day) as trend builder options
- Index-based comparison: current performance vs historical same-period average

**M12.4: Comparison UX improvements**
- Entity vs entity comparison workflow: select 2+ locations/groups → side-by-side
- Hotel group within region breakdown
- Revenue trends by month (quick report)
- Saved comparison templates ("My comparisons") for repeat use

### M13 — Event System & Insight-to-Action (8-12h)

**M13.1: Event & annotation system**
- Complete event overlay categories: Promotions, Operational Changes, Market Events, Holidays
- Event CRUD: date range, entity targeting (global/region/hotel/location)
- Reliable rendering in trend builder + portfolio daily trends
- Event filtering: show/hide by category, scope to selected entities

**M13.2: Insight-to-action workflow**
- Turn flagged issues into trackable action items
- Action types: Investigation, Relocation, Training, Equipment Change
- Assign owner + due date to actions
- Action status: Open → In Progress → Resolved
- Outcome tracking: did the action improve the metric?

**M13.3: Action dashboard**
- List view of all open actions across the portfolio
- Filter by: action type, owner, location, status
- Link back to the original insight/flag that triggered the action
- Resolution summary: what was done, when, and what changed

---

## Success Criteria (Phase 3 Complete)

- [ ] Both known bugs fixed (trend builder date range, pivot MoM/YoY)
- [ ] Geographic hierarchy includes markets, all locations have region+group assigned
- [ ] Traffic-light thresholds visible across analytics pages
- [ ] Admins can flag and triage underperforming locations
- [ ] Kiosk maturity available as filter and comparison dimension
- [ ] YoY comparison working in portfolio and trend builder
- [ ] Cohort experiment analysis with intervention overlays
- [ ] Event system reliably renders across trend views
- [ ] Flagged insights convert to trackable actions with outcome measurement

## Estimated Effort

| Milestone | Est. Hours | Dependencies |
|-----------|-----------|-------------|
| M10 (bugs + data quality) | 8-12h | Phase 2 complete |
| M11 (flagging + maturity) | 10-14h | M10 |
| M12 (experiments + comparison) | 10-14h | M10 |
| M13 (events + actions) | 8-12h | M11 |
| **Total** | **36-52h** | |

M11 and M12 can run in parallel after M10. M13 depends on M11 (flagging feeds into actions).
