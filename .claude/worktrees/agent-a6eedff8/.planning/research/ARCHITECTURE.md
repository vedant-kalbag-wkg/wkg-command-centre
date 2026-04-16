# Architecture Research

**Domain:** Internal asset/kiosk management platform (data-heavy web app with pipeline, multi-view, reporting, RBAC)
**Researched:** 2026-03-18
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Client Layer)                       │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Table View  │  │ Kanban View  │  │  Gantt View  │  Calendar View │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │        │
│         │                 │                 │               │        │
│  ┌──────┴─────────────────┴─────────────────┴───────────────┘        │
│  │              View Engine (shared data + filter state)              │
│  └──────────────────────────┬───────────────────────────────────────┘│
│                              │                                        │
│  ┌───────────────────────────▼───────────────────────────────────┐    │
│  │   Dashboard  │  Reporting  │  Bulk Editor  │  Settings / Admin  │  │
│  └───────────────────────────┬───────────────────────────────────┘    │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ Server Actions / Route Handlers
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Next.js App Server                               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │
│  │  Auth Layer  │  │  RBAC Guard  │  │  Monday.com Migration Job │    │
│  │ (NextAuth)   │  │ (middleware) │  │  (one-time script)        │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘    │
│         │                 │                                           │
│  ┌──────┴─────────────────▼──────────────────────────────────────┐    │
│  │                    Service / Domain Layer                       │    │
│  │  KioskService │ LocationService │ AssignmentService │           │    │
│  │  ViewService  │ ReportingService│ AuditService      │           │    │
│  └──────────────────────────┬──────────────────────────────────┘    │
│                              │                                        │
│  ┌───────────────────────────▼──────────────────────────────────┐    │
│  │              Repository / Data Access Layer                    │    │
│  │  Prisma ORM + raw SQL for complex aggregations                 │    │
│  └───────────────────────────┬──────────────────────────────────┘    │
└──────────────────────────────┼─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                        PostgreSQL (Cloud RDS / Supabase)             │
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  ┌─────────────┐   │
│  │ kiosks   │  │locations │  │kiosk_assignments │  │ audit_logs  │   │
│  │          │  │          │  │ (temporal join)  │  │             │   │
│  └──────────┘  └──────────┘  └─────────────────┘  └─────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  ┌─────────────┐   │
│  │ pipeline │  │user_views│  │  report_snapshots│  │    users    │   │
│  │  stages  │  │(saved)   │  │(materialized)    │  │    roles    │   │
│  └──────────┘  └──────────┘  └─────────────────┘  └─────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| View Engine | Shared filter/sort/group state, view type switching, column visibility | All four views, ViewService (save/load) |
| Table View | Virtualized sortable/filterable/groupable data grid with bulk select | View Engine, KioskService |
| Kanban View | Drag-drop cards between pipeline stages | View Engine, KioskService (stage update) |
| Gantt View | Timeline bars for deployment planning, milestones | View Engine, KioskService, CalendarService |
| Calendar View | Event calendar for deployments, deadlines | View Engine, KioskService |
| Dashboard | Fleet health KPIs, pipeline counts, key metrics | ReportingService (read-only) |
| Reporting Module | Time-series charts, drill-down, filter slices, scheduled reports | ReportingService, PostgreSQL materialized views |
| Bulk Editor | Multi-record field update, status change, CSV export | KioskService, LocationService |
| Auth Layer | Email/password sessions, JWT tokens | RBAC Guard, users table |
| RBAC Guard | Route + action permission enforcement by role tier | Next.js middleware, session |
| Service Layer | Business logic, pipeline validation, assignment transitions | Repository layer, Audit service |
| Audit Service | Append-only change log for all mutations | audit_logs table |
| Migration Job | One-time Monday.com board → PostgreSQL import | Monday.com GraphQL API, all service layers |
| Admin Settings | Pipeline stage CRUD, user management | Service layer, pipeline_stages table |

