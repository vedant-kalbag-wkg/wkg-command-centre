# Azure self-hosting

How to lift `wkg-command-centre` off Vercel + Neon and run it entirely in Azure — including every Neon-specific behaviour you need to substitute, and every Vercel-platform assumption to replace.

Pair with [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`DATABASE.md`](./DATABASE.md). The CLAUDE.md at repo root has additional ops runbooks (lockfile, prod password rotation) that are still relevant when self-hosting.

## TL;DR — what changes

| Component | Today | Azure equivalent | Code change required? |
|---|---|---|---|
| App hosting | Vercel | **Azure Container Apps** (recommended) or Azure App Service Linux | None for app code; add a `Dockerfile` + standalone Next output |
| Postgres | Neon (serverless, pooled, eu-west-2) | **Azure Database for PostgreSQL — Flexible Server** | None — driver auto-detects (see below) |
| Cron | Vercel cron (`x-vercel-cron` header) | **Azure Container Apps Job** (cron schedule) **or** Logic Apps recurrence | None — `x-etl-token` fallback already wired |
| Secrets | Vercel env vars | **Azure Key Vault** (referenced from App Service / Container App config) | None |
| Blob storage (sales ETL) | Azure Blob Storage | **Azure Blob Storage** | None (already Azure-native) |
| Object storage (contract docs) | AWS S3 | Stay on S3 **or** swap to Azure Blob | If swapping: ~1 module replacement (`locations/actions.ts` upload path) |
| Email | SMTP / Resend | SMTP / Resend / **Azure Communication Services Email** | None for SMTP; trivial for ACS |
| TLS / domain | Vercel-managed | **Azure Front Door** or App Service custom domain + managed cert | None |
| Observability | Vercel logs + traces | **Application Insights** (OpenTelemetry exporter) | Optional `instrumentation.ts` addition |

> The high-order bit: **the codebase is already Azure-portable** because the DB driver auto-detects, the only platform-coupled HTTP route has a token fallback, and there's no edge-runtime usage. The work is infra setup, not code surgery.

## 1. Database — Neon → Azure Postgres Flexible Server

This is the part with the most subtle Neon-specific behaviour to substitute. Read all of it before provisioning.

### What Neon gives us today (and what's coupled to it)

| Neon feature | Where it shows up in the codebase | Substitute on Azure |
|---|---|---|
| Hostname `*.neon.tech` triggers `@neondatabase/serverless` | `src/db/is-neon-url.ts` + `src/db/index.ts` | Use any non-`.neon.tech` URL → automatic `postgres-js` branch. **No code change.** |
| WebSocket transport (no raw TCP from edge) | `neonConfig.webSocketConstructor = ws` in `src/db/index.ts` | Not needed. `postgres-js` uses TCP directly. The `ws` polyfill stays in the bundle but is harmless. |
| Built-in pooled endpoint (`-pooler.<region>.aws.neon.tech:6543`) | Used in prod URL today | Replace with **PgBouncer** (Flexible Server has it as an integrated feature) or run pgbouncer sidecar. **Critical caveat:** advisory locks break under PgBouncer transaction-pooling. Use *session* pooling, or bypass PgBouncer for the ETL connection. |
| `channel_binding=require` URL param | Neon-only TLS hardening | Drop it. Azure Postgres uses standard libpq SSL — `sslmode=verify-full` covers the same bases. |
| `db.execute()` shape divergence (`.rows` vs array-like) | `src/db/execute-rows.ts` normalises both | **Stays.** It's defensive against any future driver swap. Don't remove just because you're off Neon. |
| Branching (zero-cost DB clones) | Used by some teams for preview envs; **we do not use it** today | No equivalent on Azure. Use restore-to-PITR or logical replication for a dev clone. |
| Auto-suspend on idle | Neon's serverless model | No equivalent — Flexible Server is always-on. Pick a small SKU for dev (`B1ms`). |
| `neondb_owner` superuser | Default in Neon | Azure equivalent is the admin login you set at provisioning time (e.g. `pgadmin`). Use it only for migrations + role provisioning; create a least-privilege app user for runtime. |
| 5-min query timeout (Neon proxy) | Implicit | Not present. Set `statement_timeout` at the role/database level if you want a similar guard. |

### Provisioning checklist

