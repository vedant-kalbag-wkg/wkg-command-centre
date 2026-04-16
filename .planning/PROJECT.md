# Kiosk Management Platform

## What This Is

An internal web application replacing Monday.com as the system of record for managing 1,000+ kiosk deployments across hotel and venue locations. Used by Operations, IT, and broader stakeholders (30+ users) to track the full kiosk lifecycle — from prospect engagement through to live deployment and decommissioning — with rich reporting, planning tools, and flexible views.

## Core Value

Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure — something Monday.com cannot do.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Configurable kiosk lifecycle pipeline (ClickUp-style — one master pipeline, stages can be skipped per kiosk)
- [ ] Rich data model for Kiosks: status, hardware details, software version, CMS config status, kiosk ID, outlet code, customer codes, installation date, deployment phase tags, maintenance fee, free trial status/end date, region/location group
- [ ] Rich data model for Locations (Hotels): name, address, lat/long, star rating, room count, key contacts, hotel group, sourced-by, contracts (structured fields + file attachments), banking details
- [ ] Kiosk-to-venue assignment with full history (which venues, date ranges, reason for move)
- [ ] Default lifecycle stages: Prospect → On Hold → Delivered to Region → Awaiting Configuration → Configured → Ready to Launch → Live → Offline → Decommissioned
- [ ] Admin-configurable status/stage management (add, reorder, rename stages)
- [ ] Filterable, sortable table view with flexible grouping (by status, region, hotel group, deployment phase, etc.)
- [ ] Kanban board view (drag kiosks between status columns)
- [ ] Gantt view for deployment planning (timelines, regional rollouts, milestones, resource allocation)
- [ ] Calendar view for deployments, milestones, and deadlines
- [ ] Saveable custom views (filters, grouping, visible columns, sort order)
- [ ] Bulk editing of kiosk/location records
- [ ] CSV/Excel export
- [ ] Role-based access control (Ops, IT, Read-only tiers)
- [ ] Full audit log of all changes
- [ ] Reporting module: time-series metrics (kiosks live per month, new activations per month)
- [ ] Reporting module: drill-down (summary → hotel → individual kiosk)
- [ ] Reporting module: custom filters (slice by region, phase, hotel group, etc.)
- [ ] Reporting module: scheduled/automated reports
- [ ] Dashboard overview (fleet health, pipeline status, key metrics at a glance)
- [ ] Monday.com data migration via API (explore existing boards + import data)
- [ ] Email/password authentication

### Out of Scope

- SSO/OAuth login — email/password sufficient for v1
- Mobile native app — web-first
- Real-time collaboration (live cursors, co-editing) — not needed for this use case
- External/customer-facing portal — internal tool only

## Context

- Replacing Monday.com due to: reporting inflexibility, manual data entry friction, poor permissions model, inability to accurately model the kiosk/hotel data structure
- 1,000+ kiosks currently tracked across multiple Monday.com boards
- Monday.com API key will be provided in `.env.test` for board exploration and data migration
- Kiosks can be reassigned between venues — the relationship is many-to-many over time, requiring assignment history tracking
- "On Hold" is an early-pipeline status only (before delivery); live kiosks don't go on hold
- Lifecycle is mostly linear but stages can be skipped depending on the situation
- Contracts and banking details are both structured queryable fields AND file attachments (PDFs/docs)
- 30+ users across Operations, IT, and read-only stakeholders across regions

## Constraints

- **Hosting**: Cloud-hosted (AWS or Vercel)
- **Authentication**: Email/password (no SSO requirement)
- **Data Migration**: Must support import from Monday.com via their API
- **Scale**: 1,000+ kiosk records, 30+ concurrent users
- **Brand**: Must follow We Know Group brand guidelines (Azure #00A6D3, Graphite #121212, Circular Pro font)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ClickUp-style configurable pipeline over fixed stages | Business needs evolve; new statuses will be needed without developer intervention | — Pending |
| Kiosk and Location as separate entities with assignment history | Kiosks move between venues; need to track where they've been, when, and why | — Pending |
| Contracts as structured data + file attachments | Need both queryable contract fields (dates, values) and the actual documents | — Pending |
| Four view types (Table, Kanban, Gantt, Calendar) | Different planning and tracking needs across teams | — Pending |
| Monday.com API migration | 1,000+ existing records; manual re-entry not feasible | — Pending |

---
*Last updated: 2026-03-18 after initialization*