## Recommended Project Structure

```
src/
├── app/                        # Next.js App Router pages + API
│   ├── (auth)/                 # Login route group (no nav shell)
│   │   └── login/
│   ├── (app)/                  # Authenticated app shell
│   │   ├── layout.tsx          # Nav, auth gate, RBAC context
│   │   ├── dashboard/
│   │   ├── kiosks/
│   │   │   ├── page.tsx        # Multi-view container
│   │   │   └── [id]/           # Kiosk detail + history
│   │   ├── locations/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   ├── reporting/
│   │   └── settings/           # Admin-only
│   └── api/                    # Route Handlers (external API surface)
│       ├── auth/[...nextauth]/
│       └── export/             # CSV/Excel download endpoints
│
├── server/                     # Server-only code (never imported by client)
│   ├── actions/                # Next.js Server Actions (mutations)
│   │   ├── kiosks.ts
│   │   ├── locations.ts
│   │   ├── views.ts
│   │   └── assignments.ts
│   ├── services/               # Domain business logic
│   │   ├── kiosk.service.ts
│   │   ├── location.service.ts
│   │   ├── assignment.service.ts
│   │   ├── reporting.service.ts
│   │   ├── view.service.ts
│   │   └── audit.service.ts
│   ├── repositories/           # Data access (Prisma + raw SQL)
│   │   ├── kiosk.repo.ts
│   │   ├── location.repo.ts
│   │   └── reporting.repo.ts
│   └── auth/                   # Auth.js config, session helpers
│       ├── config.ts
│       └── rbac.ts             # Permission definitions
│
├── components/                 # React components
│   ├── views/                  # Four view types
│   │   ├── table/
│   │   ├── kanban/
│   │   ├── gantt/
│   │   └── calendar/
│   ├── view-engine/            # Shared filter/sort/save toolbar
│   ├── kiosk/                  # Kiosk-specific components
│   ├── location/               # Location-specific components
│   ├── reporting/              # Charts, drill-down panels
│   ├── dashboard/              # KPI cards, fleet health
│   ├── forms/                  # Shared form components (React Hook Form)
│   └── ui/                     # Design system atoms (brand-aligned)
│
├── lib/                        # Shared utilities (client-safe)
│   ├── utils.ts
│   ├── constants.ts
│   └── types.ts                # Shared TypeScript types/interfaces
│
├── db/                         # Database layer
│   ├── prisma/
│   │   └── schema.prisma
│   └── migrations/
│
└── scripts/                    # One-off scripts
    └── monday-migration/       # Monday.com import tooling
        ├── explore-boards.ts   # Read Monday boards, map schema
        └── import.ts           # Transform + insert to PostgreSQL
```

### Structure Rationale

- **server/:** Hard boundary between server and client code. Next.js enforces this — importing server modules from client components causes runtime errors. Keeping all Prisma, service, and action code here prevents accidental client-side data leaks.
- **components/views/:** Each view type (table, kanban, gantt, calendar) is a self-contained subtree. They share state via the View Engine but have no direct cross-dependencies. This makes each view independently buildable and testable.
- **server/actions/ vs api/:** Server Actions handle internal app mutations (create, update, delete) and get automatic CSRF protection from Next.js. Route Handlers are only used for things that need a real HTTP endpoint — CSV/Excel file downloads and the NextAuth callback.
- **scripts/monday-migration/:** Isolated from the app. Runs once with a `.env.test` API key. Not part of the production bundle.

## Architectural Patterns

### Pattern 1: Layered Service Architecture (no monolithic server actions)

**What:** Server Actions call a service function; service functions call a repository function. Server Actions contain no business logic themselves — they validate input, call the service, and return the result.

**When to use:** Always. Prevents business logic from scattering across Server Actions over time and makes services testable in isolation.

**Trade-offs:** Slightly more boilerplate, but avoids the "fat action" problem that plagues Next.js codebases at scale.

