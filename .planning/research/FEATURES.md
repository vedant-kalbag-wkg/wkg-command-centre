# Feature Research

**Domain:** Internal kiosk/asset deployment management platform (replacing Monday.com)
**Researched:** 2026-03-18
**Confidence:** HIGH (validated against project requirements, Monday.com limitations, kiosk lifecycle literature, and comparable SaaS tooling)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. These are the reasons Monday.com is being replaced — users already expect most of these; Monday.com just fails at them.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Rich kiosk data model | Users track 20+ fields per kiosk today; a flat model is not usable | MEDIUM | Status, hardware, software version, CMS config, kiosk ID, outlet code, customer codes, install date, deployment phase tags, maintenance fee, free trial info, region/location group |
| Rich location/hotel data model | Hotels are first-class entities, not just text fields | MEDIUM | Name, address, lat/long, star rating, room count, contacts, hotel group, sourced-by, contracts (structured + file attachments), banking details |
| Kiosk-to-venue assignment with history | Kiosks move between venues; without history users lose accountability | HIGH | Many-to-many over time with date ranges and move reasons; assignment history is a core differentiator from simple asset tracking |
| Configurable lifecycle pipeline | The 9-stage default pipeline must be admin-editable without developer involvement | MEDIUM | Add/rename/reorder stages; ClickUp-style single master pipeline with per-kiosk stage skipping |
| Filterable, sortable table view | Any ops tool is expected to have a spreadsheet-like view | MEDIUM | Grouping by status, region, hotel group, phase; column visibility toggles; sort on any field |
| Kanban board view | Standard for pipeline/status visualization; users coming from Monday.com expect it | MEDIUM | Drag-to-move between status columns; cards show key kiosk fields |
| Bulk editing | With 1,000+ records, per-record editing is unusable | MEDIUM | Multi-select rows, apply field values in bulk; needed for mass status transitions |
| CSV/Excel export | Minimum output format for reporting to non-platform stakeholders | LOW | Export current view/filtered set; respect column visibility |
| Role-based access control (RBAC) | 30+ users with different permissions; a flat permission model is a security problem | MEDIUM | Ops (read/write), IT (read/write technical fields), Read-only (stakeholders); field-level visibility preferred |
| Full audit log | Required for accountability on 1,000+ assets; "who changed what when" is non-negotiable | MEDIUM | Immutable log of all field changes, status transitions, assignments, user actions |
| Dashboard overview | Users need a health summary before drilling into records | MEDIUM | Fleet health, pipeline stage distribution, key metrics: kiosks live, in-progress, new activations this month |
| Email/password authentication | Internal tool; user management must be gated | LOW | Standard session-based auth; no SSO required for v1 |
| Saveable custom views | Users reconfigure filters every session without this; it is a daily productivity blocker | MEDIUM | Save filter set + grouping + visible columns + sort order; per-user and shared |
| Monday.com data migration | 1,000+ existing records; manual re-entry is infeasible | HIGH | Monday.com API integration to read existing boards and import mapped data; requires field mapping UI |
| Search and quick-find | With 1,000+ records, navigation without search is unusable | LOW | Global search by kiosk ID, hotel name, outlet code; filter-as-you-type on table views |

---

### Differentiators (Competitive Advantage)

