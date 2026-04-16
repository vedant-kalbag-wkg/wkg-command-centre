# Requirements: Kiosk Management Platform

**Defined:** 2026-03-18
**Core Value:** Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure.

## v1 Requirements

### Authentication & Access Control

- [x] **AUTH-01**: User can sign up and log in with email and password
- [x] **AUTH-02**: User session persists across browser refresh
- [x] **AUTH-03**: User can reset password via email link
- [x] **AUTH-04**: Admin can create and manage user accounts
- [x] **AUTH-05**: Sensitive fields (banking details, contracts) are restricted to authorized roles only

### Kiosk Data Model

- [x] **KIOSK-01**: User can create a kiosk record with all fields (kiosk ID, outlet code, customer codes, hardware details, software version, CMS config status, installation date, deployment phase tags, maintenance fee, free trial status/end date, region/location group)
- [x] **KIOSK-02**: User can view, edit, and delete kiosk records
- [x] **KIOSK-03**: Kiosk has a status from a configurable lifecycle pipeline (default: Prospect → On Hold → Delivered to Region → Awaiting Configuration → Configured → Ready to Launch → Live → Offline → Decommissioned)
- [x] **KIOSK-04**: Admin can add, reorder, rename, and remove lifecycle stages
- [x] **KIOSK-05**: User can assign a kiosk to a venue and reassign it to a different venue
- [x] **KIOSK-06**: System tracks full assignment history per kiosk (which venues, date ranges, reason for move)

### Location Data Model

- [x] **LOC-01**: User can create a location (hotel/venue) record with all fields (name, address, lat/long, star rating, room count, key contacts, hotel group, sourced-by)
- [x] **LOC-02**: User can view, edit, and delete location records
- [x] **LOC-03**: User can attach contracts to a location with structured fields (start date, end date, value, terms) and file uploads (PDF/docs)
- [x] **LOC-04**: User can store banking details on a location record (restricted to authorized roles)
- [x] **LOC-05**: User can view all kiosks currently and historically assigned to a location

### Table View

- [x] **VIEW-01**: User can view kiosks and locations in a filterable, sortable table (the default interface)
- [x] **VIEW-02**: User can group table records by any field (status, region, hotel group, deployment phase, etc.)
- [x] **VIEW-03**: User can show/hide columns in the table
- [x] **VIEW-04**: User can save a custom view configuration (filters, grouping, visible columns, sort order) with a name
- [x] **VIEW-05**: User can load, update, and delete saved views

### Kanban View

- [x] **KANBAN-01**: User can view kiosks as cards on a Kanban board grouped by status
- [x] **KANBAN-02**: User can drag a kiosk card between status columns to update its status
- [x] **KANBAN-03**: User can group the Kanban board by other fields (region, hotel group, etc.)

### Gantt View

- [x] **GANTT-01**: User can view deployment timelines on a Gantt chart (kiosk/venue scheduled stages over time)
- [x] **GANTT-02**: User can view regional rollout plans as grouped Gantt bars
- [x] **GANTT-03**: User can set and view milestones (contract signing, go-live targets, review dates)
- [x] **GANTT-04**: User can assign resources (team members) to deployment tasks and view allocation

### Calendar View

- [x] **CAL-01**: User can view deployments, milestones, and deadlines on a calendar
- [x] **CAL-02**: User can filter the calendar by region, status, or hotel group

### Bulk Operations & Export

- [x] **BULK-01**: User can select multiple kiosk or location records and bulk-edit shared fields
- [x] **BULK-02**: User can export filtered table data to CSV or Excel

### Audit Log

- [x] **AUDIT-01**: System logs every change to kiosk and location records (who, what field, old value, new value, when)
- [x] **AUDIT-02**: User can view the audit log for a specific kiosk or location record
- [x] **AUDIT-03**: Admin can view the global audit log with filters (by user, entity, date range)

### Reporting & Dashboard

- [ ] **REPORT-01**: User can view a dashboard with fleet health overview (total kiosks by status, pipeline breakdown, key metrics)
- [ ] **REPORT-02**: User can view time-series charts (total kiosks live per month, new activations per month, growth trends)
- [ ] **REPORT-03**: User can drill down from summary → hotel → individual kiosk in reports
- [ ] **REPORT-04**: User can filter reports by region, deployment phase, hotel group, date range, and other fields

### Data Migration

- [x] **MIGR-01**: Admin can trigger a Monday.com data import that maps Monday.com board columns to kiosk/location fields
- [x] **MIGR-02**: Migration supports dry-run mode (preview imported data before committing)
- [x] **MIGR-03**: Migration handles pagination and rate limits for 1,000+ records

### Data Migration — Import Quality & Correctness (Phase 4.1)

- [ ] **MIGR-04**: KioskId derived from "Region" column value + outlet code (e.g. "London-ABC123"), not from Monday.com group name
- [ ] **MIGR-05**: "Assets" column (hardware ID/serial number) imported as kiosk `hardwareSerialNumber`, unique per kiosk — this is the hardware identifier
- [ ] **MIGR-06**: CMS Config status imported correctly from Monday.com status column (preserving actual label, not raw JSON)
- [ ] **MIGR-07**: Kiosk notes contain only genuinely relevant notes — unmapped location-targeted fields must not be dumped into kiosk notes
- [ ] **MIGR-08**: Key contacts import distinguishes hotel key contact name from WeKnow internal POC ("Key Contact" column = internal POC)
- [ ] **MIGR-09**: Hotels with same name but different `[outlet_code]` suffixes merged into one location with separate kiosks per outlet code
- [x] **MIGR-10**: Hardware assets/kiosks imported first from board `1426737864`, hotel data imported separately
- [ ] **MIGR-11**: Location schema extended with `region`, `locationGroup`, `internalPoc` (WeKnow internal POC), and `status` fields