1. **Create a Flexible Server** (not Single Server — that SKU is being deprecated). Region matching your app region (West Europe ≈ eu-west-2 of today's Neon).
2. **Postgres version 15 or 16.** Stay within one major of what we run on Neon (today: 15). 17 is fine but no reason to chase it.
3. **Compute sizing**: start `Standard_B2ms` (2 vCPU / 8 GB) for prod. Scale up as analytics queries demand. Note: `max_connections` defaults around 429 on B2ms — see pool sizing below.
4. **Storage**: 64 GB to start with auto-grow on. Sales tables grow linearly with kiosk count × days.
5. **High availability**: zone-redundant for prod. Skip for non-prod.
6. **Backup**: 7-day PITR for prod. (Neon's branching is gone; PITR is the recovery story now.)
7. **Networking**:
   - Prefer **VNet integration** with the App Service / Container App in the same VNet. Public access only if you must.
   - If public, lock the firewall to the App Service outbound IPs (or use a NAT Gateway with a static egress IP).
   - **`require_secure_transport = ON`** (default) — clients must use TLS.
8. **Extensions**: enable on the server before the app starts:
   - Drizzle migrations don't require any extension today.
   - If you ever add `pgcrypto`, `uuid-ossp`, `pg_trgm`, etc., add them to the server allow-list (Azure has a whitelist).
9. **Roles**:
   ```sql
   CREATE ROLE wkg_app LOGIN PASSWORD '<random>';
   GRANT CONNECT ON DATABASE wkg_prod TO wkg_app;
   GRANT USAGE ON SCHEMA public TO wkg_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wkg_app;
   GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO wkg_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wkg_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO wkg_app;
   ```
   The migration user (admin) is *not* the runtime user.

### Connection string

```
postgresql://wkg_app:<password>@<server>.postgres.database.azure.com:5432/wkg_prod?sslmode=verify-full
```

- **Host does not end in `.neon.tech`** → `isNeonUrl()` returns false → `postgres-js` driver. No code change.
- **`sslmode=verify-full`** — Azure presents a Microsoft-issued cert. Bundle the CA chain in the container image (libpq picks it up from system trust). On `node:22-bookworm` the chain is in `/etc/ssl/certs/ca-certificates.crt` — already trusted, you don't need to ship it.
- **Drop `channel_binding=require`** — Neon-specific.
- **Don't put the password in plaintext.** Reference it from Key Vault (see §6).

### Pool sizing

Today: `postgres-js` is configured `max: 10` per process (in prod). On Vercel that's per-Lambda-instance. On Azure, you have a small number of long-lived Container App replicas, each holding 10 connections.

- Container App with `max_replicas=4` → 40 app connections. Add ETL CLI runs and headroom → reserve 60.
- Flexible Server B2ms `max_connections ≈ 429` — comfortable.
- If you scale replicas higher, **front the DB with PgBouncer** in *session* mode (Flexible Server's built-in PgBouncer supports `session` and `transaction` modes — pick `session`). **Do not** use transaction mode: it breaks `pg_try_advisory_lock` (locks live on a session, not a transaction).

### Migrations

Same workflow as today:

```bash
DATABASE_URL='postgresql://pgadmin:...@...azure.com/wkg_prod?sslmode=verify-full' \
  npx drizzle-kit migrate
```

Run from a maintenance host (laptop, jumpbox, GitHub Actions with a private runner). Use the **admin** user — the runtime `wkg_app` user doesn't have DDL.

### What does **not** carry over

- **Neon branches** (cheap DB clones) — gone. Plan dev/preview environments differently:
  - One always-on dev server (B1ms) refreshed periodically from a sanitised prod dump.
  - **Or** use Testcontainers for ephemeral ad-hoc envs (already used in tests).
- **Auto-suspend** — gone. Pick a small SKU and live with it.
- **`pooler.` hostname pattern** — replaced by Flexible Server's PgBouncer endpoint (`<server>.postgres.database.azure.com` on a different port if you enable it).

## 2. App hosting — Container Apps (recommended) vs App Service

Both work. Container Apps is closer to the Vercel ergonomics; App Service is the safer enterprise default.

### Why Container Apps wins for this app

- **Container Apps Jobs** give you cron-as-a-first-class-resource — better than App Service WebJobs.
- Scales to zero on cold paths.
- Same KEDA-based autoscaling as Functions but without the Functions runtime constraints.
- VNet integration is straightforward.

### Dockerfile (sketch)

The app runs Next.js in **standalone output** mode. Add to `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  // … existing headers etc.
};
```

Then a multi-stage Dockerfile:

```Dockerfile
# build
FROM node:22-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# runtime
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Build-time gotcha (the same one we already document)

`npm ci` on Linux x64 needs lockfile entries that macOS-generated lockfiles miss. The runbook is in **root `CLAUDE.md`** — read it before your first CI build. Two failure shapes:

1. `npm error Missing: @emnapi/...` at install — lockfile lacks wasm32-wasi nested deps.
2. Runtime `Cannot find module '@*/binding-linux-x64-gnu'` — lockfile lacks the x64 binding.

Fix is the documented `docker run --platform linux/amd64 node:22-bookworm` regen on a clean directory.

### Env vars / secrets at runtime

Set on the Container App (or App Service Configuration):

| Var | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Key Vault → secret reference | See §6 |
| `BETTER_AUTH_SECRET` | Key Vault | 32+ random bytes, base64 |
| `BETTER_AUTH_URL` | App config (plain) | **Stable origin** — see §7 |
| `ETL_SHARED_SECRET` | Key Vault | Long random |
| `ETL_AZURE_ENABLED` | App config (plain) | `true` to enable cron |
| `AZURE_STORAGE_CONNECTION_STRING` *or* `AZURE_STORAGE_ACCOUNT_URL` | Key Vault / Managed Identity | Prefer Managed Identity (see §3) |
| `AZURE_BLOB_CONTAINER` | App config | e.g. `clientdata` |
| `AWS_*` | Key Vault | If you keep S3 for contract docs |
| `MONDAY_API_TOKEN` | Key Vault | |
| `GOOGLE_MAPS_API_KEY` | Key Vault | |
| `EMAIL_FROM`, `SMTP_*` / `RESEND_API_KEY` | Mix | Phase 8 will move to Resend |
| `NODE_ENV` | App config | `production` |

### Health probe

The app exposes nothing custom — Container Apps' default HTTP probe at `/` will hit the marketing/sign-in page (200) and works. If you want a cheaper probe, add a `/api/health` route handler that returns `{ ok: true }`.

## 3. Cron — replace `x-vercel-cron`

Today: Vercel posts to `/api/etl/azure/run` with `x-vercel-cron: 1`. The route already accepts `x-etl-token: $ETL_SHARED_SECRET` as the alternative — **no code change needed**.

### Recommended: Azure Container Apps Job

```yaml
# (azd / bicep snippet — sketch)
schedule: "0 4 * * *"
containers:
  - image: <acr>.azurecr.io/wkg-cron:latest
    command: ["/bin/sh", "-c"]
    args:
      - |
        curl -fsS -X POST \
          -H "x-etl-token: $ETL_SHARED_SECRET" \
          https://<app-host>/api/etl/azure/run
```

Or run the CLI variant (`scripts/run-azure-etl.ts`) directly inside a job container that has the app image — no HTTP hop needed:

```
command: ["node", "scripts/run-azure-etl.js"]
```

The CLI variant builds its own `pg.Pool` and exits cleanly — designed for exactly this use case.

### Alternatives

- **Logic Apps** recurrence trigger → HTTP action with the bearer header. Simpler if you're not deep in containers.
- **GitHub Actions schedule** — cheap and obvious, but couples your runtime to GitHub uptime. Fine for non-prod.
- **Azure Functions Timer** — works but requires the Functions runtime; over-engineered for a single curl.

### Storage / state for blob processing

The `sales_blob_ingestions` table provides idempotency — re-running a job for the same `(regionId, blobPath)` is a no-op. Set `--max-retries` low on the job; the table prevents double-processing.

## 4. Object storage — AWS S3 → Azure Blob (optional swap)

Today: contract documents on `locations` use `@aws-sdk/client-s3` + presigned URLs. The S3 bucket is decoupled from the rest of the app (no other surface uses it).

Two paths:

### Option A — Keep S3

Cleanest "lift". Azure can call AWS without issue. Maintain `AWS_*` env vars. Cost: cross-cloud egress on every download (cheap; contracts are small).

### Option B — Move to Azure Blob

Replace `S3Client` + `getSignedUrl` with `BlobServiceClient` + `generateBlobSASQueryParameters`. The container is already wired (`@azure/storage-blob` is a dep — used by ETL).

Files to touch:
- `src/app/(app)/locations/actions.ts` — the upload + URL signing logic (search for `S3Client`).
- `src/app/(app)/locations/__tests__/*` — update test fixtures.

Recommendation: **defer** unless you're actively decommissioning AWS. The swap is mechanical but adds churn.

## 5. Email — SMTP / Resend / ACS Email

Phase 8 (in plan) moves email from `nodemailer` SMTP to **Resend**, with an Inngest-managed async substrate. None of that is Vercel-coupled — Resend works on Azure identically.

If you want a fully-Microsoft stack, **Azure Communication Services Email** is a drop-in for transactional. It has a Node SDK and supports the same shape (from / to / subject / html). Wire it in `src/lib/email.ts`.

DKIM / SPF / DMARC: configure on whatever domain `EMAIL_FROM` uses. Same as on any provider.

## 6. Secrets — Key Vault

Don't put `DATABASE_URL`, `BETTER_AUTH_SECRET`, or any API token directly in App Configuration. Pattern:

1. Create one Key Vault per environment (`kv-wkg-prod`, `kv-wkg-staging`).
2. Store secrets there.
3. Give the App Service / Container App a **system-assigned Managed Identity**.
4. Grant that identity `Key Vault Secrets User` role on the vault.
5. Reference secrets from app config:
   ```
   DATABASE_URL = @Microsoft.KeyVault(SecretUri=https://kv-wkg-prod.vault.azure.net/secrets/database-url/)
   ```
   App Service / Container Apps resolve these at startup.

For Azure Blob, **prefer Managed Identity over connection strings**. The `azure-client.ts` factory accepts `AZURE_STORAGE_ACCOUNT_URL` + `@azure/identity`'s `DefaultAzureCredential` for exactly this — set the URL, don't set the connection string, and the Managed Identity is picked up automatically.

## 7. Better Auth URL stability

Same constraint as on Vercel preview deploys (already in repo `CLAUDE.md`): `BETTER_AUTH_URL` must equal the actual request origin or Better Auth rejects auth API calls with `403 Invalid origin`.

On Azure:

- Bind a **custom domain** to the Container App (or App Service). Set `BETTER_AUTH_URL` to that domain.
- If you use a `*.azurecontainerapps.io` host directly, the hostname is stable per app (it doesn't change per revision) — also fine. Verify with one redeploy before relying on it.
- **Do not** set `BETTER_AUTH_URL` to a per-revision URL. Container Apps revisions get distinct prefixes; you'll repeat the Vercel mistake.
- Behind Front Door / API Management? Set `BETTER_AUTH_URL` to the *public* hostname your browser sees. The app must trust the `X-Forwarded-Proto` / `X-Forwarded-Host` headers (Next.js does by default in standalone mode; verify if you change `next.config.ts`).

Cookies: Better Auth sets `secure` + `SameSite=Lax`. Custom domain over HTTPS — fine. If you cross subdomains (e.g. portal vs main app), see Better Auth docs for `cookieDomain`.

## 8. Observability

There's no `instrumentation.ts` in the repo today. To wire Application Insights, add:

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
      },
    });
  }
}
```

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` from Key Vault. You get auto-instrumented HTTP / pg / fetch out of the box.

Console logs are picked up by Container Apps' built-in log stream → Log Analytics workspace. No code change needed for that part.

## 9. Networking & DNS

- Custom domain → Front Door (preferred for prod) or App Service custom domain + free managed cert.
- WAF: enable Front Door WAF Premium with the OWASP managed ruleset. The app already sets the security headers (`X-Frame-Options`, etc.) — Front Door doesn't override.
- **Egress IP for Monday / Google Maps API allowlists**: Container Apps doesn't pin egress IPs by default. If Monday or Google ever require allowlisting, attach the Container App environment to a VNet with a NAT Gateway and use the NAT's public IP.

## 10. Backups & DR

| Asset | Backup strategy |
|---|---|
| Postgres | Flexible Server PITR (7 days prod, 1 day non-prod). Test restore quarterly. |
| Azure Blob (sales CSVs) | Soft delete + versioning enabled at container level. The source-of-truth is upstream POS systems anyway. |
| Object storage (contract docs) | Same — soft delete + versioning if you've moved to Azure Blob. S3 versioning if still there. |
| Application code | GitHub. |
| Secrets | Key Vault soft-delete + purge protection. |

**Before any prod cutover**, do a full restore drill: spin up an empty Flexible Server, restore the latest PITR, run `npx drizzle-kit migrate` (no-op), boot the app against it, sign in. Time the whole thing — that's your RTO.

## 11. Migration from current Vercel + Neon

Order of operations that minimises downtime:

1. **Provision Azure infra** (Postgres, Container Apps env, Key Vault, Storage). No DNS cutover yet.
2. **Schema-clone Neon → Azure**: take a `pg_dump --schema-only` of Neon, run on Azure. Run `drizzle-kit migrate` to confirm parity (should be a no-op).
3. **Deploy app to Container Apps** pointed at the empty Azure DB. Smoke test sign-in (it will fail — no users yet). Confirm `/api/auth/...` returns 401, not 500. Confirm `/api/etl/azure/run` returns 503 (`ETL_AZURE_ENABLED` off).
4. **Pause writes on Vercel**: put the app into maintenance mode (set a feature flag / take traffic off). The single source of state is Postgres.
5. **`pg_dump --data-only` from Neon → Azure**. Use `--no-owner --no-acl` to avoid Neon-specific role grants. Time this in a dry run; full prod is small (megabytes today).
6. **Update Better Auth `trustedOrigins`** to the new domain. Smoke-test sign-in and password reset.
7. **DNS cutover** to Azure Front Door / Container App. Lower TTL 24h ahead.
8. **Enable cron** (`ETL_AZURE_ENABLED=true`) and watch one run. The advisory lock will protect against double-runs if the old Vercel cron is somehow still firing.
9. **Decommission Vercel** project after a cooling-off period (1–2 weeks of stable Azure operation).

## 12. Things that will surprise you

- **`channel_binding=require` on the Neon URL is Neon-specific.** Don't copy-paste it onto an Azure URL — you'll get `unsupported authentication method`.
- **PgBouncer transaction mode silently breaks advisory locks.** Use *session* mode or bypass it for the ETL connection (point the ETL CLI at the direct port, not the pooler).
- **`drizzle-kit` rewrites `sslmode=require → verify-full` only for migrations.** Your runtime URL is whatever you set. If you set `sslmode=require` for the app, libpq accepts the cert without verifying the chain — fine for a private VNet, weak otherwise. Use `verify-full` everywhere for prod.
- **`@neondatabase/serverless` and `ws` stay in the bundle even when unused.** The auto-detect imports both at module load. Don't strip them in some misguided dead-code-elimination pass — `index.ts` still references them.
- **Container Apps replicas don't share memory.** Anything you cached in-process (e.g. `weather_cache` if it had an in-memory layer) is per-replica. The current app doesn't rely on shared in-memory state, but be aware before adding any.
- **Azure Postgres `max_connections` is fixed per SKU.** Bumping replicas without bumping SKU will starve you. Use PgBouncer (session mode) before scaling out.
- **`@azure/identity` `DefaultAzureCredential` falls back through ~6 credential sources.** In production it should resolve to Managed Identity in <100ms. If it's slow, an earlier source (env vars, CLI) is being tried first — set `AZURE_TOKEN_CREDENTIALS=ManagedIdentityCredential` to short-circuit.
- **Standalone Next.js output omits files Next picks up at runtime via `require.resolve`.** Anything dynamically imported from `node_modules` outside the call graph won't be in `.next/standalone`. The repo doesn't do this today; if you add a plugin that does, ship its dir manually in the Dockerfile.

## 13. Cost sanity check (rough, prod)

| Component | SKU | Monthly (USD, approximate, varies by region) |
|---|---|---|
| Container Apps env | Consumption | $30–80 (depends on requests) |
| Postgres Flexible Server | B2ms zone-redundant | $90–120 |
| Storage (Blob) | LRS, 50 GB | $1–2 |
| Key Vault | Standard | <$1 |
| App Insights / Log Analytics | Pay-per-GB | $10–30 |
| Front Door + WAF | Standard | $35 + $1/M req |
| **Total** | | **~$170–270/mo** |

Not apples-to-apples with Vercel + Neon (which has different bundling), but in the same order of magnitude.

## 14. What you do not need to change in the codebase

To make the lift, you should be able to ship Azure with **zero src/ changes** (apart from the optional `instrumentation.ts` for App Insights). Specifically:

- `src/db/index.ts` — auto-detects, already correct.
- `src/lib/auth.ts` — provider-agnostic.
- `src/app/api/etl/azure/run/route.ts` — token fallback already wired.
- `src/lib/sales/azure-*` — already Azure-native.
- All Server Actions — Azure-agnostic by definition.

If you find yourself reaching into application code to "make it work on Azure", stop — it's almost certainly an infra knob you haven't turned. Re-read the relevant section above.