Features that set this platform apart from generic tools like Monday.com, ClickUp, or spreadsheets.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Gantt view for deployment planning | Ops and IT can plan regional rollouts visually; Monday.com's Gantt is not linked to the kiosk/location data model | HIGH | Timeline bars per kiosk or regional group; milestone markers; resource allocation view; critical path awareness |
| Calendar view for milestones and deadlines | Deployment dates, trial end dates, and maintenance windows visible in calendar context | MEDIUM | Show kiosk events (install dates, trial expiry, planned moves) on a calendar; filter by region/group |
| Reporting module: time-series metrics | Automated monthly/quarterly reports replace manual Excel aggregation | HIGH | Kiosks live per month, new activations per month; trend lines; slice by region, phase, hotel group |
| Reporting module: drill-down | Summary → region → hotel → individual kiosk in one click | MEDIUM | Hierarchical data exploration; each level shows relevant aggregate metrics |
| Reporting module: custom filter slices | Ad-hoc reporting without needing BI tools or developer support | MEDIUM | Filter metrics by any dimension: region, deployment phase, hotel group, hardware type |
| Scheduled/automated reports | Reports delivered on a schedule without manual intervention | MEDIUM | Email delivery of PDF/CSV reports; configurable cadence |
| Structured contract data + file attachments | Contracts are both queryable (dates, values, renewal flags) AND stored as PDFs | MEDIUM | Structured fields for start date, end date, contract value, auto-renewal; S3-backed file storage for PDFs/docs |
| Assignment history tracking | Auditable record of where every kiosk has been, when, and why | HIGH | Many-to-many kiosk-venue relationship over time; move reason captured; visible on both kiosk and venue record |
| Hotel/venue as first-class entity | Hotels are rich entities with their own data, contacts, and contracts — not just a text label on a kiosk | MEDIUM | Dedicated hotel records with full detail; hotel-level view showing all current and historical kiosks |
| Deployment phase tags independent of pipeline status | Business uses deployment phase tags (e.g., "Phase 1 Rollout", "Pilot") separate from operational status | LOW | Multi-value tag field; allows grouping and filtering across status boundaries |
| Field-level access control | Sensitive fields (banking details, contract values) hidden from read-only/IT roles | MEDIUM | Per-role field visibility and edit permissions; stronger than Monday.com's board-level permissions |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in a 30-user internal operations tool at this scale.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time collaborative editing (live cursors, co-editing) | Teams want to see others working in the same record | Adds WebSocket complexity, conflict resolution, and operational overhead for a tool with 30 users who rarely edit the same record simultaneously | Optimistic locking with "last write wins" + audit log shows who changed what |
| SSO / OAuth login | Enterprise-standard authentication | Out of scope for v1; adds identity provider dependency and complexity for a 30-user internal tool | Email/password with secure session management; add SSO in v2 if needed |
| Native mobile app | Field technicians want mobile access | Web-first is explicitly the constraint; building a native app doubles maintenance burden | Responsive web design for mobile browsers; progressive web app if field access becomes critical |
| External/customer-facing portal | Hotels might want self-service status pages | This is an internal operations tool; external portals require authentication, UX, and branding decisions for a different audience | A scheduled PDF report sent to hotel contacts meets the actual need |
| Real-time device monitoring (uptime, telemetry) | Kiosk MDM tools track battery, network, crash stats | This platform tracks deployment records, not live device state; conflating the two bloats scope and requires IoT infrastructure | Integrate with existing MDM/remote monitoring tool via a status field; don't duplicate it |
| Built-in invoicing / billing | Finance teams may ask for billing linked to contracts | Invoicing is a separate accounting domain; building it creates compliance and finance process risk | Store contract values and dates as structured data; integrate with existing finance system via export |
| AI-powered predictive maintenance | Sounds impressive for a kiosk fleet | Requires operational telemetry data this platform does not collect; would be ML theatre without reliable signal data | Focus on accurate manual data; if telemetry is ever ingested, revisit |
| Per-user notification inbox | Users want alerts when a kiosk changes status | Adds real-time push infrastructure complexity; notification fatigue is a genuine problem at 1,000+ records | Scheduled reports + audit log are the appropriate signal for an internal ops tool at this scale |

---

## Feature Dependencies