**Example:**
```typescript
// server/actions/kiosks.ts — thin, validation only
export async function updateKioskStageAction(kioskId: string, stageId: string) {
  const session = await requireAuth();
  requirePermission(session, 'kiosks:write');
  return kioskService.transitionStage(kioskId, stageId, session.user.id);
}

// server/services/kiosk.service.ts — business logic lives here
export async function transitionStage(kioskId: string, stageId: string, actorId: string) {
  const kiosk = await kioskRepo.findById(kioskId);
  validateStageTransition(kiosk.currentStageId, stageId); // pipeline rules
  const updated = await kioskRepo.updateStage(kioskId, stageId);
  await auditService.log({ entityType: 'kiosk', entityId: kioskId, actorId, change: { stageId } });
  return updated;
}
```

### Pattern 2: Temporal Join Table for Assignment History

**What:** A `kiosk_assignments` table acts as an associative entity with `assigned_at` (timestamp) and `unassigned_at` (nullable timestamp). Current assignment = `unassigned_at IS NULL`. History = all rows for a kiosk ordered by `assigned_at`.

**When to use:** Required. This is the core data model decision — kiosks move between venues and the system must know where a kiosk was at any point in time.

**Trade-offs:** Slightly more complex queries than a simple FK, but correctly models the domain. A simple `kiosk.location_id` FK cannot capture history or reason for move.

**Example:**
```typescript
// schema.prisma
model KioskAssignment {
  id            String    @id @default(cuid())
  kiosk         Kiosk     @relation(fields: [kioskId], references: [id])
  kioskId       String
  location      Location  @relation(fields: [locationId], references: [id])
  locationId    String
  assignedAt    DateTime  @default(now())
  unassignedAt  DateTime? // NULL = currently assigned
  reason        String?   // "regional reallocation", "maintenance", etc.
  assignedBy    User      @relation(fields: [assignedById], references: [id])
  assignedById  String

  @@index([kioskId, unassignedAt]) // fast "current assignment" lookup
  @@index([locationId, unassignedAt])
}
```

### Pattern 3: Saved Views as Serialised JSON Config

**What:** A `user_views` table stores the complete view configuration (filter conditions, column visibility, sort order, grouping, view type) as a JSONB column. The View Engine deserialises this on load and applies it to the data query.

**When to use:** Required for the "saveable custom views" feature. Avoids one database column per filter option (which would make schema changes painful) and is flexible enough to handle the full filter surface.

**Trade-offs:** Querying inside JSONB is slower than indexed columns, but saved views are read infrequently — the JSON is loaded once and then applied in-app. The actual data query uses standard indexed columns.

**Example:**
```typescript
model UserView {
  id          String   @id @default(cuid())
  userId      String
  name        String   // "My Active Kiosks - London"
  entityType  String   // "kiosks" | "locations"
  viewType    String   // "table" | "kanban" | "gantt" | "calendar"
  config      Json     // { filters: [...], columns: [...], sort: {...}, groupBy: "stage" }
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, entityType])
}
```

### Pattern 4: Append-Only Audit Log

**What:** Every mutation (create, update, delete) writes a row to `audit_logs` with `entity_type`, `entity_id`, `actor_id`, `action`, `before` (JSONB), `after` (JSONB), and `created_at`. The audit log is never updated or deleted — it is append-only.

**When to use:** On every mutation. Call `auditService.log()` inside the service layer after a successful database write. Wrap in the same transaction where possible.

**Trade-offs:** Adds latency to every write (~1–2ms for local PG). For 30 users making occasional updates, this is negligible. Full event sourcing (rebuilding state from events) is explicitly not needed here — a simple audit table is sufficient.

### Pattern 5: Materialized Views for Reporting

**What:** PostgreSQL materialized views pre-aggregate time-series reporting data (kiosks live per month, activations per month, regional breakdown). Refreshed on a schedule (nightly or on-demand after bulk operations).

