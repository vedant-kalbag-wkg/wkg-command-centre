# Database

Reference for the data model, driver wiring, migration workflow, and the things that bite. Pair with [`ARCHITECTURE.md`](./ARCHITECTURE.md) for runtime context and [`AZURE-SELF-HOSTING.md`](./AZURE-SELF-HOSTING.md) for the Neon → Azure Postgres migration plan.

## At a glance

| | |
|---|---|
| Engine | Postgres 15+ (15.x on Neon today; 16/17 on Azure Flexible Server fine) |
| ORM | Drizzle (`drizzle-orm`, `drizzle-kit` for migrations) |
| Schema source | `src/db/schema.ts` (single file, 45 `pgTable`s) |
| Migrations | `migrations/*.sql` — generated, never hand-edited once committed |
| Driver | Auto-detected: `@neondatabase/serverless` for `*.neon.tech`, `postgres-js` otherwise |
| SSL | `sslmode=verify-full` (drizzle-kit normalises any weaker mode) |
| Concurrency control | Postgres advisory locks (`pg_try_advisory_lock`) for ETL & imports |
| Seeds | `npm run db:seed` + per-domain seed scripts |

## The driver layer

`src/db/index.ts` is intentionally tiny but it does three important things — understand them before changing anything connection-related.

### 1. Auto-detect by hostname

```ts
if (isNeonUrl(connectionString)) { /* neon-serverless over WebSocket */ }
else                              { /* postgres-js over TCP            */ }
```

`isNeonUrl()` checks `url.hostname.endsWith(".neon.tech")`. Neither driver does any other URL inspection. A regular `postgresql://...` URL pointing at Azure / RDS / a local container hits the `postgres-js` branch and works.

### 2. WebSocket polyfill for Neon outside Edge

The Neon driver speaks **WebSocket**, not raw TCP, because it was designed for serverless/edge runtimes that don't have a TCP socket primitive. In Node.js (no global `WebSocket`), `index.ts` lazy-`require`s `ws`:

```ts
if (typeof globalThis.WebSocket === "undefined") {
  const ws = require("ws");
  neonConfig.webSocketConstructor = ws;
}
```

The `require` is intentional — it keeps `ws` out of edge bundles. **Do not switch this to a top-level import.**

### 3. The two drivers return different shapes from `db.execute()`

This is the gotcha that surprises new contributors:

| Driver | `await db.execute(sql)` returns |
|---|---|
| `postgres-js` | array-like `RowList<T[]>` (iterate / index directly) |
| `neon-serverless` | `QueryResult<T>` with a `.rows` array |

Drizzle's typed query API (`db.select().from(...)`) is uniform. Only **raw `db.execute(sql\`...\`)`** diverges.

We normalise with `executeRowsFromResult<T>(result)` / `executeRows<T>(query)` in `src/db/execute-rows.ts`. **Always use these helpers when you call `db.execute()` with a `sql\`...\`` template.** Don't index `result[0]` or read `result.rows` directly — pick the wrong one and you'll regress one of the two drivers.

### 4. Connection pool sizing

`postgres-js` is created with:

```ts
postgres(connectionString, {
  max: process.env.NODE_ENV === "production" ? 10 : 2,
  idle_timeout: 20,
  connect_timeout: 10,
});
```

Per-process pool of 10 in prod. On Vercel that's per-Lambda-instance, which is fine because Neon's pooled endpoint absorbs the fan-out. **On Azure App Service / Container Apps you'll have a small number of long-lived processes**, each holding 10 connections — see AZURE-SELF-HOSTING.md for sizing.

### 5. CLI scripts use `pg` directly

`scripts/run-azure-etl.ts` builds its own `pg.Pool` + `drizzle-orm/node-postgres` instead of importing `@/db`. This is deliberate: the script has a discrete lifecycle (open, run, close) and shouldn't fight with the app's shared client. If you write another long-running CLI, follow the same pattern — don't import `@/db`.

## Schema by domain

Source of truth: `src/db/schema.ts`. The list below is the navigation map; the file itself has the column definitions, indexes, and inline comments.