```
Auth (email/password)
    └──required by──> RBAC
                          └──required by──> Field-level access control
                          └──required by──> Audit log (user attribution)

Kiosk data model
    └──required by──> Table view
    └──required by──> Kanban view
    └──required by──> Gantt view
    └──required by──> Calendar view
    └──required by──> Reporting module
    └──required by──> Bulk editing
    └──required by──> CSV export
    └──required by──> Dashboard overview

Location/hotel data model
    └──required by──> Kiosk-to-venue assignment
                          └──required by──> Assignment history
                          └──required by──> Hotel-level drill-down in reporting

Configurable pipeline (stages)
    └──required by──> Kanban view (columns = stages)
    └──required by──> Gantt view (stage transitions as milestones)
    └──required by──> Lifecycle reporting (activations, churn)

Saveable custom views
    └──requires──> Table view (base implementation)
    └──enhances──> All view types (filters applied per-view)

Monday.com data migration
    └──requires──> Kiosk data model (target schema)
    └──requires──> Location data model (target schema)
    └──requires──> Configurable pipeline (stage mapping)

Reporting module
    └──requires──> Kiosk data model
    └──requires──> Assignment history (for time-series)
    └──enhances──> Dashboard overview (summary widgets share reporting queries)

Scheduled reports
    └──requires──> Reporting module
    └──requires──> Auth (email delivery to user list)

Contract file attachments
    └──requires──> Location data model
    └──requires──> File storage (S3 or equivalent)
```

### Dependency Notes

- **Auth before everything:** All features require a user identity. Auth is Phase 1 blocker.
- **Data models before views:** Table, Kanban, Gantt, Calendar all render the kiosk/location data model. Data models must be finalised before view work begins.
- **Configurable pipeline before Kanban:** Kanban columns are derived from pipeline stages. The admin-configurable stage system must exist before Kanban is meaningful.
- **Assignment history requires both models:** The kiosk-to-venue relationship depends on both the kiosk and location entities being established.
- **Reporting is last:** Reporting queries the complete data model including assignment history. Building it before the model is stable wastes effort.
- **Migration requires stable target schema:** Monday.com import cannot run until kiosk + location schemas and the pipeline stage list are finalised.

---

## MVP Definition

### Launch With (v1)

Minimum viable set that allows the team to replace Monday.com and operate daily.

- [ ] Email/password authentication + RBAC (Ops/IT/Read-only tiers) — cannot open to 30 users without this
- [ ] Kiosk data model with all required fields — the core system of record
- [ ] Location/hotel data model with structured fields — kiosks without venues is incomplete
- [ ] Configurable lifecycle pipeline (default 9 stages, admin can edit) — the tracking backbone
- [ ] Kiosk-to-venue assignment with history — the key relationship Monday.com cannot model
- [ ] Table view with filter, sort, grouping, column visibility — primary daily-use interface
- [ ] Kanban board view — status management for Ops team
- [ ] Bulk editing — essential for managing 1,000+ records
- [ ] Saveable custom views — without this, users reconfigure every session
- [ ] Audit log — accountability on every change
- [ ] CSV export — minimum reporting output
- [ ] Dashboard overview (fleet health, pipeline distribution) — first screen users land on
- [ ] Monday.com data migration — cannot go live without historical data

### Add After Validation (v1.x)

Features to add once the core system is working and adopted.

- [ ] Gantt view — high complexity; add once Table and Kanban are validated and teams actively plan via the tool
- [ ] Calendar view — add when deployment date/milestone tracking is actively requested
- [ ] Reporting module (time-series, drill-down, custom filters) — add once data model is stable and teams trust data quality
- [ ] Scheduled/automated reports — requires reporting module; add when teams outgrow manual CSV export
- [ ] Contract file attachments (S3) — add when structured contract fields prove insufficient
- [ ] Field-level access control — add if banking details / contract values create access issues with basic RBAC

### Future Consideration (v2+)