**When to use:** For the reporting module queries. Direct queries over 1,000+ kiosks with date-range aggregations are fast enough without materialisation, but as assignment history grows, raw aggregations will slow down. Start with plain SQL views; migrate to materialized views when p95 query time exceeds 500ms.

**Trade-offs:** Materialized data is slightly stale (acceptable for trend reports). Incremental refresh via `pg_ivm` is available but not universally supported on managed cloud PostgreSQL — start with manual `REFRESH MATERIALIZED VIEW CONCURRENTLY` on a schedule.

## Data Flow

### Request Flow — Kiosk Stage Transition (Kanban Drag)

```
User drags card to new column
    ↓
KanbanView calls updateKioskStageAction(kioskId, newStageId)
    ↓
Server Action: requireAuth() → requirePermission('kiosks:write')
    ↓
KioskService.transitionStage() — validates stage transition rules
    ↓
Prisma transaction: UPDATE kiosks SET stage_id = ? + INSERT audit_logs
    ↓
Optimistic UI update (React Query mutation) ← returns updated kiosk
```

### Request Flow — Saveable View Load

```
User opens Kiosks page
    ↓
ViewEngine: load default saved view for user (getDefaultViewAction)
    ↓
Server Action queries user_views WHERE userId = ? AND isDefault = true
    ↓
ViewEngine deserialises config JSON → sets filter/sort/column state
    ↓
Data query built from ViewEngine state → passed to active view component
    ↓
Table/Kanban/Gantt/Calendar renders with pre-configured filters applied
```

### Request Flow — Reporting Drill-Down

```
User opens Reporting → Time Series tab
    ↓
ReportingService.getKiosksByMonth(filters) — queries materialized view
    ↓
Chart renders (Recharts/Tremor)
    ↓
User clicks bar for "March 2025" → drill to hotel list
    ↓
ReportingService.getActivationsByLocation({ month: '2025-03', ...filters })
    ↓
User clicks hotel → ReportingService.getKioskDetailForLocation(locationId, month)
    ↓
Individual kiosk rows with assignment history shown
```

### State Management

```
Server State (TanStack Query)
    ↓ (cache + invalidation)
Server Actions / Route Handlers → PostgreSQL
    ↑
Mutations (optimistic updates)

Client State (React Context / Zustand — minimal)
    ↓ (view engine state only)
ViewEngine: { activeView, filters, columns, sort, groupBy }
    ↑
User interactions (filter changes, column toggles, view switches)
```

**Rule:** Server state (kiosk data, location data, reporting data) lives in TanStack Query cache — never duplicated in Zustand. Local UI state (which view is active, unsaved filter state) lives in React context or Zustand. Saved view configuration persists to the database.

### Key Data Flows

1. **Monday.com Migration:** Migration script authenticates with `@mondaydotcomorg/api` → paginates board items → maps Monday fields to local schema → bulk-inserts via Prisma `createMany` with conflict handling → logs unmapped fields for manual review.

2. **Bulk Operations:** User selects N rows in Table View → triggers bulk action modal → single Server Action with array of IDs → service layer loops with individual audit log entries (not a single bulk entry — individual records are needed for drill-down) → React Query invalidates the kiosks list cache.

3. **CSV/Excel Export:** User triggers export → Route Handler (`/api/export/kiosks`) receives current filter state from query params → Repository runs same filtered query → streams CSV via `fast-csv` or builds XLSX buffer via `exceljs` → response as file download.

4. **Pipeline Stage Config:** Admin reorders/renames stages in Settings → Server Action updates `pipeline_stages` table → all View Engine instances re-fetch stages on next mount (TanStack Query cache invalidation by tag).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 30 users, 1,000 kiosks (current) | Monolith on Vercel or single EC2. Prisma + PostgreSQL. No caching layer needed. |
| 200 users, 10,000 records | Add TanStack Query stale-while-revalidate tuning. Consider Redis for session store if auth latency is felt. Add DB connection pooling via PgBouncer or Prisma Accelerate. |
| 1,000+ users | Read replica for reporting queries. Separate background job worker (e.g. AWS Lambda) for scheduled report generation and email. Evaluate materialized view refresh strategy. |