### Auth (Better Auth standard tables)

| Table | Purpose |
|---|---|
| `user` | One row per identity. Includes custom `userType` (`internal` / `external`) and `role` (`admin` / `member` / `viewer` / `system`). `system` is automation-only — never grant to a human. |
| `session` | 30-day sliding sessions. |
| `account` | Credential-provider record per user (only `providerId='credential'` is used today). Holds the bcrypt password hash. |
| `verification` | Better Auth's reset / invite token store. |
| `userScopes` | Joins `user` ↔ `regions` / `hotelGroups` / `locationGroups` for non-admin row-level scoping. Read by `src/lib/scoping/`. |

### Kiosks & locations (the core domain)

| Table | Purpose & invariants |
|---|---|
| `locations` | One row per **physical hotel/venue**. Same-name locations are a known data-quality problem (collapsing them is in v2 scope — see `merge_proposals` and `lib/duplicates/`). |
| `kiosks` | One row per device. **`outlet_code` is per-kiosk**, not per-location — multi-POS kiosks have multiple records joined via merge logic (`lib/multi-pos-merge.ts`). |
| `kioskAssignments` | History table. **Append-only**: `assigned_at` is immutable (enforced by trigger from migration `0036`). One location can have N kiosks over time. |
| `kioskConfigGroups` | Hardware/config templates referenced by kiosks. |
| `providers` | Payment providers (per-product). |
| `products` | Products that a kiosk can sell. |
| `locationProducts` | Per-hotel product configuration: provider + commission tier. |

### Region / market dimensions

