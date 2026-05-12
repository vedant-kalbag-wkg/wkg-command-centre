# Local Development Setup

This guide walks through setting up `wkg-kiosk-tool` for local development on a fresh machine.

## Prerequisites

- **Node.js 20+** and **npm**
- **Docker Desktop** (for the local Postgres container). Alternative: any Postgres 16 reachable at `localhost:5432`.
- **git**

## 1. Clone and install dependencies

```bash
git clone <repo-url> wkg-kiosk-tool
cd wkg-kiosk-tool
npm install
```

## 2. Start local Postgres

We use Postgres 16 in a Docker container named `wkg-pg`. The container listens on the default port 5432.

```bash
# First-time setup (creates and starts the container):
docker run -d --name wkg-pg -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16

# Subsequent sessions (the container already exists):
docker start wkg-pg
```

Verify the container is healthy:

```bash
docker ps | grep wkg-pg
docker exec wkg-pg pg_isready -U postgres
```

## 3. Create the dev database

```bash
docker exec wkg-pg psql -U postgres -c "CREATE DATABASE wkg_kiosk_dev;"
```

If the database already exists you'll see `ERROR: database "wkg_kiosk_dev" already exists` — that's fine, skip ahead.

## 4. Configure `.env.local`

Create a `.env.local` file in the repo root (it's gitignored):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wkg_kiosk_dev
BETTER_AUTH_SECRET=<generate-a-random-32-char-string>
BETTER_AUTH_URL=http://localhost:3003
```

Generate a secret with:

```bash
openssl rand -base64 32
```

Optional variables used by specific features (safe to omit for most local work):

- `MONDAY_API_TOKEN` — Monday.com data import / `npm run db:reseed` (board IDs are hardcoded in `src/lib/monday/`; the optional `BOARD_ID` override is read only by `scripts/diagnose-new-board.ts`)
- `RESEND_API_KEY` / `EMAIL_FROM` / `ADMIN_SUPPORT_EMAIL` — Phase 8 email send (set `RESEND_API_KEY=re_test_key` to satisfy `src/lib/rbac.test.ts` even when not exercising email — see DEFERRED-08.02-01)
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — Inngest webhook auth in deployed envs; can stay blank locally if you run the Inngest dev server (Step 7b)
- `FX_ALERT_TO` — Recipient for `fx_rate_fetch_failed` (cron) and `fx_rate_stale` (Azure ETL pre-blob gate) emails. **Required on every deploy target** — `fx-rates-fetch-daily` and `azure-etl` throw at the call site if unset (Phase 9.1 CR-02)
- `AWS_S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `NEXT_PUBLIC_AWS_S3_BUCKET` — Contract document uploads on locations
- `AZURE_STORAGE_CONNECTION_STRING` *or* `AZURE_STORAGE_ACCOUNT_URL` + `AZURE_BLOB_CONTAINER` — Sales ETL source
- `ETL_AZURE_ENABLED` + `ETL_SHARED_SECRET` — Both must be set for `/api/etl/azure/run` to accept a request
- `GOOGLE_MAPS_API_KEY` — `/settings/geocoding`
- `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` — Auth-flow E2E specs in `tests/auth/*`
- `PLAYWRIGHT_BASE_URL` — Run Playwright against a preview/prod URL instead of starting a local dev server

Full list with annotations: `.env.example`. Every `process.env.*` referenced from `src/`, `scripts/`, and `tests/` is documented there.

## 5. Apply the Drizzle schema

```bash
npx drizzle-kit push
```

This pushes the current `src/db/schema.ts` to the dev database. For local dev we use `push` (non-destructive for additive changes); CI/prod use the migration files under `migrations/`.

Verify the expected tables are present:

```bash
docker exec wkg-pg psql -U postgres -d wkg_kiosk_dev -c "\dt"
```

You should see tables including `user`, `kiosks`, `locations`, `installations`, `products`, `providers`, `pipeline_stages`, `audit_logs`, `sessions`, etc.

## 6. Seed the database

Two seed scripts must run for a usable dev environment:

```bash
# Creates the admin user (admin@weknow.co / Admin123!)
npm run db:seed

# Creates the 9 default pipeline stages (Prospect, On Hold, Live, ...)
npx tsx --env-file=.env.local --tsconfig tsconfig.json src/db/seed-pipeline-stages.ts
```

Both scripts are idempotent — re-running them is safe.

Verify the admin user exists:

```bash
docker exec wkg-pg psql -U postgres -d wkg_kiosk_dev \
  -c "SELECT email, role FROM \"user\" WHERE email = 'admin@weknow.co';"
```

## 6b. Localhost data bootstrap (kiosks, markets, sales demo)

The seeds in Step 6 only create the admin user and pipeline stages. To populate
kiosks, locations, and sales data — required for QA of `/kiosks`, `/analytics`,
and the reference pages — run the optional seeds and/or the Monday import:

```bash
# 8 demo kiosks across all pipeline stages, with populated
# hardware_serial_number values ("SN-KP22-0001" etc.) — needed for the
# "Asset" column on /kiosks to render non-blank on localhost.
npm run db:seed:kiosks

# Markets / regions used by the portfolio analytics pages.
npm run db:seed:markets

# Sales-demo locations + installations used by analytics fixtures.
npx tsx --env-file=.env.local --tsconfig tsconfig.json src/db/seed-sales-demo.ts
```

All three are idempotent (skip when their target rows already exist) and depend
on the base seeds from Step 6 — run them in order.

**Monday.com import / structural reseed (optional, requires credentials):**

```bash
# Dry-run by default — prints what WOULD be wiped + reseeded from Monday.
npm run db:reseed

# Commit. Wipes the Monday-sourced + sales-sourced + audit/temporal tables
# (see `.planning/notes/v2-data-reset-decision.md` for the wipe vs preserve
# list) and rebuilds locations, kiosks, and assignments from the 4 hotel
# boards + Heathrow + Assets + seed_data/*.csv.
npm run db:reseed -- --apply
```

Prereqs: `MONDAY_API_TOKEN` in `.env.local`. Board IDs are hardcoded in `src/lib/monday/`; only `scripts/diagnose-new-board.ts` reads the optional `BOARD_ID` override.

Two legacy scripts (`scripts/import-from-monday.ts` invoked via `db:import:monday`, and `scripts/enrich-locations-from-monday.ts` invoked via `db:enrich:locations`) were deprecated in Phase 07-06 and removed from `package.json` in the 2026-05-12 metadata-backfill change. Both still exist on disk as hard-fail stubs that print a deprecation pointer to `db:reseed`.

### Fresh-DB bootstrap (zero-touch, post-2026-05-12)

Brand-new Neon branch / fresh Postgres → fully populated dev instance in four commands. The Monday metadata backfill made this end-to-end: importer now writes 15 location metadata fields on hotel boards (8 on Heathrow) with fill-NULLs-only ON CONFLICT semantics, and the reseed orchestrator auto-seeds `kiosk_config_groups` from the Monday SSM-Groups board so no operator-curated rows are required up front.

```bash
# 1. Provision a Postgres DB (Neon branch, Docker container, etc.).
#    Note the connection string.

# 2. Apply schema migrations (canonical; never `drizzle-kit push` against
#    anything you care about — `push` bypasses the migration history).
DATABASE_URL='<conn>' npx drizzle-kit migrate

# 3. Seed the admin user (idempotent).
#    Reads ADMIN_EMAIL + ADMIN_PASSWORD from .env.local if unset.
ADMIN_EMAIL=admin@weknow.co ADMIN_PASSWORD='Admin123!' npm run db:seed

# 4. Reseed structural data from Monday + seed_data/*.csv.
#    Dry-run first (no `--apply`) to inspect counts; then commit.
MONDAY_API_TOKEN='<token>' npm run db:reseed -- --apply
```

Expected post-step-4 STEP 4 log line includes `addresses-written`, `hotel-groups-resolved`, `kcg-resolved`, and `kcg-unresolved` counters — non-zero `kcg-unresolved` is normal (operator triage: Monday SSM-Group names that don't yet match a `kiosk_config_groups` row).

For prod hostname patterns see `.env.production`; for dev see `.env.local`.

## 7. Run the dev server

```bash
npm run dev
```

The app starts on `http://localhost:3003` and redirects unauthenticated requests to `/login`. Sign in with:

- **Email:** `admin@weknow.co`
- **Password:** `Admin123!`

## 7b. Run the Inngest dev server (optional, required for email/cron flows)

Phase 8/9/9.1 features (email send, weekly POC alerts, daily BoE FX fetch) run as Inngest functions. To exercise them locally:

```bash
# In a second terminal (the dev server must be running on :3003):
npx inngest-cli@latest dev -u http://localhost:3003/api/inngest
```

The dashboard at `http://localhost:8288` shows function registrations and lets you trigger any cron/event manually. With both servers up you can drop `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` from `.env.local`.

To inspect rendered email templates without a real send:

```bash
npm run email:dev          # react-email playground at http://localhost:3000
```

## 8. Run the test suites

```bash
# Unit tests (fast)
npx vitest run

# Playwright E2E (uses the running dev server; auto-starts one if needed)
npx playwright test
```

Playwright reads the admin credentials from `tests/helpers/auth.ts` (which must match the seed). `.env.test` holds additional credentials for helpers that need them.

## Resetting the database

To wipe and reapply the schema from scratch:

```bash
docker exec wkg-pg psql -U postgres -c "DROP DATABASE wkg_kiosk_dev;"
docker exec wkg-pg psql -U postgres -c "CREATE DATABASE wkg_kiosk_dev;"
npx drizzle-kit push
npm run db:seed
npx tsx --env-file=.env.local --tsconfig tsconfig.json src/db/seed-pipeline-stages.ts
```

## Troubleshooting

- **`ECONNREFUSED 127.0.0.1:5432`** — Postgres container isn't running. `docker start wkg-pg`.
- **`database "wkg_kiosk_dev" does not exist`** — Run Step 3.
- **`FATAL: role "postgres" does not exist`** — Container started without the `POSTGRES_PASSWORD` env var. Recreate with the `docker run` command in Step 2.
- **Playwright can't sign in as admin** — Seed didn't run (Step 6). Verify with the `SELECT email` query above.
- **`drizzle-kit push` prompts about data loss** — Review the diff; for a fresh dev DB the prompt should offer only `CREATE` statements. If you see `DROP`, your local schema has drifted from `main`.
- **`vitest run` fails with `RESEND_API_KEY` undefined in `src/lib/rbac.test.ts`** — Set `RESEND_API_KEY=re_test_key` in your shell or `.env.local`. Root cause is module-scope `new Resend(...)` in `src/lib/email.ts`; canonical fix is lazy construction (DEFERRED-08.02-01).
- **`fx-rates-fetch-daily` or Azure ETL throws on cold start** — `FX_ALERT_TO` is unset on the deploy target. Fix it on Vercel (or `.env.local`); Phase 9.1 hard-fails at the call site rather than silently dropping the alert recipient.
- **CI fails with `Missing: @emnapi/...`** — Lockfile drift between macOS-arm64 and Linux-x64. Go straight to the Docker regen procedure in repo `CLAUDE.md` § "npm lockfile must stay in sync".
- **Vercel preview deploy: `403 Invalid origin` from `/api/auth/*`** — `BETTER_AUTH_URL` is pinned to a per-deploy hash URL. Fix it to the git-branch alias (`wkg-command-centre-git-<branch>-...`); see repo `CLAUDE.md` § "Vercel preview env vars".

## Without Docker

If you cannot run Docker, install Postgres 16 via Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb wkg_kiosk_dev
```

Then update `DATABASE_URL` in `.env.local` to match your local Postgres credentials (the Homebrew install defaults to your OS username with no password):

```
DATABASE_URL=postgres://$(whoami)@localhost:5432/wkg_kiosk_dev
```