### Scaling Priorities

1. **First bottleneck:** Database connection exhaustion under concurrent users. Fix with PgBouncer (connection pooling) before any other optimisation. Vercel serverless functions each open their own DB connection — this is the first thing that breaks.
2. **Second bottleneck:** Reporting query latency as assignment history grows. Fix with materialized views and read replicas before adding a separate analytics database.

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Server Actions

**What people do:** Put pipeline validation, audit logging, and complex conditional logic directly inside Server Action functions because they're "already on the server."

**Why it's wrong:** Actions become untestable monoliths. Any logic change requires touching the action file. Business rules scatter across dozens of action files.

**Do this instead:** Server Actions are thin — they validate auth/permissions, call one service method, and return the result. All logic lives in the service layer.

### Anti-Pattern 2: Single `kiosk.location_id` FK for Assignment

**What people do:** Add a `locationId` foreign key directly to the `kiosks` table for simplicity because "a kiosk is in one place at a time."

**Why it's wrong:** Loses all assignment history. Cannot answer "where was Kiosk #247 in Q3 2024?" or "which kiosks has this hotel hosted?" Cannot record reason for move.

**Do this instead:** Use the temporal `kiosk_assignments` join table. Current assignment is `WHERE unassigned_at IS NULL`. The kiosk table gets a computed/denormalised `currentLocationId` for fast lookups if needed, but the join table is the source of truth.

### Anti-Pattern 3: Storing View Config in URL Params Only

**What people do:** Encode filter/sort state only in the URL query string and never persist it, assuming users will re-apply their preferences each session.

**Why it's wrong:** Power users working with a fixed set of filters (e.g. "my region, active kiosks only") must re-configure on every visit. The "saveable custom views" requirement exists precisely because this is a real pain point in tools like Monday.com.

**Do this instead:** Persist named views to `user_views` table. URL params are useful for sharing a specific filter state (shareable URLs), but saved views are the primary persistence mechanism.

### Anti-Pattern 4: Full Event Sourcing for Audit

**What people do:** Implement a complete event sourcing system (event store, projections, CQRS read models) for auditability.

**Why it's wrong:** Massive over-engineering for a 30-user internal tool. Adds significant complexity to every write path, requires projection management, and creates a steep learning curve for future maintainers.

**Do this instead:** Append-only `audit_logs` table with `before`/`after` JSONB snapshots. Achieves the same user-facing audit trail with a fraction of the complexity.

### Anti-Pattern 5: One Monolithic View Component

**What people do:** Build a single massive component with `if (viewType === 'kanban') { ... } else if (viewType === 'gantt') { ... }` branching.

**Why it's wrong:** Each view type has radically different DOM structure, library dependencies, and interaction patterns. A monolithic component becomes impossible to maintain and bundles all view code for every page load.