### Data Migration — Table Display Fixes (Phase 4.1)

- [ ] **MIGR-12**: Kiosk table displays only relevant columns by default: Asset (hardware serial number), outlet code, venue, region, pipeline stage, CMS config status, install date
- [ ] **MIGR-13**: Location table displays all hotel metadata: name, hotel group, star rating, rooms, # kiosks, address, sourced by, status, maintenance fee, customer code, key contact name, region, location group, internal POC (key contact)

### Data Migration — Products & Kiosk Groups (Phase 4.1)

- [ ] **MIGR-14**: Product management moved to a dedicated Products tab in the sidebar (not embedded within hotel/location detail)
- [ ] **MIGR-15**: Kiosk Groups tab with data imported from Monday.com board `1466686598` — separate entity for grouping kiosks

## v2 Requirements

### Access Control (Extended)

- **AUTH-V2-01**: Role-based access control with configurable Ops, IT, and Read-only tiers
- **AUTH-V2-02**: Admin can define custom roles with granular permissions

### Reporting (Extended)

- **REPORT-V2-01**: User can schedule automated reports delivered via email
- **REPORT-V2-02**: User can create and save custom report templates

### Views (Extended)

- **VIEW-V2-01**: Map view showing kiosk locations on an interactive map using lat/long data

### Notifications

- **NOTIF-V2-01**: User receives notifications for status changes on kiosks they manage
- **NOTIF-V2-02**: Admin receives alerts for kiosks going offline

## Out of Scope

| Feature | Reason |
|---------|--------|
| SSO/OAuth login | Email/password sufficient for v1; low user count doesn't justify SSO complexity |
| Mobile native app | Web-first; browser works on mobile devices |
| Real-time collaboration | No concurrent editing requirement for this use case |
| IoT/telemetry monitoring | Kiosk health monitoring is a separate system |
| Billing/invoicing | Handled in separate financial systems |
| External customer portal | Internal tool only |
| Real-time chat | Not relevant to asset management workflows |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| AUTH-05 | Phase 1 | Complete |
| KIOSK-01 | Phase 2 | Complete |
| KIOSK-02 | Phase 2 | Complete |
| KIOSK-03 | Phase 2 | Complete |
| KIOSK-04 | Phase 2 | Complete |
| KIOSK-05 | Phase 2 | Complete |
| KIOSK-06 | Phase 2 | Complete |
| LOC-01 | Phase 2 | Complete |
| LOC-02 | Phase 2 | Complete |
| LOC-03 | Phase 2 | Complete |
| LOC-04 | Phase 2 | Complete |
| LOC-05 | Phase 2 | Complete |
| VIEW-01 | Phase 2 | Complete |
| VIEW-02 | Phase 2 | Complete |
| VIEW-03 | Phase 2 | Complete |
| VIEW-04 | Phase 2 | Complete |
| VIEW-05 | Phase 2 | Complete |
| KANBAN-01 | Phase 2 | Complete |
| KANBAN-02 | Phase 2 | Complete |
| KANBAN-03 | Phase 2 | Complete |
| GANTT-01 | Phase 3 | Complete |
| GANTT-02 | Phase 3 | Complete |
| GANTT-03 | Phase 3 | Complete |
| GANTT-04 | Phase 3 | Complete |
| CAL-01 | Phase 3 | Complete |
| CAL-02 | Phase 3 | Complete |
| BULK-01 | Phase 2 | Complete |
| BULK-02 | Phase 2 | Complete |
| AUDIT-01 | Phase 2 | Complete |
| AUDIT-02 | Phase 2 | Complete |
| AUDIT-03 | Phase 2 | Complete |
| REPORT-01 | Phase 5 | Pending |
| REPORT-02 | Phase 5 | Pending |
| REPORT-03 | Phase 5 | Pending |
| REPORT-04 | Phase 5 | Pending |
| MIGR-01 | Phase 4 | Complete |
| MIGR-02 | Phase 4 | Complete |
| MIGR-03 | Phase 4 | Complete |
| MIGR-04 | Phase 4.1 | Pending |
| MIGR-05 | Phase 4.1 | Pending |
| MIGR-06 | Phase 4.1 | Pending |
| MIGR-07 | Phase 4.1 | Pending |
| MIGR-08 | Phase 4.1 | Pending |
| MIGR-09 | Phase 4.1 | Pending |
| MIGR-10 | Phase 4.1 | Complete |
| MIGR-11 | Phase 4.1 | Pending |
| MIGR-12 | Phase 4.1 | Pending |
| MIGR-13 | Phase 4.1 | Pending |
| MIGR-14 | Phase 4.1 | Pending |
| MIGR-15 | Phase 4.1 | Pending |

**Coverage:**
- v1 requirements: 53 total
- Mapped to phases: 53
- Unmapped: 0 — full coverage

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation — all 41 requirements mapped to phases*