- [ ] SSO/OAuth — add if company standardises on identity provider (explicitly out of scope for v1)
- [ ] External-facing report portal — only if hotel partners explicitly request self-service access
- [ ] AI-assisted deployment planning — only if telemetry data is ever ingested and signal quality is high enough

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Kiosk data model | HIGH | MEDIUM | P1 |
| Location/hotel data model | HIGH | MEDIUM | P1 |
| Auth + RBAC | HIGH | MEDIUM | P1 |
| Configurable pipeline | HIGH | MEDIUM | P1 |
| Kiosk-to-venue assignment history | HIGH | HIGH | P1 |
| Table view (filter/sort/group) | HIGH | MEDIUM | P1 |
| Kanban board view | HIGH | MEDIUM | P1 |
| Bulk editing | HIGH | MEDIUM | P1 |
| Saveable custom views | HIGH | MEDIUM | P1 |
| Audit log | HIGH | MEDIUM | P1 |
| Dashboard overview | HIGH | MEDIUM | P1 |
| Monday.com data migration | HIGH | HIGH | P1 |
| CSV export | MEDIUM | LOW | P1 |
| Gantt view | HIGH | HIGH | P2 |
| Calendar view | MEDIUM | MEDIUM | P2 |
| Reporting module (time-series, drill-down) | HIGH | HIGH | P2 |
| Scheduled reports | MEDIUM | MEDIUM | P2 |
| Contract file attachments | MEDIUM | MEDIUM | P2 |
| Field-level access control | MEDIUM | MEDIUM | P2 |
| SSO authentication | LOW | MEDIUM | P3 |
| External-facing portal | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Monday.com (current) | Generic asset trackers | This platform |
|---------|----------------------|------------------------|---------------|
| Custom data model per entity | Partial (column types limited) | No (fixed schemas) | Yes (purpose-built kiosk + hotel schemas) |
| Kiosk-to-venue history | No (flat assignment only) | No | Yes (many-to-many with date ranges and move reasons) |
| Configurable pipeline stages | Yes (admin-editable) | No | Yes (ClickUp-style, skip-able per kiosk) |
| Multiple views (Table/Kanban/Gantt/Calendar) | Yes (but data model limits usefulness) | No | Yes (views tied to actual kiosk/deployment data) |
| Field-level RBAC | No (board-level only) | No | Yes (field visibility per role) |
| Time-series reporting | No (requires BI integration) | No | Yes (native; kiosks live per month, activations) |
| Drill-down reporting | No | No | Yes (summary → region → hotel → kiosk) |
| Contract data (structured + files) | Partial (file attachments, no structured fields) | No | Yes (structured queryable fields + file attachments) |
| Audit log | Partial (activity log, not queryable) | No | Yes (immutable, queryable, attributed to user) |
| Data migration from Monday.com | N/A | N/A | Yes (API-based import with field mapping) |
| Bulk editing at 1,000+ record scale | Partial (limited column types) | No | Yes |

---

## Sources

- [Kiosk Lifecycle Management: The Complete Guide — Hexnode](https://www.hexnode.com/blogs/kiosk-lifecycle-management-the-complete-guide/)
- [Monday.com Limitations for Businesses in 2025 — Witify](https://witify.io/en/blog/monday.com-limitations-for-businesses-in-2025)
- [Monday.com Features: Key Capabilities, Use Cases & Limits — Stackby](https://stackby.com/blog/monday-com-features/)
- [SignifiVISION — Cloud-based Kiosk Management Platform — Signifi](https://www.signifi.com/what-we-do/signifivision-software/)
- [The Definitive Guide to Kiosk Management and Strategy 2026 — Hexnode](https://www.hexnode.com/blogs/the-definitive-guide-to-kiosk-management-and-strategy-2026-edition/)
- [How to plan a successful kiosk deployment in hotels — Evoke Creative](https://www.evoke-creative.com/blog/how-to-plan-a-successful-kiosk-deployment-in-hotels)
- [Centralized Audit Logging with RBAC — hoop.dev](https://hoop.dev/blog/centralized-audit-logging-with-rbac-your-single-source-of-truth/)
- [When to Use Kanban, Gantt, List, or Calendar Views — Taskopad](https://www.taskopad.com/blog/when-to-use-kanban-gantt-list-or-calendar-views-project-views-explained/)
- [Role-Based Access Control: RBAC Guide — Aerospike](https://aerospike.com/blog/role-based-access-control-rbac-guide/)
- [Hotel Asset Management — Asset Infinity](https://www.assetinfinity.com/solutions/hotel-and-hospitality)
- [PROJECT.md — internal project requirements document](/.planning/PROJECT.md)

---

*Feature research for: Internal kiosk/asset deployment management platform*
*Researched: 2026-03-18*