**Do this instead:** Each view type is a lazy-loaded separate component. The view container (`/kiosks/page.tsx`) renders only the active view. Shared state (filters, selected records) lives in the View Engine above all four views.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Monday.com API | One-time migration script using `@mondaydotcomorg/api` SDK (GraphQL) | Use API version `2025-04`. The server SDK `monday-sdk-js` is deprecated — use `@mondaydotcomorg/api` instead. Runs with `.env.test` key, not in production app. |
| PostgreSQL | Prisma ORM for standard queries; raw SQL via `prisma.$queryRaw` for complex reporting aggregations | Use Prisma Accelerate or PgBouncer for connection pooling on Vercel. |
| File Storage (contracts/attachments) | S3-compatible storage (AWS S3 or Cloudflare R2) via presigned URLs | File metadata (name, size, type, s3 key) stored in PostgreSQL. Files streamed directly from S3 to browser — never proxied through the app server. |
| Email (scheduled reports) | Resend or AWS SES via Server Action / cron | Simple transactional email for report delivery. No complex queue needed at this scale. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| View components ↔ View Engine | React context (read) + callbacks (write) | Views never fetch their own data — they receive filtered data from the View Engine which owns the TanStack Query calls |
| Client components ↔ Server | Next.js Server Actions (mutations) + TanStack Query (reads via Server Components or route handlers) | No manual fetch() calls to internal API routes for mutations |
| Service layer ↔ Audit | Direct function call within same transaction | `auditService.log()` runs inside the same Prisma transaction as the mutation — if the mutation fails, the audit entry is also rolled back |
| Migration script ↔ App | Shared Prisma client only | Migration script imports the same Prisma client used by the app. It does not call app Server Actions — it writes directly to the database. |
| Reporting ↔ Core data | Read-only repository methods only | ReportingService never mutates data. Dedicated `reporting.repo.ts` with read-only Prisma queries or raw SQL for aggregations. |

## Build Order Implications

The component dependency graph dictates this build order:

1. **Database schema + Prisma client** — Everything depends on this. Establish the full schema (kiosks, locations, assignments, stages, users, audit_logs, views) before writing any service code.
2. **Auth + RBAC** — Must exist before any other route is accessible. Build once, used everywhere.
3. **Core entities (Kiosks, Locations)** — CRUD for both entities with basic table view. This is the first usable slice of the product.
4. **Assignment history** — Depends on both Kiosk and Location entities existing.
5. **Pipeline stage config** — Depends on kiosk stage field existing in the schema.
6. **View Engine + Table View** — Filter/sort/column/save infrastructure. Other view types depend on this shared layer.
7. **Kanban + Calendar + Gantt** — Can be built in parallel once View Engine exists. Each is a standalone view component consuming the same data layer.
8. **Bulk operations + CSV export** — Depends on Table View and core CRUD being stable.
9. **Audit log** — Should be wired into service layer from step 3 onward (add incrementally as entities are built).
10. **Reporting module** — Depends on real data existing in the database and time-series patterns being established by real usage.
11. **Dashboard** — Aggregates reporting data; build last when all metrics are defined.
12. **Monday.com migration** — One-time script. Can be built any time after schema is stable. Run in staging before production go-live.

## Sources

- Next.js App Router architecture: https://nextjs.org/blog/building-apis-with-nextjs
- Next.js project structure patterns: https://nextjs.org/docs/app/getting-started/project-structure
- Prisma + Next.js + PostgreSQL: https://vercel.com/kb/guide/nextjs-prisma-postgres
- Temporal join table / assignment history: https://www.thegnar.com/blog/history-tracking-with-postgres
- Many-to-many temporal relationships: https://www.beekeeperstudio.io/blog/many-to-many-database-relationships-complete-guide
- Materialized views for dashboards: https://sachinsatpute.medium.com/faster-dashboards-with-postgresql-materialized-views-and-literal-denormalization-ea1f47a86841
- RBAC in Next.js 15 middleware: https://www.jigz.dev/blogs/how-to-use-middleware-for-role-based-access-control-in-next-js-15-app-router
- Auth.js RBAC: https://authjs.dev/guides/role-based-access-control
- Monday.com API v2025-04: https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04
- @mondaydotcomorg/api SDK: https://www.npmjs.com/package/@mondaydotcomorg/api
- React libraries for multi-view project management: https://medium.com/@olgatashlikovich/9-react-libraries-for-project-management-apps-f7657e9e816c
- Audit log with PostgreSQL: https://dev.to/eugene-khyst/lightweight-implementation-of-event-sourcing-using-postgresql-as-an-event-store-59h7

---
*Architecture research for: Internal kiosk/asset management platform*
*Researched: 2026-03-18*
