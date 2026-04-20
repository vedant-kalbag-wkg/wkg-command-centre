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

- `MONDAY_API_TOKEN` — Monday.com integration (data import)
- `MONDAY_BOARD_ID` — Monday.com board id

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

**Monday.com import (optional, requires credentials):**

```bash
# Pulls real kiosk + location rows from the Monday.com "Assets" board.
npm run db:import:monday
```

Prereqs: `MONDAY_API_TOKEN` and `MONDAY_BOARD_ID` in `.env.local`.

## 7. Run the dev server

```bash
npm run dev
```

The app starts on `http://localhost:3003` and redirects unauthenticated requests to `/login`. Sign in with:

- **Email:** `admin@weknow.co`
- **Password:** `Admin123!`

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