| Table | Purpose |
|---|---|
| `markets` | Top-level geographic groupings. |
| `regions` | Operational regions; carry `azure_code` for ETL blob path mapping. |
| `hotelGroups` | Brand/operator groupings (Marriott, IHG, etc.). |
| `locationGroups` | Arbitrary user-defined groupings. |
| `locationHotelGroupMemberships` / `locationRegionMemberships` / `locationGroupMemberships` | Many-to-many joins. Each has a uniqueness invariant (e.g. one location can't be in the same region twice — see migrations `0029` / `0030`). |

### Installations (project tracking)

| Table | Purpose |
|---|---|
| `installations` | A deployment project. Status moves through `pipeline_stages`. |
| `milestones` | Date-bound checkpoints inside an installation. |
| `installationKiosks` | Which kiosks belong to which installation. |
| `installationMembers` | Internal POCs / external stakeholders per installation. |

### Sales pipeline (ETL → reporting)

| Table | Purpose |
|---|---|
| `salesImports` | One row per import attempt (CSV upload or ETL run). Region-scoped. Status: `pending` / `staged` / `committed` / `failed`. |
| `import_stagings` | Per-row staging area (1-day retention; pruned by import flow — PR #32). |
| `salesRecords` | The committed transaction-level table. Region-scoped (migration `0022`). Carries reversal columns (migration `0027`). |
| `sales_blob_ingestions` | `(regionId, blobPath)` idempotency table for the Azure ETL — successful processes block reprocessing. |
| `productCodeFallbacks` | Unknown POS product codes → assumed mapping (operator-curated). |
| `outletExclusions` | Outlet codes to ignore in ETL. Region-scoped (migration `0032`). |
| `commissionLedger` | Computed commission lines per sale; recalculated when rates change. |

### Analytics views & saved state

| Table | Purpose |
|---|---|
| `userViews` | Per-user saved table layouts. |
| `analyticsPresets` / `analyticsSavedViews` | Named filter/groupby combos. |
| `eventCategories` / `businessEvents` | Calendar overlay for analytics (e.g. holidays). |
| `weatherCache` | Cache for weather data joined into analytics. |
| `experimentCohorts` | A/B-style cohort grouping; name unique per user (migration `0035`). |
| `eventLog` | Lightweight analytics usage tracking (action type + jsonb metadata + timestamp). `userId` is nullable to allow system events. |

### Operations workflow

| Table | Purpose |
|---|---|
| `locationFlags` | Operator flags on a location (`relocate` / `monitor` / `strategic_exception`) with reason + resolution. Drives the data-quality review surface. |
| `actionItems` | Open work items derived from flags / data-quality findings / manual entry. Status workflow `open` → `in_progress` → `resolved` / `cancelled`; optionally tied to a location and an owner. |
| `mergeProposals` | Pending location merges (cluster_id + canonical/defunct + decision). Applied via `lib/multi-pos-merge.ts`; CHECK constraint on `decision` enum at the DB layer (migration `0038`). |
| `duplicateDismissals` | Operator decisions on duplicate suggestions — prevents re-flagging. |

### Settings & operational

| Table | Purpose |
|---|---|
| `appSettings` | Singleton settings rows (k/v). |
| `pipelineStages` | Configurable installation status workflow. |
| `auditLogs` | Append-only operational log. `entity_id` is text (not uuid) so we can audit string-keyed entities (migration `0010`). |

## Key invariants (do not break)

1. **`kiosk_assignments.assigned_at` is immutable** (trigger from `0036`). Append a new row to change history; never `UPDATE` an existing one.
2. **`outlet_code` is on `kiosks`, not `locations`.** A hotel with multiple POS systems has multiple kiosks. Sales aggregation across them goes through `lib/multi-pos-merge.ts`.
3. **Region scoping is the access-control boundary** for non-admins. `salesRecords`, `salesImports`, `outletExclusions` all carry `regionId` so non-admin members only see what `userScopes` permits. Joins must respect this — `lib/scoping/scoped-query.ts` is the helper.
4. **`disableSignUp` is locked.** New users come in via the invite flow only. Don't add a public sign-up route.
5. **`system` role exists for ETL only** — `lib/rbac.ts` deliberately excludes it from the `Role` union. If you find yourself adding it back, you're holding it wrong.
6. **`audit_logs` is the legal record.** Every Server Action that mutates user-visible data must write a row. See `lib/audit.ts`.
7. **Same-name locations are not yet collapsed** (v2 work). Suffix-stripping in v1.0 is **display-only**; the underlying duplicate rows still exist. Don't write code that assumes name uniqueness.

## Migration workflow

`drizzle-kit` is the only migration tool. The `migrations/` directory has 39 forward migrations (`0000`–`0038`) and a `meta/` snapshot — it's append-only after merge.

```bash
# 1. Edit src/db/schema.ts.
# 2. Generate the SQL diff (writes a new migrations/NNNN_<name>.sql + updates meta/_journal.json):
npx drizzle-kit generate

# 3. Review the SQL by hand. Add hand-written DDL (e.g. triggers) only by amending the generated file
#    BEFORE you commit — once it's merged, treat it as immutable and write a follow-up migration instead.

# 4. Apply locally:
npx drizzle-kit migrate

# 5. Commit schema + migration + meta together.
```

Operational notes:

- **Apply to prod manually** after merge (we don't auto-migrate on deploy). Pattern is in handoff docs under `tasks/`:
  ```bash
  DATABASE_URL='<prod-url>' npx drizzle-kit migrate
  ```
- **`drizzle-kit push` is a dev convenience.** Don't run it against any shared environment — it bypasses the migration history.
- **`drizzle-kit migrate` rejects an inconsistent `_journal`.** If you see "Migration not found in folder", you've either deleted/renamed a committed file or two branches added migration `NNNN` independently. Resolve by renumbering the latest one and rebasing.
- **SSL mode is rewritten to `verify-full` by `drizzle.config.ts`** before passing to drizzle-kit. The rewrite catches `sslmode=require|prefer|verify-ca` and forces `verify-full` (silences a `pg-connection-string` v3 deprecation warning and pins strict cert checking). Your runtime `DATABASE_URL` is *not* rewritten — only the migration tool's connection.

## Concurrency: advisory locks

Long-running operations (ETL run, Monday import) use `pg_try_advisory_lock(<int8 key>)` — non-blocking, session-scoped — to prevent concurrent runs from racing.

- Wrapper: `src/lib/sales/etl/advisory-lock.ts` (`withAdvisoryLock(db, key, fn)`).
- Existing keys: `ETL_AZURE_LOCK_KEY` (Azure ETL), Monday import key in `settings/data-import/monday/actions.ts`.
- Behaviour: if the lock can't be acquired, returns `{ status: "skipped-lock" }` (HTTP 409 / exit code 2). The caller is expected to be idempotent.
- The lock is released on the same connection. **Do not** mix this with a connection pool that can move you between sockets mid-transaction — if you ever introduce PgBouncer in transaction-pooling mode, advisory locks will silently break. See AZURE-SELF-HOSTING.md.

## Seeds & dev data

| Script | What it seeds |
|---|---|
| `npm run db:seed` | Admin user + minimum reference data (roles, pipeline stages, etc.) |
| `npm run db:seed:kiosks` | A small kiosks fixture |
| `npm run db:seed:markets` | Markets + regions tree |
| `npm run db:seed:sales-demo` | Synthetic sales for analytics smoke testing |
| `npm run seed:azure-testdata` | Uploads CSV fixtures to a local/dev Azure Blob container so the ETL has something to chew on |
| `npm run db:import:monday` | One-shot import from Monday.com (real data; needs a valid token) |

All seeds are idempotent — re-running won't duplicate. They read from `.env.local`. Don't seed against prod.

## Testing the database layer

- **Vitest unit tests** colocated with code (`*.test.ts`) — fastest feedback.
- **Integration tests** under `tests/db/` and `tests/etl/` use **Testcontainers** (`@testcontainers/postgresql`) to spin up a real Postgres in Docker. These hit the same Drizzle layer the app uses — required for anything that exercises raw SQL, advisory locks, or migrations.
- **Don't mock the database in tests that exercise SQL.** This is feedback codified into CLAUDE.md after a prior incident — mocked tests passed while a migration broke prod.

## Common operational queries

```sql
-- Who has access to what (RBAC scoping debug)
SELECT u.email, u.role, u.user_type, us.scope_type, us.scope_id
FROM "user" u LEFT JOIN user_scopes us ON us.user_id = u.id
ORDER BY u.email;

-- Active kiosks per location (most recent assignment, not yet ended)
SELECT l.name, k.outlet_code, ka.assigned_at
FROM kiosk_assignments ka
JOIN kiosks k    ON k.id = ka.kiosk_id
JOIN locations l ON l.id = ka.location_id
WHERE ka.unassigned_at IS NULL
ORDER BY l.name, ka.assigned_at DESC;

-- ETL idempotency: what's been processed for a region today
SELECT blob_path, status, ingested_at
FROM sales_blob_ingestions
WHERE region_id = '<uuid>' AND ingested_at::date = CURRENT_DATE
ORDER BY ingested_at DESC;

-- Stuck advisory locks (should be empty when nothing's running)
SELECT pid, locktype, classid, objid, granted
FROM pg_locks WHERE locktype = 'advisory';
```

## Lockfile / npm gotcha

This repeatedly bites contributors and is **always the same root cause**: macOS-generated lockfiles miss the Linux x64 wasm32-wasi platform entries that CI needs. The full runbook is in the **root `CLAUDE.md`** ("npm lockfile must stay in sync") — don't reinvent the workaround. Short version: regenerate inside `node:22-bookworm` with `--platform linux/amd64` and an isolated build directory.

## Things to be careful about when editing the schema

- **Adding a NOT NULL column to a populated table** needs a backfill default in the generated migration, or a two-step (add nullable → backfill → set NOT NULL). Drizzle generates the naive form; review before committing.
- **Renaming columns** generates a `DROP` + `ADD`, not a rename. Edit the migration to use `ALTER ... RENAME`.
- **Indexes are not free.** Several phase-2 migrations (`0020`, `0021`) added covering indexes specifically for analytics hot paths. Don't drop them without checking the analytics queries.
- **JSONB defaults must be cast** (`'{}'::jsonb`), not bare `'{}'`.
- **Enums** — schema currently uses inline check constraints / text columns over `pgEnum`. If you add an enum, prefer text+check (matches existing pattern) so you can extend without a migration.
