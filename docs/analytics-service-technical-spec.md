# Command Centre — Analytics Service Technical Specification

> Source codebase: `wkg-command-centre` (Next.js/TypeScript/Drizzle ORM on Neon PostgreSQL)
> Target: Java Spring Boot microservice + PostgreSQL + Redis + Kafka
> Consumed by: `kato` api-gateway controllers
> Written: 2026-05-25

---

## Document Scope

This document is the single reference for implementing the **Command Centre** as a standalone Java Spring Boot microservice. It covers three layers:

- **Part A — Data Ingestion Pipeline**: The Azure ETL batch pipeline that reads sales CSV files from Azure Blob Storage, validates and transforms them, resolves dimensional FK references, applies FX normalisation, and commits the result into `sales_records`. Commission ledger entries are calculated immediately after each commit.
- **Part B — gRPC Service Interface**: The six gRPC services (40 RPCs) the microservice exposes, consumed by the `kato` api-gateway to serve analytics routes.
- **Part C — REST API Layer**: The 39 HTTP endpoints the api-gateway exposes to the frontend, each mapping 1:1 to a gRPC RPC.

---

## Table of Contents

**Part A — Data Ingestion Pipeline**
- [A1. System Overview](#a1-system-overview)
- [A2. High-Level Pipeline Flow](#a2-high-level-pipeline-flow)
- [A3. Concurrency Control](#a3-concurrency-control)
- [A4. Environment Variables](#a4-environment-variables)
- [A5. Azure Blob Storage Layout](#a5-azure-blob-storage-layout)
- [A6. CSV Format and Parsing](#a6-csv-format-and-parsing)
- [A7. Dimension Resolution](#a7-dimension-resolution)
- [A8. Staging Phase](#a8-staging-phase)
- [A9. FX Rate System](#a9-fx-rate-system)
- [A10. Reversal Matching](#a10-reversal-matching)
- [A11. Commit Phase](#a11-commit-phase)
- [A12. Idempotency](#a12-idempotency)
- [A13. Commission Calculation](#a13-commission-calculation)
- [A14. Email Alerts](#a14-email-alerts)
- [A15. Audit Trail](#a15-audit-trail)
- [A16. Import Abandonment](#a16-import-abandonment)
- [A17. Fee Code Fallback Propagation](#a17-fee-code-fallback-propagation)
- [A18. ETL System Actor](#a18-etl-system-actor)
- [A19. Complete Database Schema](#a19-complete-database-schema)
- [A20. Spring Boot Architecture](#a20-spring-boot-architecture)
- [A21. Data Flow Summary Diagram](#a21-data-flow-summary-diagram)
- [A22. Non-Obvious Gotchas](#a22-non-obvious-gotchas)

**Part B — gRPC Service Interface**
- [B1. Design Principles](#b1-design-principles)
- [B2. Common Types](#b2-common-types-commonproto)
- [B3. Service: AnalyticsService](#b3-service-analyticsservice)
- [B4. Service: CommissionService](#b4-service-commissionservice)
- [B5. Service: FlagsService](#b5-service-flagsservice)
- [B6. Service: ExportService](#b6-service-exportservice)
- [B7. Service: DimensionService](#b7-service-dimensionservice)
- [B8. Service: EtlService](#b8-service-etlservice)
- [B9. Complete Service Inventory](#b9-complete-service-inventory)
- [B10. gRPC Metadata Contract](#b10-grpc-metadata-contract-auth)
- [B11. Key Implementation Notes](#b11-key-implementation-notes-for-spring-boot)

**Part C — REST API Layer**
- [C1. Common Query Parameters](#c1-common-query-parameters)
- [C2. Auth](#c2-auth)
- [C3. Portfolio endpoints](#c3-portfolio-endpoints)
- [C4. Heat Map endpoint](#c4-heat-map-endpoint)
- [C5. Trend Builder endpoint](#c5-trend-builder-endpoint)
- [C6. Hotel Groups endpoints](#c6-hotel-groups-endpoints)
- [C7. Regions endpoints](#c7-regions-endpoints)
- [C8. Location Groups endpoints](#c8-location-groups-endpoints)
- [C9. Compare endpoint](#c9-compare-endpoint)
- [C10. Experiments endpoint](#c10-experiments-endpoint)
- [C11. Maturity Analysis endpoints](#c11-maturity-analysis-endpoints)
- [C12. Pivot Table endpoint](#c12-pivot-table-endpoint)
- [C13. Commission endpoints](#c13-commission-endpoints)
- [C14. Flags and Action Items endpoints](#c14-flags-and-action-items-endpoints)
- [C15. Export endpoints](#c15-export-endpoints)
- [C16. Dimension endpoints](#c16-dimension-filter-loader-endpoints)
- [C17. ETL admin endpoints](#c17-etl-admin-endpoints)
- [C18. Complete endpoint inventory](#c18-complete-endpoint-inventory)

---

# Part A — Data Ingestion Pipeline

---

## A1. System Overview

The Azure ETL is a **daily batch pipeline** that reads sales transaction CSV files from Azure Blob Storage, validates and transforms them, resolves dimensional FK references, applies FX normalisation, and commits the result into a PostgreSQL fact table (`sales_records`). Commission ledger entries are calculated immediately after each commit.

### Trigger

| Mode | Detail |
|---|---|
| Vercel Cron | `POST /api/etl/azure/run` at `0 4 * * *` UTC (04:00 UTC daily) |
| Manual HTTP | Same endpoint with `x-etl-token: <ETL_SHARED_SECRET>` header |
| CLI script | `npm run etl:azure` — runs `scripts/run-azure-etl.ts` with its own `node-postgres` Pool |
| Feature flag | `ETL_AZURE_ENABLED=true` env var must be set; HTTP endpoint returns 503 otherwise (CLI bypasses this check) |

### CLI exit codes (`npm run etl:azure`)

| Code | Meaning |
|---|---|
| 0 | All blobs succeeded |
| 1 | At least one blob failed, or a fatal error occurred |
| 2 | Skipped — advisory lock already held by another run |

### Run outcome codes

| HTTP | Meaning |
|---|---|
| 200 | All blobs succeeded |
| 207 | Partial — at least one blob failed but others committed |
| 401 | Auth failed (bad/missing token) |
| 409 | Another run is already in progress (advisory lock held) |
| 503 | Feature flag disabled |

---

## A2. High-Level Pipeline Flow

```
Cron / HTTP POST
       │
       ▼
[Auth check + feature flag]
       │
       ▼
[getFxAlertRecipient()]  ──► throws if FX_ALERT_TO unset (run aborts before lock)
       │ resolved
       ▼
[pg_try_advisory_lock(738294105)]  ──► skipped-lock (409)
       │ acquired
       ▼
[Load regions WHERE azure_code IS NOT NULL]
[Load product_code_fallbacks]
       │
       ▼ (for each region)
[List blobs under {container}/{azureCode}/ via Azure SDK]
       │
       ▼ (for each .csv blob matching path pattern)
[Check sales_blob_ingestions for prior SUCCESS]  ──► skip
       │ not yet succeeded
       ▼
[AzureBlobSource.pull() → download bytes + ETag]
       │
       ▼
[_stageImportForActor()]
  ├─ Duplicate check: sales_imports.source_hash
  ├─ parseSalesCsv() — field mapping + validation
  ├─ resolveDimensions() — location / product / provider FK lookup
  └─ INSERT sales_imports + import_stagings (batched 1000/chunk)
       │
       ▼
[FX stale-rate pre-check on distinct (currency, date) pairs]
  └─ if staleDays > 7 → emit fx_rate_stale event → FAIL blob
       │ all pairs OK
       ▼
[_commitImportForActor()]
  ├─ Reversal matching (in-batch + cross-batch)
  ├─ FX stamp per chunk: getRateForDate() → net_amount_gbp
  └─ INSERT sales_records (ordered: originals before reversals, 1000/chunk)
       │
       ▼
[INSERT/UPDATE sales_blob_ingestions → status='success']
       │
       ▼
[writeAuditLog: entityType=sales_import, action=commit, newValue=committedRows]
       │
       ▼ (best-effort, non-blocking)
[calculateCommissionsForRecords(committedIds)]
       │
       ▼ (best-effort, non-blocking)
[PRUNE import_stagings older than 1 day where status is terminal]

[pg_advisory_unlock(738294105)]
```

> **Note on failure path:** if the commit transaction throws, `sales_imports.status` is set to `'failed'` and the blob is recorded in `sales_blob_ingestions` with `status='failed'`. The blob will be retried on the next run (the failed ingestion row is updated via `onConflictDoUpdate`).

---

## A3. Concurrency Control

### PostgreSQL Advisory Lock

- **Lock key:** `738_294_105` (integer constant)
- **Function:** `pg_try_advisory_lock` — non-blocking; returns immediately with false if held
- **Scope:** session-scoped; auto-released if the connection drops (no leak risk)
- **Purpose:** Only one ETL run active per database at a time — prevents cron overlap and manual kick-off races

**Spring Boot equivalent:** Use a `ShedLock` table (or Redis `SET NX PX`) to replicate this. If using PostgreSQL advisory locks directly, use `DataSourceUtils.getConnection()` to get a persistent connection and call `pg_try_advisory_lock` via JDBC, then release in a `finally` block.

---

## A4. Environment Variables

| Variable | Purpose |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Dev / local: connection string auth (takes priority) |
| `AZURE_STORAGE_ACCOUNT_URL` | Prod: account URL + DefaultAzureCredential chain |
| `AZURE_BLOB_CONTAINER` | Container name (default: `clientdata`) |
| `ETL_AZURE_ENABLED` | Feature flag — must be `"true"` to run |
| `ETL_SHARED_SECRET` | Shared secret for manual HTTP trigger |
| `FX_ALERT_TO` | Email recipient for FX stale/failed alerts — **required at run-start, before advisory lock**; ETL aborts with an error if unset |
| `DATABASE_URL` | PostgreSQL connection string |
| `RESEND_API_KEY` | API key for the Resend email delivery service (used by the notification handler) |
| `EMAIL_FROM` | Sender address (default: `noreply@command.weknowgroup.com`) |
| `EMAIL_REPLY_TO` | Optional reply-to header on outbound emails |

---

## A5. Azure Blob Storage Layout

### Path pattern

```
{container}/{azureCode}/{YYYY}/{MM}/{DD}/{filename}.csv
```

- `azureCode` — per-region config (`regions.azure_code` in DB); e.g. `GB` for UK
- Path regex enforced: `^([^/]+)/(\d{4})/(\d{2})/(\d{2})/[^/]+\.csv$`
- Only `.csv` files are processed; other files are silently skipped

### Blob client auth priority

1. `AZURE_STORAGE_CONNECTION_STRING` → `BlobServiceClient.fromConnectionString` (dev/Azurite)
2. `AZURE_STORAGE_ACCOUNT_URL` → `DefaultAzureCredential` (managed identity / env / CLI chain)

### What is pulled per blob

- Full byte buffer (downloaded to memory)
- ETag (stored in `sales_blob_ingestions.etag` for audit)
- `sourceHash` = SHA-256 of raw bytes (duplicate-upload guard on `sales_imports.source_hash`)

---

## A6. CSV Format and Parsing

### Column mapping (header → field)

The parser normalises header names: lowercase, strip underscores/spaces.

| CSV Header | Internal Field | Type | Required |
|---|---|---|---|
| `SaleRef` | `saleRef` | string | yes |
| `RefNo` | `refNo` | string | yes |
| `Code` | `netsuiteCode` | string | yes (or fallback map) |
| `ProductName` | `productName` | string | yes |
| `CategoryCode` | `categoryCode` | string | no |
| `CategoryName` | `categoryName` | string | no |
| `Agent` | `agent` | string | no |
| `OutletCode` | `outletCode` | string | yes |
| `OutletName` | `outletName` | string | no |
| `Date` | `transactionDate` | ISO date | yes |
| `Time` | `transactionTime` | HH:MM[:SS] | no |
| `CustomerCode` | `customerCode` | string | no |
| `CustomerName` | `customerName` | string | no |
| `SuppNam` | `providerName` | string | no |
| `ApiProductName` | `apiProductName` | string | no |
| `City` | `city` | string | no |
| `Country` | `country` | string | no |
| `BusinessDivision` | `businessDivision` | string | no |
| `VATRate` | `vatRate` | decimal | no |
| `NetAmt` | `netAmount` | signed decimal | yes |
| `VATAmt` | `vatAmount` | signed decimal | yes |
| `Currency` | `currency` | ISO 4217 | no (default: GBP) |

### Date formats accepted

- ISO: `YYYY-MM-DD`
- BoE short: `DD-Mon-YY` (e.g. `08-May-26` → `2026-05-08`)

### NetSuite code fallback

If the CSV `Code` column is empty/NULL, the parser looks up `productName` in the `product_code_fallbacks` table (loaded once per ETL run). If no fallback exists, the row is marked invalid.

### Special flags derived at parse time

- `isWeknowFee`: `netsuiteCode === "9991"` (Booking Fee) OR `"9992"` (Cash Handling Fee)
- `isReversal`: `netAmount.startsWith("-")` — refund rows have negative net amounts

### Validation rules (row-level)

A row is **invalid** if any of:
- `saleRef`, `refNo`, `outletCode`, or `productName` is empty/NULL
- `netsuiteCode` is empty AND no fallback exists for `productName`
- `transactionDate` is absent or unparseable
- `netAmount` or `vatAmount` is absent or non-numeric
- Dimension resolution fails (unknown outlet code, no sentinel fallback)

Invalid rows are stored in `import_stagings` with `status='invalid'` and a `validation_errors` JSONB array. **If any row is invalid, the entire blob fails** (all-or-nothing per design).

---

## A7. Dimension Resolution

Resolves raw CSV identifiers to database FK IDs. All lookups are batched (single query per lookup type per blob). Scoped to a single `regionId`.

### Location resolution (3-pass)

**Pass 0 — customer_code (highest priority):**
- If row has non-empty `customerCode`, look up `locations WHERE customer_code = ? AND primary_region_id = ?`
- This is the canonical hotel-level RPS account identifier

**Pass 1 — kiosk outlet_code (fallback):**
- For rows not resolved by Pass 0, look up:
  ```sql
  SELECT kiosks.outlet_code, kiosk_assignments.location_id
  FROM kiosks
  JOIN kiosk_assignments ON kiosk_assignments.kiosk_id = kiosks.id
  JOIN locations ON locations.id = kiosk_assignments.location_id
  WHERE kiosks.outlet_code IN (...)
    AND kiosk_assignments.unassigned_at IS NULL
    AND locations.primary_region_id = ?
  ```
- Only the first active assignment per outlet code is used

**Pass 2 — sentinel fallback (optional):**
- If still unresolved and `sentinelLocationId` is configured, route to that location
- Production Azure ETL does NOT use a sentinel — unresolved outlet codes fail the row

### Product resolution (3-pass)

**Pass 1:** Match by `products.netsuite_code` (unique, region-agnostic)

**Pass 2:** Match by `products.name WHERE netsuite_code IS NULL`, then back-fill the netsuite_code and any null category columns on the product row (UPDATE in-place)

**Pass 3:** Auto-create the product row if still not found. New product gets `name`, `netsuite_code`, `category_code`, `category_name` from the CSV row.

### Provider resolution

- Look up `providers.name` (exact match, case-sensitive)
- Auto-create missing providers
- Provider is nullable — rows with no `providerName` in CSV get `provider_id = NULL`

> **Concurrency note:** Dimension resolution is NOT safe for concurrent parallel runs. The advisory lock at the ETL level serialises this. Without it, two parallel blobs can race on product auto-create and hit `duplicate key` on `products.netsuite_code`.

---

## A8. Staging Phase

After parsing + dimension resolution:

1. A `sales_imports` row is inserted with `status='staging'`
   - `source_hash` is UNIQUE — duplicate bytes are rejected before parsing
   - `region_id` is set from the region being processed
2. All rows (valid AND invalid) are inserted into `import_stagings` in 1000-row chunks
   - Valid rows: `status='valid'`, `parsed_row` JSONB contains `{parsed: {...}, resolution: {locationId, productId, providerId}}`
   - Invalid rows: `status='invalid'`, `validation_errors` JSONB array

### Staging schema

```sql
CREATE TABLE import_stagings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_row jsonb NOT NULL,
  parsed_row jsonb,                 -- null if invalid
  status text NOT NULL DEFAULT 'pending', -- pending|valid|invalid|committed
  validation_errors jsonb
);
```

---

## A9. FX Rate System

### BoE Daily Fetch (separate cron)

Runs at **06:00 Europe/London** daily (before the 04:00 UTC ETL slot — the cron is Inngest-driven, not Vercel cron).

**Endpoint:**
```
https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp
  ?CodeVer=new&csv.x=yes&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N
  &Datefrom={d/Mon/yyyy}&Dateto={d/Mon/yyyy}
  &SeriesCodes=XUDLUSS,XUDLERS,...
```

**Wide-form CSV** (one column per currency) → parsed to `(currency, rate_date, rate_to_gbp)` rows.

**Upsert:** `INSERT INTO exchange_rates ... ON CONFLICT (currency, rate_date) DO NOTHING`

**Empty response** (BoE non-publish day: Sat/Sun/UK bank holiday) = success with `upserted=0`. Carry-forward handles the gap at ETL time.

### Supported currencies and BoE series codes

| Series | Currency |
|---|---|
| XUDLUSS | USD |
| XUDLERS | EUR |
| XUDLJYS | JPY |
| XUDLADS | AUD |
| XUDLCDS | CAD |
| XUDLSFS | CHF |
| XUDLNDS | NZD |
| XUDLNKS | NOK |
| XUDLSKS | SEK |
| XUDLDKS | DKK |
| XUDLHDS | HKD |
| XUDLSGS | SGD |
| XUDLZRS | ZAR |
| XUDLSRS | SAR |
| XUDLTWS | TWD |
| *(identity)* | GBP |

**Not supported (no verified GBP-spot series):** CNY, INR, KRW, MXN, BRL, TRY, AED, ILS, PLN, HUF, THB, RUB. Blobs containing these currencies fail with a hard error.

### Exchange rates schema

```sql
CREATE TABLE exchange_rates (
  currency text NOT NULL,
  rate_date date NOT NULL,
  rate_to_gbp numeric(18, 10) NOT NULL,  -- units: foreign currency per 1 GBP
  source text NOT NULL DEFAULT 'boe',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);
```

> **Rate direction:** `rate_to_gbp` is **foreign currency units per 1 GBP** (BoE convention). To convert a native amount to GBP: `net_amount_gbp = net_amount / rate_to_gbp`.

### Rate lookup logic (`getRateForDate`)

```
if currency == 'GBP':
  return { rate: 1.0, staleDays: 0 }  -- no DB query

SELECT * FROM exchange_rates
WHERE currency = ? AND rate_date <= ?   -- carry-forward
ORDER BY rate_date DESC LIMIT 1

if no row:
  return null  -- caller hard-fails

staleDays = days(isoDate - row.rate_date)  -- pure string arithmetic

return { rate, rateDate, staleDays }
```

### Staleness rules

- `staleDays > 7` → ETL hard-fails the blob
- Before committing, ETL does a **pre-check** on all distinct `(currency, date)` pairs from staged rows
- If stale pair found: emit `fx_rate_stale` email alert via Inngest → fail the blob
- Inside the commit transaction: per-chunk rate check repeats this (double-gate)

The pre-check reads from `import_stagings` JSONB using this SQL path:

```sql
SELECT DISTINCT
  parsed_row->'parsed'->>'currency'        AS currency,
  parsed_row->'parsed'->>'transactionDate' AS "transactionDate"
FROM import_stagings
WHERE import_id = ?
  AND status = 'valid'
  AND parsed_row IS NOT NULL
```

This navigates the `StoredStagedRow` shape: `{ parsed: ParsedSalesRow, resolution: {...} }`. The pre-check and the commit-phase check serve **different purposes**: the pre-check identifies the first stale pair to name it in the operator alert email; the commit-phase per-chunk check is the actual enforcement gate. Both must be implemented.

### GBP conversion formula

```java
// For non-GBP rows:
BigDecimal netAmountGbp = netAmount.divide(rateToGbp, 2, RoundingMode.HALF_UP);

// For GBP rows:
BigDecimal netAmountGbp = netAmount;  // exact, no rounding
```

---

## A10. Reversal Matching

Refund rows (`netAmount < 0`) are matched to their originals at commit time.

### Matching rule

A refund matches an original when:
- Same `refNo`
- Original `netAmount > 0`
- Cross-batch: `|refund_amount| <= |original_amount|` (partial refunds allowed)
- In-batch: `|refund_amount| == |original_amount|` (exact match only)
- Tiebreaker: most recent `transactionDate`; if tied, lower `id` (lexicographic) wins

### Two-phase matching

**Phase 1 — In-batch matching (pure in-memory):**
- Index originals by `(refNo, magnitude)`
- For each refund, find the most-recent unconsumed original with same key
- Result: `matches[]` + `unmatchedRefunds[]`

**Phase 2 — Cross-batch matching (DB query):**
- For unmatched refunds, query:
  ```sql
  SELECT id, ref_no, net_amount, transaction_date, location_id
  FROM sales_records
  WHERE region_id = ?
    AND ref_no IN (...)
    AND net_amount > 0
  ```
- Apply same most-recent/lower-id tiebreaker
- Orphaned refunds (no match found) are committed with `original_record_id = NULL`

### Effect of a match

| Column | Value |
|---|---|
| `location_id` | Rewritten to original's `location_id` (cancellation attributed to booking outlet) |
| `processed_at_location_id` | CSV-supplied `location_id` (where the refund was processed) |
| `original_record_id` | FK to the original `sales_records.id` |
| `is_partial_reversal` | `true` if `|refund| < |original|` |

### FK ordering in commit

Sales records are inserted in two waves within each chunk:
1. Non-reversals (originals) first
2. Reversals second

This is required because `original_record_id` is an IMMEDIATE (non-deferrable) self-referential FK. Without this ordering, a reversal in chunk N would reference an original not yet inserted, causing a FK violation.

---

## A11. Commit Phase

### Pre-commit guards

1. Import must be in `status='staging'`
2. Zero invalid rows (any `import_stagings.status = 'invalid'` aborts commit)
3. FX pre-check passed (stale-rate gate)

### Transaction structure

```
BEGIN TRANSACTION
  for each 1000-row chunk (originals first, then reversals):
    1. Validate currencies against BOE_SUPPORTED_CURRENCIES
    2. Batch getRateForDate() for distinct (currency, date) pairs in chunk
    3. Hard-fail on null rate or staleDays > 7
    4. INSERT INTO sales_records (1000 rows)
  UPDATE import_stagings SET status='committed' WHERE import_id=? AND status='valid'
  UPDATE sales_imports SET status='committed'
COMMIT
```

### sales_records columns populated at commit

| Column | Source |
|---|---|
| `id` | Pre-assigned UUID (randomUUID before transaction) |
| `import_id` | From `sales_imports.id` |
| `region_id` | From `sales_imports.region_id` |
| `sale_ref` | CSV `SaleRef` |
| `ref_no` | CSV `RefNo` |
| `transaction_date` | Parsed CSV date |
| `transaction_time` | Parsed CSV time (nullable) |
| `location_id` | From dimension resolver (or original's location for matched refunds) |
| `product_id` | From dimension resolver |
| `provider_id` | From dimension resolver (nullable) |
| `net_amount` | CSV `NetAmt` (native currency, NUMERIC 12,2) |
| `net_amount_gbp` | `net_amount / rate_to_gbp` (GBP normalised, NUMERIC 12,2) |
| `vat_amount` | CSV `VATAmt` |
| `vat_rate` | CSV `VATRate` (nullable) |
| `currency` | CSV `Currency` (default: GBP) |
| `is_weknow_fee` | `netsuite_code IN ('9991','9992')` |
| `netsuite_code` | From CSV or fallback map |
| `agent` | CSV `Agent` (nullable) |
| `business_division` | CSV `BusinessDivision` (nullable) |
| `category_code` | CSV `CategoryCode` (nullable) |
| `category_name` | CSV `CategoryName` (nullable) |
| `api_product_name` | CSV `ApiProductName` (nullable) |
| `city` | CSV `City` (nullable) |
| `country` | CSV `Country` (nullable) |
| `customer_code` | CSV `CustomerCode` (nullable) |
| `customer_name` | CSV `CustomerName` (nullable) |
| `is_reversal` | Detected at parse time (`net_amount < 0`) |
| `is_partial_reversal` | From reversal matcher |
| `original_record_id` | From reversal matcher (nullable) |
| `processed_at_location_id` | From reversal matcher (nullable) |

---

## A12. Idempotency

### Blob-level idempotency (`sales_blob_ingestions`)

```sql
CREATE TABLE sales_blob_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id),
  blob_path text NOT NULL,
  blob_date date NOT NULL,
  etag text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  import_id uuid REFERENCES sales_imports(id) ON DELETE SET NULL,
  status text NOT NULL,           -- 'success' | 'failed'
  error_message text,
  UNIQUE (region_id, blob_path)   -- idempotency key
);
```

- On success: `INSERT ... ON CONFLICT DO UPDATE SET status='success'`
- On failure: `INSERT ... ON CONFLICT DO UPDATE SET status='failed', error_message=?`
- Skip condition: `SELECT 1 FROM sales_blob_ingestions WHERE region_id=? AND blob_path=? AND status='success'`
- Failed blobs are **re-tried** on the next run (upsert replaces the failed row)

### File-level idempotency (`sales_imports.source_hash`)

- SHA-256 of raw CSV bytes
- UNIQUE constraint — duplicate upload of identical bytes fails at the DB layer with a clear message

---

## A13. Commission Calculation (Post-Commit)

Triggered immediately after each blob commits, best-effort (non-blocking — failure does not roll back the import).

### Eligibility

Only rows matching ALL of:
- `is_weknow_fee = true`
- `netsuite_code = '9991'` (Booking Fee only — not Cash Handling Fee 9992)
- A `location_products` row exists for `(location_id, product_id)` with configured `commission_tiers`

### Eligibility — skip conditions

Records are **silently skipped** (not an error) when:
- `is_weknow_fee = false` OR `netsuite_code != '9991'` (principal rows, Cash Handling Fee 9992)
- No `location_products` row exists for the `(location_id, product_id)` pair
- The matching `location_products` row has empty `commission_tiers` JSONB
- No tier version is effective on the transaction date (all versions have `effectiveFrom > transactionDate`)

### Waterfall tier model

Tiers are versioned (`commission_tiers` JSONB on `location_products`):
```json
[
  {
    "effectiveFrom": "2026-01-01",
    "tiers": [
      { "minRevenue": 0, "maxRevenue": 10000, "rate": 0.10 },
      { "minRevenue": 10000, "maxRevenue": null, "rate": 0.15 }
    ]
  }
]
```

**Active version selection:** filter to versions where `effectiveFrom <= transactionDate`, then take the one with the latest `effectiveFrom`.

**Waterfall algorithm** (per transaction, after version selection):

```
sort tiers by minRevenue ascending
cursor = cumulativeBeforeThis   // GBP revenue already processed this month
remaining = netAmountGbp        // this transaction's value

for each tier:
  if remaining <= 0: break
  if cursor >= tier.maxRevenue: continue    // cursor already past this tier

  effectiveStart = max(cursor, tier.minRevenue)
  spaceInTier    = tier.maxRevenue - effectiveStart  // Infinity if maxRevenue is null
  revenueInTier  = min(remaining, spaceInTier)

  if revenueInTier <= 0: continue

  commission = round(revenueInTier * tier.rate * 100) / 100   // 2dp rounding
  remaining -= revenueInTier
  cursor     = effectiveStart + revenueInTier

commissionableAmount = netAmountGbp   // bookingFee param is reserved, currently ignored
```

The `commissionableAmount` stored in the ledger equals `netAmountGbp` — the booking fee parameter in the engine signature is reserved for future use and currently set to `0` by all callers.

Commission calculation uses a **cumulative cursor** per `(location_id, product_id, YYYY-MM)` — seeded from `SUM(net_amount_gbp)` of already-committed fee records in that month (excluding the current batch), then records in the batch are processed in ascending `transactionDate` order.

All amounts are GBP-normalised (`net_amount_gbp`). Tier brackets are GBP-denominated.

### Chunked sales record fetches

Sales records are fetched in **10,000-row chunks** (`ID_CHUNK = 10_000`) to stay under PostgreSQL's 65,535 bind-parameter ceiling. The `NOT (id = ANY(?::uuid[]))` exclude-this-batch clause uses a single array bind, not per-element params.

### Commission ledger schema

```sql
CREATE TABLE commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_record_id uuid NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
  location_product_id uuid REFERENCES location_products(id) ON DELETE SET NULL,
  gross_amount_gbp numeric(12, 2) NOT NULL,
  commissionable_amount numeric(12, 2) NOT NULL,
  commission_amount numeric(12, 2) NOT NULL,
  tier_breakdown jsonb NOT NULL,
  tier_version_effective_from text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  is_reversal boolean NOT NULL DEFAULT false
);
```

### Recalculation (on tier config change)

`recalculateCommissions(locationProductId, month)`:
1. Find all existing non-reversal ledger entries for the month
2. Insert reversal rows (negated `commission_amount`, `is_reversal=true`) — atomically
3. Re-run `calculateCommissionsForRecords` for all fee records in the month

---

## A14. Email Alerts

The ETL sends email alerts via an **Inngest event** (`email/send.requested`). The `send-email` Inngest function handles this event and delivers the email via **Resend** (HTTP API, not SMTP). The function has `retries: 5` with Inngest's exponential backoff.

### Alert types relevant to ETL

| `kind` | Trigger | Subject |
|---|---|---|
| `fx_rate_stale` | `staleDays > 7` for any `(currency, date)` in a blob | `Sales ETL halted: stale FX rate for {currency}` |
| `fx_rate_fetch_failed` | BoE HTTP/parse error in daily cron | `FX rates daily fetch failed ({isoDate})` |

Both use `template: "plain-text"` — they bypass React email templates entirely and render as `<pre>` HTML + plain text.

### Event payload shape

```typescript
{
  name: "email/send.requested",
  data: {
    kind: "fx_rate_stale",
    to: string,              // from FX_ALERT_TO env var (resolved before advisory lock)
    subject: string,
    template: "plain-text",
    templateProps: {
      currency: string,
      transactionDate: string,
      staleDays: number | null,
      blobPath: string,
      importId: string,
    },
    payloadHash: string,     // deduplication key: "fx_rate_stale:{currency}:{date}:{blobPath}"
  }
}
```

### Email deduplication — `email_log` table

After each successful send, a row is inserted into `email_log`:

```sql
CREATE TABLE email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  recipient text NOT NULL,
  resend_message_id text,
  inngest_run_id text,
  status text NOT NULL,          -- 'sent' | 'failed'
  last_error text,
  payload_hash text,
  -- Partial unique index (migration 0041):
  -- UNIQUE (kind, payload_hash) WHERE payload_hash IS NOT NULL
);
```

`onConflictDoNothing` on `(kind, payload_hash) WHERE payload_hash IS NOT NULL` prevents duplicate sends across Inngest retries. `payloadHash` format: `fx_rate_stale:{currency}:{transactionDate}:{blobPath}` and `fx_rate_fetch_failed:{isoDate}:{runId}`.

---

## A15. Audit Trail

Every blob processed writes two `audit_logs` entries via `writeAuditLog`:

| Phase | `entity_type` | `action` | `new_value` |
|---|---|---|---|
| Stage | `sales_import` | `stage` | `"{validCount}/{totalRows} valid"` |
| Commit | `sales_import` | `commit` | `"{committedRows}"` |

Both entries use `actor_id = "00000000-0000-0000-0000-000000000001"` and `actor_name = "Azure ETL"`.

The BoE daily cron writes a separate audit entry per run:

| Field | Value |
|---|---|
| `entity_type` | `fx_rate_fetch_run` |
| `action` | `trigger` |
| `actor_id` | `system` |
| `actor_name` | `fx-rates-fetch-daily cron` |
| `entity_name` | `Run {isoDate}` |

This gives operators a queryable run history in `audit_logs` — the cron has no other persistent timeline.

---

## A16. Import Abandonment

`_cancelImportForActor` abandons a staged import without committing:

1. Deletes all `import_stagings` rows for the import
2. Sets `sales_imports.status = 'failed'`
3. Writes an `audit_logs` entry with `action = 'cancel'`

**Critically: the `sales_imports` row itself is NOT deleted.** Its `source_hash` is retained, so re-uploading identical bytes is permanently blocked (same error as a duplicate import). To retry after a cancellation the operator must modify the file so its SHA-256 changes.

---

## A17. Fee Code Fallback Propagation

`updateFeeCodeFallback(db, actor, productName, newCode)` atomically propagates a `product_code_fallbacks` edit in a single transaction:

1. Update `product_code_fallbacks.netsuite_code` for the given `product_name`
2. Update `products.netsuite_code` where `name = productName AND netsuite_code = oldCode`
   - If 0 rows updated AND a product with that name exists with a different code → **throw drift error** (manual reconciliation required before update is allowed)
3. Update ALL `sales_records.netsuite_code = newCode WHERE netsuite_code = oldCode` — no `product_id` filter, because the unique constraint on `products.netsuite_code` means one code maps to at most one product; filtering by `product_id` would miss historical rows whose `product_id` drifted from the code's current owner
4. Write a single `audit_logs` entry with `metadata: { updatedProducts, updatedSalesRecords }`

**In Spring Boot:** this must remain in one transaction. The sales_records UPDATE could affect millions of rows on a long-running instance — consider running it as a background job with progress tracking rather than a synchronous HTTP response.

---

## A18. ETL System Actor

A fixed synthetic user represents the ETL pipeline for audit logging:

```
id:   "00000000-0000-0000-0000-000000000001"
name: "Azure ETL"
```

This UUID is seeded by migration `0018`. A matching row must exist in the `user` table (not just referenced in audit logs) because `sales_imports.uploaded_by` is a FK to `user.id`. When recreating the schema, seed this row in Flyway before any ETL run.

---

## A19. Complete Database Schema (ETL-relevant tables)

### `regions`

```sql
CREATE TABLE regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,        -- e.g. 'UK', 'IE', 'DE'
  azure_code text UNIQUE,           -- blob path prefix e.g. 'GB'; NULL = skip in ETL
  market_id uuid REFERENCES markets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES "user"(id)
);
```

### `product_code_fallbacks`

```sql
CREATE TABLE product_code_fallbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL UNIQUE,
  netsuite_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `locations` (key columns for ETL)

```sql
  customer_code text,              -- RPS hotel account code (Pass 0 lookup)
  primary_region_id uuid NOT NULL REFERENCES regions(id),
  -- partial unique index: (primary_region_id, customer_code) WHERE customer_code IS NOT NULL
```

### `kiosks` (key columns for ETL)

```sql
  outlet_code text,                -- Pass 1 location lookup key
```

### `kiosk_assignments`

```sql
CREATE TABLE kiosk_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id uuid NOT NULL REFERENCES kiosks(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,       -- NULL = currently active
  ...
);
```

### `products`

```sql
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  netsuite_code text UNIQUE,
  category_code text,
  category_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `providers`

```sql
CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `sales_imports`

```sql
CREATE TABLE sales_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  source_hash text NOT NULL UNIQUE,
  uploaded_by text NOT NULL REFERENCES "user"(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  date_range_start date,
  date_range_end date,
  status text NOT NULL DEFAULT 'staging',  -- staging|committed|failed|rolled_back
  errors jsonb,
  region_id uuid REFERENCES regions(id)
);
```

### `import_stagings`

```sql
CREATE TABLE import_stagings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_row jsonb NOT NULL,
  parsed_row jsonb,                -- {parsed: {...}, resolution: {locationId, productId, providerId}}
  status text NOT NULL DEFAULT 'pending',  -- pending|valid|invalid|committed
  validation_errors jsonb,
  INDEX (import_id)
);
```

### `sales_records`

```sql
CREATE TABLE sales_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES sales_imports(id) ON DELETE SET NULL,
  region_id uuid NOT NULL REFERENCES regions(id),
  sale_ref text NOT NULL,
  ref_no text NOT NULL,
  transaction_date date NOT NULL,
  transaction_time time,
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  provider_id uuid REFERENCES providers(id),
  net_amount numeric(12, 2) NOT NULL,
  net_amount_gbp numeric(12, 2),            -- FX-normalised
  vat_amount numeric(12, 2) NOT NULL,
  vat_rate numeric(5, 2),
  currency text NOT NULL DEFAULT 'GBP',
  is_weknow_fee boolean NOT NULL DEFAULT false,
  netsuite_code text NOT NULL,
  agent text,
  business_division text,
  category_code text,
  category_name text,
  api_product_name text,
  city text,
  country text,
  customer_code text,
  customer_name text,
  is_reversal boolean NOT NULL DEFAULT false,
  is_partial_reversal boolean NOT NULL DEFAULT false,
  original_record_id uuid REFERENCES sales_records(id) ON DELETE SET NULL,
  processed_at_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Indexes:
  INDEX (region_id, transaction_date),
  INDEX (region_id, ref_no),
  INDEX (region_id, sale_ref),
  INDEX (location_id, transaction_date),
  INDEX (product_id, transaction_date),
  INDEX (provider_id, transaction_date),
  INDEX (transaction_date),
  INDEX (is_reversal),
  INDEX (original_record_id)
);
```

### `sales_blob_ingestions`

```sql
CREATE TABLE sales_blob_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id),
  blob_path text NOT NULL,
  blob_date date NOT NULL,
  etag text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  import_id uuid REFERENCES sales_imports(id) ON DELETE SET NULL,
  status text NOT NULL,            -- 'success' | 'failed'
  error_message text,
  UNIQUE (region_id, blob_path),
  INDEX (region_id, blob_date)
);
```

### `exchange_rates`

```sql
CREATE TABLE exchange_rates (
  currency text NOT NULL,
  rate_date date NOT NULL,
  rate_to_gbp numeric(18, 10) NOT NULL,   -- foreign units per 1 GBP
  source text NOT NULL DEFAULT 'boe',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);
```

---

## A20. Spring Boot Architecture Recommendation

### Module breakdown

```
com.wkg.etl
├── config/
│   ├── AzureStorageConfig.java        -- BlobServiceClient bean
│   ├── EtlProperties.java             -- @ConfigurationProperties
│   └── SchedulerConfig.java           -- Quartz / ShedLock config
├── domain/
│   ├── model/                         -- JPA entities matching schema above
│   ├── repository/                    -- Spring Data JPA repositories
│   └── enums/                         -- ImportStatus, BlobIngestionStatus, etc.
├── etl/
│   ├── orchestrator/
│   │   └── AzureEtlOrchestrator.java  -- main run loop (replaces runAzureEtl)
│   ├── source/
│   │   └── AzureBlobSource.java       -- download blob + hash
│   ├── parser/
│   │   └── SalesCsvParser.java        -- field mapping + validation (OpenCSV/SuperCSV)
│   ├── resolver/
│   │   └── DimensionResolver.java     -- location/product/provider FK resolution
│   ├── pipeline/
│   │   ├── StagingService.java        -- stage phase
│   │   └── CommitService.java         -- commit phase (FX stamp + reversal + insert)
│   ├── reversal/
│   │   └── ReversalMatcher.java       -- in-batch + cross-batch matching
│   └── lock/
│       └── AdvisoryLockService.java   -- pg_try_advisory_lock wrapper
├── fx/
│   ├── BoeRateFetcher.java            -- HTTP fetch + CSV parse
│   ├── ExchangeRateService.java       -- upsert + getRateForDate
│   └── FxRatesDailyCron.java          -- Quartz/Spring @Scheduled cron
├── commission/
│   ├── CommissionProcessor.java       -- calculateCommissionsForRecords
│   └── CommissionEngine.java          -- waterfall tier math
└── notification/
    ├── AlertService.java              -- email alerts via Resend HTTP API
    └── EmailLogRepository.java        -- email_log deduplication (partial unique on kind+payload_hash)
```

### Where Redis fits

| Use case | Notes |
|---|---|
| **Distributed advisory lock** | Use `SET NX PX` as an alternative to Postgres advisory lock — safer across multiple pods. Key: `etl:azure:lock`, TTL: 6 minutes |
| **Rate cache** | Cache `exchange_rates` lookups in Redis with key `fx:rate:{currency}:{date}`, TTL 25 hours. Eliminates per-row DB queries during commits |
| **Idempotency cache** | Cache `sales_blob_ingestions` success status: key `etl:blob:done:{region_id}:{blob_path}`, TTL 30 days — avoids DB round-trip per blob for skip check |
| **Commission calc lock** | `SET NX` per `{location_id}:{product_id}:{yyyymm}` during recalculation to prevent concurrent recalcs |
| **Analytics query cache** | Key `analytics:{sha256(userId+role+scopes+filterJson)}`, TTL 5 minutes. Invalidate all keys on ETL commit |

### Where Kafka fits

| Use case | Notes |
|---|---|
| **Blob processing fanout** | After listing blobs, publish one message per blob to topic `etl.blob.pending`. Consumer group processes blobs concurrently (careful: dimension resolver needs serialisation — use partition key = `region_id`) |
| **Commission trigger** | After a blob commits, publish `etl.blob.committed` with `importId` and `recordIds`. Commission processor consumes this topic asynchronously instead of blocking the commit path |
| **FX rate events** | BoE cron publishes `fx.rates.fetched` with the upserted rates. ETL consumers can refresh their Redis rate cache on this event |
| **Alert events** | Replace Inngest's `email/send.requested` with a Kafka topic `notifications.email.requested`. A dedicated notification service consumes and dispatches |
| **Dead letter** | Failed blobs after max retries → `etl.blob.dlq` for operator review |

### Key implementation notes for Spring Boot

1. **Advisory lock:** Use `EntityManager.createNativeQuery("SELECT pg_try_advisory_lock(?)")` on a **connection-pinned** `@Transactional(propagation=REQUIRES_NEW)` method. Release in `finally`. Alternatively use Redis-based ShedLock.

2. **Chunk inserts:** Use `JdbcTemplate.batchUpdate()` in 1000-row batches for `import_stagings` and `sales_records`. Avoid JPA `save()` — it issues per-row INSERTs.

3. **FX conversion precision:** Use `BigDecimal` with `HALF_EVEN` rounding, scale 2 for `net_amount_gbp`. `rate_to_gbp` has scale 10 — do not cast to `double`.

4. **Reversal FK ordering:** Sort records into two lists (non-reversals, then reversals) before batch insert. The `original_record_id` FK is IMMEDIATE — no `SET CONSTRAINTS DEFERRED` available.

5. **Source hash:** SHA-256 of raw bytes as hex string. Java: `MessageDigest.getInstance("SHA-256")`.

6. **ETL actor UUID:** Hard-code `"00000000-0000-0000-0000-000000000001"` in `EtlProperties`. Seed it in Flyway migration if not already present.

7. **Staging prune:** After every commit, delete `import_stagings` rows for terminal imports older than 1 day. Run as a `@Scheduled` nightly job rather than inline with each commit.

8. **Currency validation:** Maintain `BOE_SUPPORTED_CURRENCIES` as an `EnumSet` or `Set<String>`. Hard-fail if a CSV row's currency is not in the set.

9. **BoE date format:** `buildBoeCsvUrl` uses `d/Mon/yyyy` format (e.g. `8/May/2026`). The BoE IADB endpoint is `www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp`.

10. **Partial blob failure:** Use a per-blob try/catch. Write `FAILED` status to `sales_blob_ingestions` and continue to the next blob. Collect all failures and return a 207 if any failed.

---

## A21. Data Flow Summary Diagram

```
Azure Blob Storage
  └─ {container}/{azureCode}/YYYY/MM/DD/*.csv
        │  (Azure SDK listBlobsFlat)
        ▼
[AzureEtlOrchestrator]
  └─ per region (azure_code IS NOT NULL)
       └─ per blob
            ├─ [Redis] check done-cache or DB skip check
            ├─ BlobServiceClient.downloadToBuffer() → bytes + ETag
            ├─ SHA-256(bytes) → source_hash [duplicate guard]
            │
            ├─ SalesCsvParser.parse(bytes)
            │     └─ returns List<ParsedRow> (valid + invalid)
            │
            ├─ DimensionResolver.resolve(rows, regionId)
            │     ├─ Pass 0: locations.customer_code lookup
            │     ├─ Pass 1: kiosks → kiosk_assignments → locations
            │     └─ products: code → name → auto-create
            │         providers: name → auto-create
            │
            ├─ INSERT sales_imports (status=staging)
            ├─ BATCH INSERT import_stagings (1000/chunk)
            │
            ├─ [FX Pre-check] getRateForDate per (currency, date)
            │     └─ staleDays > 7 → Kafka/alert → fail blob
            │
            ├─ [Reversal Matching]
            │     ├─ in-batch: pure memory
            │     └─ cross-batch: DB query sales_records
            │
            ├─ BEGIN TRANSACTION
            │     for each 1000-row chunk (originals first):
            │       └─ BATCH INSERT sales_records (with net_amount_gbp)
            │     UPDATE import_stagings status=committed
            │     UPDATE sales_imports status=committed
            │   COMMIT
            │
            ├─ UPSERT sales_blob_ingestions (status=success)
            ├─ [Redis] set done-cache key
            │
            └─ [Kafka] publish etl.blob.committed
                  └─ [CommissionConsumer]
                        └─ calculateCommissionsForRecords()
                              └─ INSERT commission_ledger

[FxRatesDailyCron] (06:00 Europe/London)
  └─ fetchBoeRatesForDate(today)
  └─ UPSERT exchange_rates ON CONFLICT DO NOTHING
  └─ [Kafka] publish fx.rates.fetched
        └─ [CacheRefreshConsumer] warm Redis rate cache
```

---

## A22. Non-Obvious Gotchas

| # | Gotcha | Detail |
|---|---|---|
| 1 | `rate_to_gbp` direction | Foreign units per 1 GBP. Division converts to GBP, not multiplication. |
| 2 | GBP short-circuit | GBP rows must bypass the DB entirely — no rate lookup, `net_amount_gbp = net_amount`. |
| 3 | Advisory lock scope | Must use the same DB connection for lock + work + unlock. Connection pool must pin connection for the lock duration. |
| 4 | Reversal FK ordering | Originals before reversals in the same bulk insert batch. IMMEDIATE constraint means row ordering matters within a transaction. |
| 5 | 65,535 bind param limit | PostgreSQL limits params to 65,535. Use `= ANY(?::uuid[])` for large IN lists, not individual bind params. |
| 6 | Staging prune timing | Only prune `import_stagings` for terminal imports (`committed/failed/rolled_back`) older than 1 day — not in-flight imports. |
| 7 | Commission is GBP-denominated | Tier brackets are in GBP. The cumulative cursor is summed from `net_amount_gbp`, not `net_amount`. Feeding a EUR amount against a GBP cursor miscalculates tier boundaries. |
| 8 | BoE non-publish days | Sat/Sun/UK bank holidays return empty CSV (`parseBoeCsv` returns `[]`). This is NOT a failure — carry-forward handles gaps. |
| 9 | Dead BoE series | Many `XUDLBK*` series are ERIs (indices), not spot rates. Only the verified `XUDL*S` codes listed above are safe. |
| 10 | Stale-rate pre-check | The pre-check on staging JSONB runs before the commit transaction. It exists to send a named-currency alert; the commit-phase check is the actual enforcement gate. Both are needed. |
| 11 | Orphan refunds | Unmatched refunds are valid and committed. `original_record_id = NULL` with `is_reversal = true` is a queryable pattern in analytics. |
| 12 | `source_hash` deduplication | Same bytes = rejected even if the prior import failed OR was cancelled. `_cancelImportForActor` deletes staging rows but keeps the `sales_imports` row (and its `source_hash`). The operator must modify the file to retry. |
| 13 | `FX_ALERT_TO` is pre-lock | `getFxAlertRecipient()` is called before `withAdvisoryLock`. An unset env var aborts the entire run before the lock is acquired. It must be configured in all environments where the ETL runs, including CI/staging. |
| 14 | `commissionableAmount == grossAmount` | The commission engine signature has a `bookingFee` parameter but it is currently ignored (`_bookingFee` prefix, value `0`). The ledger's `commissionable_amount` equals `net_amount_gbp` for all current records. |
| 15 | Email provider is Resend | The notification system uses the Resend API (HTTP), not SMTP/SES/JavaMailSender. The `email_log.payload_hash` partial unique index deduplicates across Inngest retries — implement the same dedup logic in Spring Boot to avoid alert spam on retry. |
| 16 | Audit log uses text `entity_id` | `audit_logs.entity_id` is `text`, not `uuid`, because Better Auth user IDs are 32-char random strings (not UUIDs). Do not declare it as `UUID` type in JPA — it will reject auth-related audit rows. |

---

# Part B — gRPC Service Interface

---

## B1. Design Principles

- **One RPC per distinct server action** in the Next.js UI — the api-gateway controller maps each HTTP handler 1:1 to a gRPC call; no fan-out at the gateway layer.
- **`AnalyticsFilter` is shared** across all analytics RPCs — defined once in `common.proto` and imported.
- **Pagination** on list/pivot endpoints uses cursor-based `page_token` + `page_size`, not offset.
- **Streaming** is used only for export (CSV/Excel bytes) — all other RPCs are unary.
- **User identity and RBAC** are passed via gRPC metadata (request header), not in the proto message body. The service applies `scopedSalesCondition` based on the caller's role/scopes.
- **All monetary values are GBP**, `numeric(12,2)` encoded as string to avoid float precision loss.
- **`currency_key`** on responses is `null` (empty string) when the cohort has mixed currencies; the gateway/frontend uses it to switch display labels.

---

## B2. Common Types (`common.proto`)

```protobuf
syntax = "proto3";
package wkg.commandcentre.v1;

import "google/protobuf/wrappers.proto";

// ── Shared analytics filter ────────────────────────────────────────────────────

enum MetricMode {
  METRIC_MODE_SALES   = 0;   // all non-fee, non-reversal transactions
  METRIC_MODE_REVENUE = 1;   // WKG booking-fee rows only (is_weknow_fee=true)
}

message AnalyticsFilter {
  string date_from                    = 1;  // YYYY-MM-DD (required)
  string date_to                      = 2;  // YYYY-MM-DD (required)
  repeated string hotel_ids           = 3;  // location UUIDs
  repeated string region_ids          = 4;
  repeated string product_ids         = 5;
  repeated string hotel_group_ids     = 6;
  repeated string location_group_ids  = 7;
  repeated string maturity_buckets    = 8;  // "0-1mo","1-3mo","3-6mo","6-9mo","9-12mo","12mo+"
  repeated string location_types      = 9;  // "hotel","retail_desk","online","airport","hex_kiosk","internal"
  MetricMode metric_mode              = 10;
  bool include_internal_accounts      = 11; // default false
}

// ── Shared metric snapshot ─────────────────────────────────────────────────────

message Metrics {
  string revenue        = 1;  // GBP, numeric string e.g. "12345.67"
  int64  transactions   = 2;
  string avg_basket_gbp = 3;  // GBP, numeric string
  string currency_key   = 4;  // ISO code if single-currency cohort, empty = multi-currency
}

message MetricsWithComparison {
  Metrics current  = 1;
  Metrics previous = 2;  // populated when comparison period requested
  double  revenue_change_pct      = 3;
  double  transactions_change_pct = 4;
}

// ── Pagination ─────────────────────────────────────────────────────────────────

message PageRequest {
  int32  page_size  = 1;  // default 50, max 500
  string page_token = 2;  // opaque cursor from previous response
}

message PageInfo {
  string next_page_token = 1;  // empty = last page
  int32  total_count     = 2;  // total rows before pagination (for UI)
}

// ── Period comparison presets ──────────────────────────────────────────────────

enum ComparisonPeriod {
  COMPARISON_PERIOD_NONE          = 0;
  COMPARISON_PERIOD_PREVIOUS_MOM  = 1;  // same length, immediately prior
  COMPARISON_PERIOD_PREVIOUS_YOY  = 2;  // same calendar window, prior year
}
```

---

## B3. Service: `AnalyticsService`

Covers all 13 analytics route data shapes.

```protobuf
service AnalyticsService {

  // ── Portfolio ─────────────────────────────────────────────────────────────

  // Summary KPIs: total revenue, transactions, avg basket, previous period
  rpc GetPortfolioSummary (PortfolioSummaryRequest)
      returns (PortfolioSummaryResponse);

  // Revenue / transaction breakdown by product category
  rpc GetPortfolioCategories (PortfolioRequest)
      returns (PortfolioCategoriesResponse);

  // Top products ranked by revenue
  rpc GetPortfolioProducts (PortfolioRequest)
      returns (PortfolioProductsResponse);

  // Daily or hourly time-series for the portfolio
  rpc GetPortfolioTrend (PortfolioTrendRequest)
      returns (PortfolioTrendResponse);

  // Outlet tier classification (revenue buckets)
  rpc GetPortfolioOutletTiers (PortfolioRequest)
      returns (PortfolioOutletTiersResponse);

  // High-performer pattern analysis (region distribution, product mix)
  rpc GetHighPerformerAnalysis (PortfolioRequest)
      returns (HighPerformerAnalysisResponse);

  // ── Heat Map ─────────────────────────────────────────────────────────────

  // All locations ranked by composite score with property enrichment
  rpc GetHeatMap (HeatMapRequest)
      returns (HeatMapResponse);

  // ── Trend Builder ─────────────────────────────────────────────────────────

  // Multi-series time-series (revenue, transactions, avg basket, booking fee)
  // with optional YoY comparison series and business-event overlays
  rpc GetTrendSeries (TrendSeriesRequest)
      returns (TrendSeriesResponse);

  // ── Hotel Groups ─────────────────────────────────────────────────────────

  rpc ListHotelGroups (ListHotelGroupsRequest)
      returns (ListHotelGroupsResponse);

  rpc GetHotelGroupDetail (HotelGroupDetailRequest)
      returns (HotelGroupDetailResponse);

  // ── Regions ───────────────────────────────────────────────────────────────

  rpc ListRegions (ListRegionsRequest)
      returns (ListRegionsResponse);

  rpc GetRegionDetail (RegionDetailRequest)
      returns (RegionDetailResponse);

  // ── Location Groups ───────────────────────────────────────────────────────

  rpc ListLocationGroups (ListLocationGroupsRequest)
      returns (ListLocationGroupsResponse);

  rpc GetLocationGroupDetail (LocationGroupDetailRequest)
      returns (LocationGroupDetailResponse);

  // ── Compare ───────────────────────────────────────────────────────────────

  // Side-by-side metrics for a set of entity IDs of the same dimension type
  rpc GetComparison (ComparisonRequest)
      returns (ComparisonResponse);

  // ── Experiments ───────────────────────────────────────────────────────────

  rpc GetExperimentMetrics (ExperimentRequest)
      returns (ExperimentResponse);

  // ── Maturity Analysis ─────────────────────────────────────────────────────

  rpc GetMaturityBuckets (MaturityRequest)
      returns (MaturityBucketsResponse);

  rpc GetMaturityRampCurve (MaturityRequest)
      returns (MaturityRampCurveResponse);

  rpc GetInstallCohorts (MaturityRequest)
      returns (InstallCohortsResponse);

  // ── Pivot Table ───────────────────────────────────────────────────────────

  rpc GetPivotTable (PivotTableRequest)
      returns (PivotTableResponse);
}
```

### B3.1 Portfolio messages

```protobuf
message PortfolioRequest {
  AnalyticsFilter filter = 1;
}

message PortfolioSummaryRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
}

message PortfolioSummaryResponse {
  MetricsWithComparison metrics         = 1;
  string                date_range_from = 2;
  string                date_range_to   = 3;
}

message CategoryRow {
  string  category_code  = 1;
  string  category_name  = 2;
  string  revenue_gbp    = 3;
  int64   transactions   = 4;
  double  revenue_share  = 5;  // 0.0–1.0
}

message PortfolioCategoriesResponse {
  repeated CategoryRow rows = 1;
}

message ProductRow {
  string product_id     = 1;
  string product_name   = 2;
  string netsuite_code  = 3;
  string revenue_gbp    = 4;
  int64  transactions   = 5;
  double revenue_share  = 6;
}

message PortfolioProductsResponse {
  repeated ProductRow rows       = 1;
  int32               total_count = 2;
}

enum TrendGranularity {
  TREND_GRANULARITY_DAILY   = 0;
  TREND_GRANULARITY_HOURLY  = 1;
  TREND_GRANULARITY_WEEKLY  = 2;
  TREND_GRANULARITY_MONTHLY = 3;
}

message PortfolioTrendRequest {
  AnalyticsFilter  filter      = 1;
  TrendGranularity granularity = 2;
}

message TrendPoint {
  string bucket       = 1;  // "2026-05-01" (daily/weekly/monthly) or "14" (hourly = hour of day)
  string revenue_gbp  = 2;
  int64  transactions = 3;
  string avg_basket   = 4;
}

message PortfolioTrendResponse {
  repeated TrendPoint points = 1;
}

message OutletTierRow {
  string tier_label    = 1;  // e.g. "Top 10%", "£0–£1k"
  int32  outlet_count  = 2;
  string revenue_gbp   = 3;
  double revenue_share = 4;
}

message PortfolioOutletTiersResponse {
  repeated OutletTierRow tiers     = 1;
  int32                  truncated = 2;  // rows omitted by cap (max 200)
  int32                  total     = 3;
}

message HighPerformerAnalysisResponse {
  repeated RegionDistributionRow region_distribution = 1;
  repeated ProductMixRow         product_mix         = 2;
}

message RegionDistributionRow {
  string region_id    = 1;
  string region_name  = 2;
  int32  hotel_count  = 3;
  double revenue_share = 4;
}

message ProductMixRow {
  string product_id    = 1;
  string product_name  = 2;
  double revenue_share = 3;
}
```

### B3.2 Heat Map messages

```protobuf
message HeatMapRequest {
  AnalyticsFilter filter    = 1;
  HeatMapWeights  weights   = 2;  // optional — omit to use defaults
  HeatMapScope    scope     = 3;
}

enum HeatMapScope {
  HEAT_MAP_SCOPE_ALL      = 0;
  HEAT_MAP_SCOPE_TOP10    = 1;
  HEAT_MAP_SCOPE_BOTTOM10 = 2;
}

message HeatMapWeights {
  double revenue         = 1;  // default 0.30
  double transactions    = 2;  // default 0.20
  double rev_per_room    = 3;  // default 0.25
  double txn_per_kiosk   = 4;  // default 0.15
  double avg_basket      = 5;  // default 0.10
  // weights must sum to 1.0
}

message HeatMapRow {
  int32  rank               = 1;
  string location_id        = 2;
  string location_name      = 3;
  string outlet_code        = 4;
  string hotel_group_name   = 5;
  string revenue_gbp        = 6;
  int64  transactions       = 7;
  string rev_per_room_gbp   = 8;  // empty if room_count unknown
  string txn_per_kiosk      = 9;
  string avg_basket_gbp     = 10;
  double composite_score    = 11;
  double percentile         = 12;  // 0.0–100.0
  int32  kiosk_count        = 13;
  int32  room_count         = 14;
}

message HeatMapResponse {
  repeated HeatMapRow rows = 1;
  int32 total_locations    = 2;
}
```

### B3.3 Trend Builder messages

```protobuf
enum TrendMetric {
  TREND_METRIC_REVENUE       = 0;
  TREND_METRIC_TRANSACTIONS  = 1;
  TREND_METRIC_AVG_BASKET    = 2;
  TREND_METRIC_BOOKING_FEE   = 3;
}

message TrendSeries {
  string                name        = 1;  // user-supplied series label
  TrendMetric           metric      = 2;
  AnalyticsFilter       filter      = 3;  // per-series filter (can narrow dates, hotels, etc.)
  bool                  include_yoy = 4;  // append a YoY comparison series
}

message TrendSeriesRequest {
  repeated TrendSeries  series                  = 1;
  TrendGranularity      granularity             = 2;
  bool                  include_business_events = 3;
  repeated string       event_category_ids      = 4;  // filter overlaid events
}

message TrendDataPoint {
  string bucket        = 1;  // ISO date or hour-of-day integer
  string value         = 2;  // revenue as GBP string, or transaction count
}

message TrendSeriesResult {
  string                    series_name = 1;
  TrendMetric               metric      = 2;
  repeated TrendDataPoint   points      = 3;
  bool                      is_yoy      = 4;
}

message BusinessEventOverlay {
  string event_id       = 1;
  string title          = 2;
  string event_date     = 3;
  string category_name  = 4;
  string category_color = 5;
}

message TrendSeriesResponse {
  repeated TrendSeriesResult    series  = 1;
  repeated BusinessEventOverlay events  = 2;
}
```

### B3.4 Hotel Groups messages

```protobuf
message ListHotelGroupsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
  PageRequest      page              = 3;
}

message HotelGroupSummaryRow {
  string                id              = 1;
  string                name            = 2;
  int32                 hotel_count     = 3;
  MetricsWithComparison metrics         = 4;
}

message ListHotelGroupsResponse {
  repeated HotelGroupSummaryRow rows     = 1;
  PageInfo                      page_info = 2;
}

message HotelGroupDetailRequest {
  string          hotel_group_id = 1;
  AnalyticsFilter filter         = 2;
}

message HotelGroupDetailResponse {
  string              id                = 1;
  string              name              = 2;
  Metrics             metrics           = 3;
  repeated HotelRow   hotels            = 4;
  repeated TrendPoint trend             = 5;  // daily for the filter window
}

message HotelRow {
  string location_id   = 1;
  string location_name = 2;
  Metrics metrics      = 3;
  int32  room_count    = 4;
  int32  kiosk_count   = 5;
}
```

### B3.5 Regions messages

```protobuf
message ListRegionsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
}

message RegionSummaryRow {
  string                id                   = 1;
  string                name                 = 2;
  string                code                 = 3;
  int32                 hotel_count          = 4;
  int32                 hotel_group_count    = 5;
  int32                 location_group_count = 6;
  MetricsWithComparison metrics              = 7;
}

message ListRegionsResponse {
  repeated RegionSummaryRow rows = 1;
}

message RegionDetailRequest {
  string          region_id = 1;
  AnalyticsFilter filter    = 2;
}

message RegionDetailResponse {
  string              id              = 1;
  string              name            = 2;
  Metrics             metrics         = 3;
  repeated HotelRow   hotels          = 4;
  repeated LocationGroupBreakdownRow location_groups = 5;
}

message LocationGroupBreakdownRow {
  string  location_group_id   = 1;
  string  location_group_name = 2;
  int32   hotel_count         = 3;
  Metrics metrics             = 4;
}
```

### B3.6 Location Groups messages

```protobuf
message ListLocationGroupsRequest {
  AnalyticsFilter  filter            = 1;
  ComparisonPeriod comparison_period = 2;
  PageRequest      page              = 3;
}

message LocationGroupSummaryRow {
  string                id               = 1;
  string                name             = 2;
  int32                 hotel_count      = 3;
  int32                 total_rooms      = 4;
  MetricsWithComparison metrics          = 5;
  string                rev_per_room_gbp = 6;
  string                txn_per_kiosk    = 7;
}

message ListLocationGroupsResponse {
  repeated LocationGroupSummaryRow rows     = 1;
  PageInfo                         page_info = 2;
}

message LocationGroupDetailRequest {
  string          location_group_id = 1;
  AnalyticsFilter filter            = 2;
}

message LocationGroupDetailResponse {
  string              id               = 1;
  string              name             = 2;
  Metrics             metrics          = 3;
  string              rev_per_room_gbp = 4;
  string              txn_per_kiosk    = 5;
  repeated HotelRow   hotels           = 6;
  repeated HotelRow   peer_hotels      = 7;  // hotels in same region outside this group
}
```

### B3.7 Compare messages

```protobuf
enum CompareDimension {
  COMPARE_DIMENSION_LOCATION       = 0;
  COMPARE_DIMENSION_HOTEL_GROUP    = 1;
  COMPARE_DIMENSION_REGION         = 2;
  COMPARE_DIMENSION_LOCATION_GROUP = 3;
  COMPARE_DIMENSION_PRODUCT        = 4;
}

message ComparisonRequest {
  repeated string  entity_ids = 1;  // 2–N entity UUIDs of the same dimension type
  CompareDimension dimension  = 2;
  AnalyticsFilter  filter     = 3;
}

message ComparisonEntityResult {
  string              entity_id   = 1;
  string              entity_name = 2;
  Metrics             metrics     = 3;
  repeated TrendPoint trend       = 4;  // daily for filter window
}

message ComparisonResponse {
  repeated ComparisonEntityResult entities = 1;
}
```

### B3.8 Experiments messages

```protobuf
message ExperimentRequest {
  string          experiment_cohort_id = 1;
  AnalyticsFilter filter               = 2;
  bool            include_yoy          = 3;
}

message ExperimentPhaseMetrics {
  string phase_label   = 1;  // "Pre-intervention", "During intervention"
  string date_from     = 2;
  string date_to       = 3;
  Metrics cohort       = 4;
  Metrics control      = 5;
  Metrics delta        = 6;  // cohort - control
}

message ExperimentResponse {
  string                          cohort_name    = 1;
  int32                           cohort_size    = 2;
  repeated ExperimentPhaseMetrics phases         = 3;
  repeated TrendPoint             cohort_trend   = 4;
  repeated TrendPoint             control_trend  = 5;
}
```

### B3.9 Maturity Analysis messages

```protobuf
message MaturityRequest {
  AnalyticsFilter filter = 1;
}

message MaturityBucketRow {
  string  bucket_label      = 1;  // "0-1mo", "1-3mo", etc.
  int32   location_count    = 2;
  string  avg_revenue_gbp   = 3;
  string  total_revenue_gbp = 4;
}

message MaturityBucketsResponse {
  repeated MaturityBucketRow buckets = 1;
}

message RampPoint {
  int32  months_since_install = 1;
  string avg_revenue_gbp      = 2;
  int32  location_count       = 3;
}

message MaturityRampCurveResponse {
  repeated RampPoint points = 1;
}

message InstallCohortRow {
  string install_month       = 1;  // "YYYY-MM"
  int32  location_count      = 2;
  string avg_monthly_rev_gbp = 3;
}

message InstallCohortsResponse {
  repeated InstallCohortRow cohorts = 1;
}
```

### B3.10 Pivot Table messages

```protobuf
enum PivotField {
  PIVOT_FIELD_LOCATION       = 0;
  PIVOT_FIELD_HOTEL_GROUP    = 1;
  PIVOT_FIELD_REGION         = 2;
  PIVOT_FIELD_PRODUCT        = 3;
  PIVOT_FIELD_LOCATION_GROUP = 4;
  PIVOT_FIELD_PROVIDER       = 5;
  PIVOT_FIELD_DATE_MONTH     = 6;
  PIVOT_FIELD_DATE_WEEK      = 7;
}

enum PivotAggregation {
  PIVOT_AGG_SUM   = 0;
  PIVOT_AGG_AVG   = 1;
  PIVOT_AGG_COUNT = 2;
  PIVOT_AGG_MIN   = 3;
  PIVOT_AGG_MAX   = 4;
}

enum PivotValueMetric {
  PIVOT_VALUE_REVENUE      = 0;
  PIVOT_VALUE_TRANSACTIONS = 1;
  PIVOT_VALUE_AVG_BASKET   = 2;
}

message PivotTableRequest {
  AnalyticsFilter  filter        = 1;
  PivotField       row_field     = 2;
  PivotField       column_field  = 3;
  PivotValueMetric value_metric  = 4;
  PivotAggregation aggregation   = 5;
  PageRequest      page          = 6;  // paginates rows, not columns
}

message PivotCell {
  string column_id    = 1;
  string column_label = 2;
  string value        = 3;  // numeric string
}

message PivotRow {
  string             row_id    = 1;
  string             row_label = 2;
  repeated PivotCell cells     = 3;
  string             row_total = 4;
}

message PivotTableResponse {
  repeated string   column_labels  = 1;
  repeated PivotRow rows           = 2;
  repeated string   column_totals  = 3;  // indexed same as column_labels
  string            grand_total    = 4;
  PageInfo          page_info      = 5;
}
```

---

## B4. Service: `CommissionService`

```protobuf
service CommissionService {

  // Commission ledger summary grouped by location and product
  rpc GetCommissionSummary (CommissionRequest)
      returns (CommissionSummaryResponse);

  // Monthly commission totals for trend chart
  rpc GetCommissionTrend (CommissionRequest)
      returns (CommissionTrendResponse);

  // Recalculate commissions for a location-product pair + month (admin action)
  rpc RecalculateCommissions (RecalculateCommissionsRequest)
      returns (RecalculateCommissionsResponse);
}

message CommissionRequest {
  AnalyticsFilter filter = 1;
}

message CommissionRow {
  string location_id           = 1;
  string location_name         = 2;
  string product_id            = 3;
  string product_name          = 4;
  string gross_amount_gbp      = 5;
  string commissionable_amount = 6;
  string commission_amount     = 7;
  string tier_version          = 8;  // effectiveFrom of active tier
}

message CommissionSummaryResponse {
  repeated CommissionRow rows              = 1;
  string                 total_commission_gbp = 2;
}

message CommissionTrendPoint {
  string month              = 1;  // "YYYY-MM"
  string commission_gbp     = 2;
  string commissionable_gbp = 3;
}

message CommissionTrendResponse {
  repeated CommissionTrendPoint points = 1;
}

message RecalculateCommissionsRequest {
  string location_product_id = 1;  // UUID
  string month               = 2;  // "YYYY-MM"
}

message RecalculateCommissionsResponse {
  int32 reversed     = 1;
  int32 recalculated = 2;
}
```

---

## B5. Service: `FlagsService`

Covers the flags and actions-dashboard analytics routes.

```protobuf
service FlagsService {

  rpc ListFlags (ListFlagsRequest)
      returns (ListFlagsResponse);

  rpc CreateFlag (CreateFlagRequest)
      returns (Flag);

  rpc UpdateFlag (UpdateFlagRequest)
      returns (Flag);

  rpc ListActionItems (ListActionItemsRequest)
      returns (ListActionItemsResponse);

  rpc CreateActionItem (CreateActionItemRequest)
      returns (ActionItem);

  rpc UpdateActionItem (UpdateActionItemRequest)
      returns (ActionItem);
}

enum FlagType {
  FLAG_TYPE_RELOCATE            = 0;
  FLAG_TYPE_MONITOR             = 1;
  FLAG_TYPE_STRATEGIC_EXCEPTION = 2;
}

enum FlagStatus {
  FLAG_STATUS_ACTIVE   = 0;
  FLAG_STATUS_RESOLVED = 1;
}

message Flag {
  string     id                = 1;
  string     location_id       = 2;
  string     location_name     = 3;
  FlagType   type              = 4;
  FlagStatus status            = 5;
  string     reason            = 6;
  string     created_at        = 7;
  string     resolved_at       = 8;
  int32      action_item_count = 9;
}

message ListFlagsRequest {
  repeated FlagType   types        = 1;
  repeated FlagStatus statuses     = 2;
  repeated string     location_ids = 3;
  PageRequest         page         = 4;
}

message ListFlagsResponse {
  repeated Flag rows     = 1;
  PageInfo      page_info = 2;
}

message CreateFlagRequest {
  string   location_id = 1;
  FlagType type        = 2;
  string   reason      = 3;
}

message UpdateFlagRequest {
  string     flag_id = 1;
  FlagStatus status  = 2;
  string     reason  = 3;  // optional update to reason text
}

enum ActionItemType {
  ACTION_ITEM_INVESTIGATION = 0;
  ACTION_ITEM_RELOCATION    = 1;
  ACTION_ITEM_TRAINING      = 2;
  ACTION_ITEM_EQUIPMENT     = 3;
}

enum ActionItemStatus {
  ACTION_ITEM_OPEN        = 0;
  ACTION_ITEM_IN_PROGRESS = 1;
  ACTION_ITEM_RESOLVED    = 2;
  ACTION_ITEM_CANCELLED   = 3;
}

message ActionItem {
  string           id          = 1;
  string           flag_id     = 2;
  ActionItemType   type        = 3;
  ActionItemStatus status      = 4;
  string           description = 5;
  string           assignee_id = 6;
  string           due_date    = 7;  // YYYY-MM-DD
  string           created_at  = 8;
  string           updated_at  = 9;
}

message ListActionItemsRequest {
  string                   flag_id  = 1;  // optional — omit to list all
  repeated ActionItemStatus statuses = 2;
  repeated ActionItemType   types    = 3;
  PageRequest               page     = 4;
}

message ListActionItemsResponse {
  repeated ActionItem rows     = 1;
  PageInfo            page_info = 2;
}

message CreateActionItemRequest {
  string         flag_id     = 1;
  ActionItemType type        = 2;
  string         description = 3;
  string         assignee_id = 4;
  string         due_date    = 5;
}

message UpdateActionItemRequest {
  string           action_item_id = 1;
  ActionItemStatus status         = 2;
  string           description    = 3;
  string           assignee_id    = 4;
  string           due_date       = 5;
}
```

---

## B6. Service: `ExportService`

Server-streaming — the gateway forwards the byte stream to the HTTP response.

```protobuf
service ExportService {

  // Returns a stream of raw file bytes (CSV or Excel).
  // The gateway sets Content-Type and Content-Disposition from the first ExportChunk.
  rpc ExportAnalytics (ExportRequest)
      returns (stream ExportChunk);
}

enum ExportTab {
  EXPORT_TAB_PORTFOLIO       = 0;
  EXPORT_TAB_HEAT_MAP        = 1;
  EXPORT_TAB_HOTEL_GROUPS    = 2;
  EXPORT_TAB_REGIONS         = 3;
  EXPORT_TAB_LOCATION_GROUPS = 4;
}

enum ExportFormat {
  EXPORT_FORMAT_CSV   = 0;
  EXPORT_FORMAT_EXCEL = 1;
}

message ExportRequest {
  ExportTab       tab    = 1;
  AnalyticsFilter filter = 2;
  ExportFormat    format = 3;
}

message ExportChunk {
  bytes  data         = 1;   // raw file bytes (chunked at ~64KB)
  string filename     = 2;   // only set on first chunk
  string content_type = 3;   // only set on first chunk
}
```

---

## B7. Service: `DimensionService`

Populates filter dropdowns in the UI. Results are scoped to the caller's RBAC context.

```protobuf
service DimensionService {

  rpc ListLocations (DimensionListRequest)
      returns (LocationListResponse);

  rpc ListRegions (DimensionListRequest)
      returns (RegionListResponse);

  rpc ListHotelGroups (DimensionListRequest)
      returns (HotelGroupListResponse);

  rpc ListLocationGroups (DimensionListRequest)
      returns (LocationGroupListResponse);

  rpc ListProducts (DimensionListRequest)
      returns (ProductListResponse);

  rpc ListProviders (DimensionListRequest)
      returns (ProviderListResponse);
}

message DimensionListRequest {
  string search_query = 1;  // optional — filter by name prefix
  int32  limit        = 2;  // default 100, max 500
}

message LocationItem {
  string id            = 1;
  string name          = 2;
  string outlet_code   = 3;
  string location_type = 4;
  string region_id     = 5;
}

message LocationListResponse {
  repeated LocationItem items = 1;
}

message RegionItem {
  string id   = 1;
  string name = 2;
  string code = 3;
}

message RegionListResponse {
  repeated RegionItem items = 1;
}

message HotelGroupItem {
  string id   = 1;
  string name = 2;
}

message HotelGroupListResponse {
  repeated HotelGroupItem items = 1;
}

message LocationGroupItem {
  string id   = 1;
  string name = 2;
}

message LocationGroupListResponse {
  repeated LocationGroupItem items = 1;
}

message ProductItem {
  string id            = 1;
  string name          = 2;
  string netsuite_code = 3;
  string category_code = 4;
  string category_name = 5;
}

message ProductListResponse {
  repeated ProductItem items = 1;
}

message ProviderItem {
  string id   = 1;
  string name = 2;
}

message ProviderListResponse {
  repeated ProviderItem items = 1;
}
```

---

## B8. Service: `EtlService`

Exposes ETL control and observability to the gateway (admin-only operations).

```protobuf
service EtlService {

  // Manually trigger the Azure ETL run (equivalent to POST /api/etl/azure/run)
  rpc TriggerAzureEtl (TriggerEtlRequest)
      returns (TriggerEtlResponse);

  // List recent blob ingestion history
  rpc ListBlobIngestions (ListBlobIngestionsRequest)
      returns (ListBlobIngestionsResponse);

  // List recent sales imports
  rpc ListSalesImports (ListSalesImportsRequest)
      returns (ListSalesImportsResponse);
}

message TriggerEtlRequest {
  // empty — auth enforced via gRPC metadata
}

message TriggerEtlResponse {
  string           status          = 1;  // "ok" | "skipped-lock"
  repeated string  processed_blobs = 2;
  repeated string  skipped_blobs   = 3;
  repeated FailedBlob failed_blobs = 4;
}

message FailedBlob {
  string region_code = 1;
  string blob_path   = 2;
  string error       = 3;
}

message ListBlobIngestionsRequest {
  string      region_id = 1;  // optional filter
  string      status    = 2;  // "success" | "failed" | "" (all)
  PageRequest page      = 3;
}

message BlobIngestionRow {
  string id            = 1;
  string region_code   = 2;
  string blob_path     = 3;
  string blob_date     = 4;
  string status        = 5;
  string processed_at  = 6;
  string error_message = 7;
  string import_id     = 8;
}

message ListBlobIngestionsResponse {
  repeated BlobIngestionRow rows     = 1;
  PageInfo                  page_info = 2;
}

message ListSalesImportsRequest {
  string      region_id = 1;
  string      status    = 2;  // "staging" | "committed" | "failed" | "" (all)
  PageRequest page      = 3;
}

message SalesImportRow {
  string id               = 1;
  string filename         = 2;
  string status           = 3;
  string region_id        = 4;
  int32  row_count        = 5;
  string date_range_start = 6;
  string date_range_end   = 7;
  string uploaded_at      = 8;
}

message ListSalesImportsResponse {
  repeated SalesImportRow rows     = 1;
  PageInfo                page_info = 2;
}
```

---

## B9. Complete Service Inventory

| Service | RPCs | Consumed by route(s) |
|---|---|---|
| `AnalyticsService` | 21 | portfolio, heat-map, trend-builder, hotel-groups, regions, location-groups, compare, experiments, maturity, pivot |
| `CommissionService` | 3 | commission |
| `FlagsService` | 6 | flags, actions-dashboard |
| `ExportService` | 1 (streaming) | All tabs via `/api/export/csv` and `/api/export/excel` |
| `DimensionService` | 6 | Filter dropdowns on all analytics routes |
| `EtlService` | 3 | Admin panel / ops tooling |
| **Total** | **40** | |

---

## B10. gRPC Metadata Contract (Auth)

The api-gateway injects caller identity into gRPC metadata on every call. The command-centre service reads these to apply `scopedSalesCondition` (RBAC row filtering):

| Metadata Key | Type | Description |
|---|---|---|
| `x-user-id` | string | Better Auth user ID (text, not UUID) |
| `x-user-role` | string | `admin` \| `member` \| `external` |
| `x-user-scopes` | string (JSON) | Serialised `UserScope[]` — `{dimensionType, dimensionId}[]` |
| `x-request-id` | string | Trace ID for distributed logging |

---

## B11. Key Implementation Notes for Spring Boot

1. **RBAC scope enforcement:** Every analytics query must apply `scopedSalesCondition` — a WHERE clause predicate that limits `location_id` to the intersection of the user's `user_scopes` rows and the filter's explicit `hotel_ids`. Admins bypass this (no predicate). Externals always have it applied even if `hotel_ids` is empty.

2. **`unstable_cache` equivalent:** The Next.js app caches query results keyed on `{userId + userRole + userScopes + filters}`. In Spring Boot, replicate this with Redis: key `analytics:{sha256(userId+role+scopes+filterJson)}`, TTL 5 minutes. Invalidate all keys on ETL commit.

3. **Revenue vs Sales mode:** `MetricMode.SALES` → `WHERE is_weknow_fee = false AND is_reversal = false`. `MetricMode.REVENUE` → `WHERE is_weknow_fee = true` (booking fee rows only, `netsuite_code = '9991'`).

4. **`currency_key` logic:** For any aggregation, if all records in the result set share a single `currency` value, set `currency_key` to that ISO code. If mixed, set empty string. The frontend uses this to display "€12,345" instead of "£12,345 GBP".

5. **Maturity bucket calculation:** Buckets are relative to `filter.date_to`. A location is in bucket `0-1mo` if `date_to - kiosk_live_date <= 31 days`. Join `kiosks` → `kiosk_assignments` → `locations` to get `kiosks.installation_date` as the live date.

6. **Weighted average basket:** Trend builder basket value uses a split numerator/denominator pattern — accumulate `SUM(net_amount_gbp)` and `COUNT(*)` separately per bucket, then divide at the end. Do NOT average pre-computed per-row basket values (produces wrong results for mixed-volume buckets).

7. **Export streaming:** For CSV/Excel export the Spring Boot service should produce the file bytes in chunks (64 KB) and stream via server-side gRPC streaming to avoid holding large responses in memory. Excel generation should use Apache POI streaming API (`SXSSFWorkbook`).

8. **Business events for trend overlay:** `businessEvents` join `eventCategories` on `category_id`. Filter by `event_date BETWEEN date_from AND date_to` and optionally by `category_id IN (event_category_ids)`.

9. **Composite heat-map score:** `score = (revenue_norm * 0.30) + (txn_norm * 0.20) + (rev_per_room_norm * 0.25) + (txn_per_kiosk_norm * 0.15) + (basket_norm * 0.10)`. Each metric is min-max normalised across the result set: `norm = (value - min) / (max - min)`. If `room_count` is NULL, `rev_per_room` component falls back to 0 (not normalised) and the remaining weights are NOT redistributed — the score is simply lower for hotels with unknown room counts.

10. **Pivot table truncation:** Cap pivot rows at 200 (same as the Next.js query). Return `total_count` in `PageInfo` so the gateway can tell the frontend how many rows were omitted.

---

# Part C — REST API Layer

The api-gateway exposes these HTTP endpoints. Each maps 1:1 to a gRPC call in Part B. The gateway validates the session token, builds gRPC metadata, calls the service, and serialises the response to JSON.

---

## C1. Common Query Parameters

These apply to **every** analytics `GET` endpoint. The parameter names match the existing Next.js export route convention exactly.

| Query param | Type | Maps to `AnalyticsFilter` field |
|---|---|---|
| `from` | `YYYY-MM-DD` (required) | `date_from` |
| `to` | `YYYY-MM-DD` (required) | `date_to` |
| `hotelIds` | comma-separated UUIDs | `hotel_ids` |
| `regionIds` | comma-separated UUIDs | `region_ids` |
| `productIds` | comma-separated UUIDs | `product_ids` |
| `hotelGroupIds` | comma-separated UUIDs | `hotel_group_ids` |
| `locationGroupIds` | comma-separated UUIDs | `location_group_ids` |
| `maturityBuckets` | comma-separated (`0-1mo,1-3mo,3-6mo,6-9mo,9-12mo,12mo+`) | `maturity_buckets` |
| `locationTypes` | comma-separated (`hotel,retail_desk,online,airport,hex_kiosk,internal`) | `location_types` |
| `metricMode` | `sales` \| `revenue` (default `sales`) | `metric_mode` |
| `includeInternal` | `true` \| `false` (default `false`) | `include_internal_accounts` |

Additional params where noted per-endpoint:

| Query param | Type | Used by |
|---|---|---|
| `comparison` | `none` \| `mom` \| `yoy` | Summary / list endpoints |
| `granularity` | `daily` \| `weekly` \| `monthly` \| `hourly` | Trend endpoints |
| `pageSize` | integer (default 50, max 500) | Paginated list endpoints |
| `pageToken` | opaque string | Paginated list endpoints (cursor from prior response) |

---

## C2. Auth

Every request requires a valid session. The gateway accepts either:
- `Authorization: Bearer <jwt>` header
- `Cookie: session=<session-token>` (for browser clients carrying the Better Auth cookie)

Unauthenticated requests → `401`. Authorised but insufficient scope → `403`.

**HTTP status codes (all analytics GET endpoints):**

| Status | Condition |
|---|---|
| `200` | Success |
| `400` | Missing required `from`/`to`, invalid date format, unrecognised enum value |
| `401` | No valid session |
| `403` | User lacks scope to see the requested data |
| `500` | Upstream query failure |

---

## C3. Portfolio endpoints

```
GET /api/v1/command-centre/analytics/portfolio/summary
    ?from=&to=&[common filters]&comparison=yoy
    → PortfolioSummaryResponse
    gRPC: AnalyticsService.GetPortfolioSummary

GET /api/v1/command-centre/analytics/portfolio/categories
    ?from=&to=&[common filters]
    → PortfolioCategoriesResponse
    gRPC: AnalyticsService.GetPortfolioCategories

GET /api/v1/command-centre/analytics/portfolio/products
    ?from=&to=&[common filters]&pageSize=&pageToken=
    → PortfolioProductsResponse
    gRPC: AnalyticsService.GetPortfolioProducts

GET /api/v1/command-centre/analytics/portfolio/trend
    ?from=&to=&[common filters]&granularity=daily
    → PortfolioTrendResponse
    gRPC: AnalyticsService.GetPortfolioTrend

GET /api/v1/command-centre/analytics/portfolio/outlet-tiers
    ?from=&to=&[common filters]
    → PortfolioOutletTiersResponse
    gRPC: AnalyticsService.GetPortfolioOutletTiers

GET /api/v1/command-centre/analytics/portfolio/high-performers
    ?from=&to=&[common filters]
    → HighPerformerAnalysisResponse
    gRPC: AnalyticsService.GetHighPerformerAnalysis
```

---

## C4. Heat Map endpoint

```
GET /api/v1/command-centre/analytics/heat-map
    ?from=&to=&[common filters]
    &scope=all|top10|bottom10      (default: all)
    &wRevenue=0.30                 (optional weight overrides, must sum to 1.0)
    &wTransactions=0.20
    &wRevPerRoom=0.25
    &wTxnPerKiosk=0.15
    &wBasket=0.10
    → HeatMapResponse
    gRPC: AnalyticsService.GetHeatMap
```

---

## C5. Trend Builder endpoint

**POST** — the request body carries per-series filter config which is too complex for query params.

```
POST /api/v1/command-centre/analytics/trend-series
Content-Type: application/json

{
  "globalFilter": {
    "from": "2026-01-01",
    "to":   "2026-05-25",
    "metricMode": "sales"
    // + any common filter fields
  },
  "series": [
    {
      "name": "UK Hotels",
      "metric": "revenue",           // revenue|transactions|avg_basket_value|booking_fee
      "filter": {                    // overrides / narrows globalFilter per series
        "regionIds": ["uuid-uk"],
        "locationTypes": ["hotel"]
      },
      "includeYoy": false
    },
    {
      "name": "EU Hotels",
      "metric": "revenue",
      "filter": { "regionIds": ["uuid-eu"] },
      "includeYoy": true
    }
  ],
  "granularity": "daily",            // daily|weekly|monthly|hourly
  "includeBusinessEvents": true,
  "eventCategoryIds": ["uuid-cat1"]
}

→ TrendSeriesResponse
gRPC: AnalyticsService.GetTrendSeries
```

**HTTP 400** if any series has missing `metric` or `name`; or if `granularity` is `hourly` with a date range > 7 days (too many data points).

---

## C6. Hotel Groups endpoints

```
GET /api/v1/command-centre/analytics/hotel-groups
    ?from=&to=&[common filters]&comparison=mom&pageSize=&pageToken=
    → ListHotelGroupsResponse
    gRPC: AnalyticsService.ListHotelGroups

GET /api/v1/command-centre/analytics/hotel-groups/{hotelGroupId}
    ?from=&to=&[common filters]
    → HotelGroupDetailResponse
    gRPC: AnalyticsService.GetHotelGroupDetail
```

---

## C7. Regions endpoints

```
GET /api/v1/command-centre/analytics/regions
    ?from=&to=&[common filters]&comparison=yoy
    → ListRegionsResponse
    gRPC: AnalyticsService.ListRegions

GET /api/v1/command-centre/analytics/regions/{regionId}
    ?from=&to=&[common filters]
    → RegionDetailResponse
    gRPC: AnalyticsService.GetRegionDetail
```

---

## C8. Location Groups endpoints

```
GET /api/v1/command-centre/analytics/location-groups
    ?from=&to=&[common filters]&comparison=mom&pageSize=&pageToken=
    → ListLocationGroupsResponse
    gRPC: AnalyticsService.ListLocationGroups

GET /api/v1/command-centre/analytics/location-groups/{locationGroupId}
    ?from=&to=&[common filters]
    → LocationGroupDetailResponse
    gRPC: AnalyticsService.GetLocationGroupDetail
```

---

## C9. Compare endpoint

```
GET /api/v1/command-centre/analytics/compare
    ?from=&to=&[common filters]
    &dimension=location|hotel_group|region|location_group|product
    &entityIds=uuid1,uuid2,uuid3    (2–N entity IDs of the same dimension)
    → ComparisonResponse
    gRPC: AnalyticsService.GetComparison

HTTP 400 if: fewer than 2 entityIds, or dimension is missing.
```

---

## C10. Experiments endpoint

```
GET /api/v1/command-centre/analytics/experiments/{cohortId}
    ?from=&to=&[common filters]&includeYoy=true
    → ExperimentResponse
    gRPC: AnalyticsService.GetExperimentMetrics

HTTP 404 if cohortId does not exist or is not visible to the caller.
```

---

## C11. Maturity Analysis endpoints

```
GET /api/v1/command-centre/analytics/maturity/buckets
    ?from=&to=&[common filters]
    → MaturityBucketsResponse
    gRPC: AnalyticsService.GetMaturityBuckets

GET /api/v1/command-centre/analytics/maturity/ramp-curve
    ?from=&to=&[common filters]
    → MaturityRampCurveResponse
    gRPC: AnalyticsService.GetMaturityRampCurve

GET /api/v1/command-centre/analytics/maturity/install-cohorts
    ?from=&to=&[common filters]
    → InstallCohortsResponse
    gRPC: AnalyticsService.GetInstallCohorts
```

---

## C12. Pivot Table endpoint

**POST** — row/column/value configuration is multi-field and not suited to query params.

```
POST /api/v1/command-centre/analytics/pivot
Content-Type: application/json

{
  "filter": {
    "from": "2026-01-01",
    "to":   "2026-05-25"
    // + any common filter fields
  },
  "rowField":    "location",          // location|hotel_group|region|product|location_group|provider|date_month|date_week
  "columnField": "product",
  "valueMetric": "revenue",           // revenue|transactions|avg_basket
  "aggregation": "sum",               // sum|avg|count|min|max
  "pageSize": 50,
  "pageToken": ""
}

→ PivotTableResponse
gRPC: AnalyticsService.GetPivotTable

HTTP 400 if rowField == columnField, or aggregation is avg/min/max on transactions.
```

---

## C13. Commission endpoints

```
GET /api/v1/command-centre/analytics/commission/summary
    ?from=&to=&[common filters]
    → CommissionSummaryResponse
    gRPC: CommissionService.GetCommissionSummary

GET /api/v1/command-centre/analytics/commission/trend
    ?from=&to=&[common filters]
    → CommissionTrendResponse
    gRPC: CommissionService.GetCommissionTrend

POST /api/v1/command-centre/analytics/commission/recalculate
Content-Type: application/json
Body: { "locationProductId": "uuid", "month": "2026-04" }
→ RecalculateCommissionsResponse
gRPC: CommissionService.RecalculateCommissions

Requires: admin role. HTTP 403 for non-admin callers.
```

---

## C14. Flags and Action Items endpoints

```
GET  /api/v1/command-centre/flags
     ?types=relocate,monitor,strategic_exception
     &statuses=active,resolved
     &locationIds=uuid1,uuid2
     &pageSize=&pageToken=
     → ListFlagsResponse
     gRPC: FlagsService.ListFlags

POST /api/v1/command-centre/flags
     Body: { "locationId": "uuid", "type": "monitor", "reason": "..." }
     → Flag
     gRPC: FlagsService.CreateFlag

PATCH /api/v1/command-centre/flags/{flagId}
      Body: { "status": "resolved", "reason": "..." }
      → Flag
      gRPC: FlagsService.UpdateFlag

GET  /api/v1/command-centre/action-items
     ?flagId=uuid                   (optional — omit for all action items)
     &statuses=open,in_progress
     &types=investigation,relocation,training,equipment
     &pageSize=&pageToken=
     → ListActionItemsResponse
     gRPC: FlagsService.ListActionItems

POST /api/v1/command-centre/action-items
     Body: { "flagId": "uuid", "type": "training", "description": "...", "assigneeId": "uuid", "dueDate": "2026-06-01" }
     → ActionItem
     gRPC: FlagsService.CreateActionItem

PATCH /api/v1/command-centre/action-items/{actionItemId}
      Body: { "status": "resolved", "description": "...", "assigneeId": "uuid", "dueDate": "2026-06-01" }
      → ActionItem
      gRPC: FlagsService.UpdateActionItem
```

---

## C15. Export endpoints

The gateway streams the gRPC byte chunks directly to the HTTP response body — no buffering.

```
GET /api/v1/command-centre/export
    ?tab=portfolio|heat-map|hotel-groups|regions|location-groups
    &format=csv|excel                (default: csv)
    &from=&to=&[common filters]
    → streaming file download

Response headers set by gateway from first ExportChunk:
    Content-Type:        text/csv; charset=utf-8
                         application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    Content-Disposition: attachment; filename="analytics-{tab}-{from}-{to}.csv"

gRPC: ExportService.ExportAnalytics (server-streaming)

HTTP 400 if tab is missing or unrecognised.
HTTP 400 if format is unrecognised.
```

> **Note:** The existing Next.js routes are `GET /api/export/csv` and `GET /api/export/excel` as separate endpoints. The Spring Boot version collapses these into one endpoint with a `format` param. The api-gateway controller must handle the streaming response (do not materialise the full file in memory).

---

## C16. Dimension (filter loader) endpoints

Used to populate the filter dropdowns on every analytics page. Results are RBAC-scoped — an external user only sees locations they have access to.

```
GET /api/v1/command-centre/dimensions/locations
    ?q=search_term&limit=100
    → LocationListResponse
    gRPC: DimensionService.ListLocations

GET /api/v1/command-centre/dimensions/regions
    ?q=&limit=100
    → RegionListResponse
    gRPC: DimensionService.ListRegions

GET /api/v1/command-centre/dimensions/hotel-groups
    ?q=&limit=100
    → HotelGroupListResponse
    gRPC: DimensionService.ListHotelGroups

GET /api/v1/command-centre/dimensions/location-groups
    ?q=&limit=100
    → LocationGroupListResponse
    gRPC: DimensionService.ListLocationGroups

GET /api/v1/command-centre/dimensions/products
    ?q=&limit=100
    → ProductListResponse
    gRPC: DimensionService.ListProducts

GET /api/v1/command-centre/dimensions/providers
    ?q=&limit=100
    → ProviderListResponse
    gRPC: DimensionService.ListProviders
```

---

## C17. ETL admin endpoints

All require `admin` role. Return `403` for non-admin callers.

```
POST /api/v1/command-centre/etl/azure/trigger
     Body: {} (empty)
     → TriggerEtlResponse  { status, processedBlobs, skippedBlobs, failedBlobs }
     gRPC: EtlService.TriggerAzureEtl

     HTTP 409 if advisory lock already held (another run in progress).
     HTTP 503 if ETL_AZURE_ENABLED is false on the service.

GET  /api/v1/command-centre/etl/blob-ingestions
     ?regionId=uuid&status=success|failed|&pageSize=&pageToken=
     → ListBlobIngestionsResponse
     gRPC: EtlService.ListBlobIngestions

GET  /api/v1/command-centre/etl/sales-imports
     ?regionId=uuid&status=staging|committed|failed|&pageSize=&pageToken=
     → ListSalesImportsResponse
     gRPC: EtlService.ListSalesImports
```

---

## C18. Complete endpoint inventory

All paths are prefixed `/api/v1/command-centre`. **Total: 39 REST endpoints → 40 gRPC RPCs** (export collapses two Next.js routes into one).

| Method | Path | gRPC RPC | Auth |
|---|---|---|---|
| GET | `/analytics/portfolio/summary` | `AnalyticsService.GetPortfolioSummary` | any |
| GET | `/analytics/portfolio/categories` | `AnalyticsService.GetPortfolioCategories` | any |
| GET | `/analytics/portfolio/products` | `AnalyticsService.GetPortfolioProducts` | any |
| GET | `/analytics/portfolio/trend` | `AnalyticsService.GetPortfolioTrend` | any |
| GET | `/analytics/portfolio/outlet-tiers` | `AnalyticsService.GetPortfolioOutletTiers` | any |
| GET | `/analytics/portfolio/high-performers` | `AnalyticsService.GetHighPerformerAnalysis` | any |
| GET | `/analytics/heat-map` | `AnalyticsService.GetHeatMap` | any |
| POST | `/analytics/trend-series` | `AnalyticsService.GetTrendSeries` | any |
| GET | `/analytics/hotel-groups` | `AnalyticsService.ListHotelGroups` | any |
| GET | `/analytics/hotel-groups/{id}` | `AnalyticsService.GetHotelGroupDetail` | any |
| GET | `/analytics/regions` | `AnalyticsService.ListRegions` | any |
| GET | `/analytics/regions/{id}` | `AnalyticsService.GetRegionDetail` | any |
| GET | `/analytics/location-groups` | `AnalyticsService.ListLocationGroups` | any |
| GET | `/analytics/location-groups/{id}` | `AnalyticsService.GetLocationGroupDetail` | any |
| GET | `/analytics/compare` | `AnalyticsService.GetComparison` | any |
| GET | `/analytics/experiments/{cohortId}` | `AnalyticsService.GetExperimentMetrics` | any |
| GET | `/analytics/maturity/buckets` | `AnalyticsService.GetMaturityBuckets` | any |
| GET | `/analytics/maturity/ramp-curve` | `AnalyticsService.GetMaturityRampCurve` | any |
| GET | `/analytics/maturity/install-cohorts` | `AnalyticsService.GetInstallCohorts` | any |
| POST | `/analytics/pivot` | `AnalyticsService.GetPivotTable` | any |
| GET | `/analytics/commission/summary` | `CommissionService.GetCommissionSummary` | any |
| GET | `/analytics/commission/trend` | `CommissionService.GetCommissionTrend` | any |
| POST | `/analytics/commission/recalculate` | `CommissionService.RecalculateCommissions` | admin |
| GET | `/flags` | `FlagsService.ListFlags` | any |
| POST | `/flags` | `FlagsService.CreateFlag` | any |
| PATCH | `/flags/{id}` | `FlagsService.UpdateFlag` | any |
| GET | `/action-items` | `FlagsService.ListActionItems` | any |
| POST | `/action-items` | `FlagsService.CreateActionItem` | any |
| PATCH | `/action-items/{id}` | `FlagsService.UpdateActionItem` | any |
| GET | `/export` | `ExportService.ExportAnalytics` | any |
| GET | `/dimensions/locations` | `DimensionService.ListLocations` | any |
| GET | `/dimensions/regions` | `DimensionService.ListRegions` | any |
| GET | `/dimensions/hotel-groups` | `DimensionService.ListHotelGroups` | any |
| GET | `/dimensions/location-groups` | `DimensionService.ListLocationGroups` | any |
| GET | `/dimensions/products` | `DimensionService.ListProducts` | any |
| GET | `/dimensions/providers` | `DimensionService.ListProviders` | any |
| POST | `/etl/azure/trigger` | `EtlService.TriggerAzureEtl` | admin |
| GET | `/etl/blob-ingestions` | `EtlService.ListBlobIngestions` | admin |
| GET | `/etl/sales-imports` | `EtlService.ListSalesImports` | admin |

---

# Part D — Monday.com Import Pipeline

---

## D1. Architectural Decision: Analytics-Service vs Kiosk-Service

**Question:** Should the Monday.com sync live in the `kiosk-service` rather than the analytics-service?

**Recommendation: No — keep it in the analytics-service.**

### Why not kiosk-service

| Concern | Detail |
|---|---|
| **Domain mismatch** | The primary output of Monday import is `location_products` — commission tiers per `(location, product)` pair. This is pure analytics-service domain knowledge. The kiosk-service has no concept of commission tiers, product availability, or providers. |
| **Hierarchy mismatch** | Kiosk-service uses `Country → Region → City → Location`. The analytics-service (and Monday's data) uses `Market → Region → Location + HotelGroups + LocationGroups`. Routing Monday import through kiosk-service would require a translation layer that adds complexity without benefiting either service. |
| **SoT scope** | Kiosk-service is the SoT for **device lifecycle**: firmware, config cascades, API keys, sync status. Monday is the SoT for **hotel hierarchy and commercial relationships** (products, commission rates). These are separate bounded contexts. |
| **API complexity budget** | Monday import fetches ~500 hotel items + ~500 asset items via GraphQL with cursor pagination, exponential backoff, and duplicate-detection logic. Adding this to kiosk-service balloons a service whose core duty is low-latency config fetch for devices. |

### Cross-service sync via Kafka

When the analytics-service completes a Monday import, it publishes a Kafka event (`monday.import.completed`) with the full result payload. The kiosk-service — or any other service that cares about the updated location/kiosk hierarchy — subscribes to this topic and syncs its own data accordingly. This is the correct cross-service boundary: the analytics-service owns the import; other services react to its output.

```
[analytics-service]                    [kiosk-service]
  runMondayImport()
       │
       ▼
  INSERT locations / kiosks / location_products
       │
       ▼
  Kafka: monday.import.completed  ──►  MondayImportConsumer
  { locations_inserted,                └─ upsert Country/Region/City/Location
    kiosks_inserted,                   └─ attach kiosks via CreateKiosk RPC
    location_products_rebuilt }           (optional — only if kiosk-service
                                            needs the same hierarchy)
```

---

## D2. System Overview

The Monday import pipeline reads hotel hierarchy and commercial relationship data from **Monday.com** and rebuilds three tables: `locations`, `kiosks / kiosk_assignments`, and `location_products`. Monday.com is the **source of truth** for hotel identity, kiosk-to-hotel assignment, and per-hotel product availability with commission tiers.

### Boards consumed

| Board ID | Name | Purpose |
|---|---|---|
| `1356570756` | Live Estate | Main UK/EU hotel + product board |
| `1743012104` | Ready to Launch | Pre-deployment hotels |
| `5026387784` | Removed | Decommissioned hotels |
| `5092887865` | Australia DCM | Australian hotels |
| `1426737864` | Assets | Canonical kiosk SoT (~488 items) |
| `1356657751` | Heathrow Express SSMs | Transit venues + Heathrow-line hotels |

### Trigger

Admin-triggered only (no scheduled cron). Monday data changes sporadically as the ops team updates boards — a cron would waste Monday's API complexity budget and risk rate-limiting during business hours.

### Advisory lock

Lock key `738294106` — intentionally different from the Azure ETL lock (`738294105`) so both jobs can be queued independently without starving each other.

---

## D3. Import Orchestration — 4-Step Sequence

The full import runs as one atomic job in this order:

```
[Admin trigger via MondayService.TriggerMondayImport gRPC]
       │
       ▼
[pg_try_advisory_lock(738294106)]  ──► 409 lock_contention
       │ acquired
       ▼

┌────────────────────────────────────────────────────────────┐
│  Step 1: runHotelLocationImport                            │
│  Boards: Live Estate, Ready to Launch, Removed, AU DCM     │
│  Output: locations table + hotelMondayIdToLocationId map   │
└───────────────────────────┬────────────────────────────────┘
                            │ hotelMondayIdToLocationId map
                            ▼
┌────────────────────────────────────────────────────────────┐
│  Step 2: runAssetsImport                                   │
│  Board: Assets (1426737864)                                │
│  Output: kiosks + kiosk_assignments                        │
└───────────────────────────┬────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
┌─────────────────────┐   ┌──────────────────────────────────┐
│  Step 3:            │   │  Step 4: runHeathrowImport        │
│  runHeathrowImport  │   │  (runs in parallel with Step 3   │
│  Board: 1356657751  │   │   — no data dependency)          │
│  Output: locations  │   └──────────────────────────────────┘
│  + kiosks (inline)  │
└─────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│  Step 5: runMondayImport (location_products rebuild)       │
│  Boards: Live Estate, Ready to Launch, Removed, AU DCM     │
│  Action: TRUNCATE location_products → bulk INSERT          │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
[writeAuditLog: action=monday_import_triggered, metadata=counts]
[Kafka: monday.import.completed]
[Redis: invalidate analytics:* cache keys]
[pg_advisory_unlock(738294106)]
```

> **Step 3 and Step 4 can run in parallel** — Heathrow import has no dependency on the Assets import result (it synthesises its own kiosks inline). In Spring Boot, run them as concurrent `CompletableFuture` tasks.

> **Step 5 (location_products) must run last** — it resolves locations by `mondayItemId`, which is populated by Steps 1–4. Running it before Steps 1–4 complete means location lookup misses rows inserted in the same run.

---

## D4. Concurrency Control

| Property | Value |
|---|---|
| Lock key | `738294106` |
| Function | `pg_try_advisory_lock` — non-blocking; returns false immediately if held |
| Scope | Session-scoped; auto-released on connection drop |
| Relationship to Azure ETL | Different key — both jobs can be queued/run independently |

**Spring Boot:** Same options as Azure ETL — `pg_try_advisory_lock` via pinned JDBC connection, or Redis `SET NX PX etl:monday:lock 900000` (15-minute TTL to cover the typical ~60–120s run).

---

## D5. Environment Variables

| Variable | Purpose |
|---|---|
| `MONDAY_API_TOKEN` | Monday.com API personal token or app token. **Required.** Import aborts with `missing_token` if unset. |
| `MONDAY_API_VERSION` | API version header (default: `2024-10`). Override to test against a new Monday API release without code change. |

---

## D6. Monday.com API Client (Spring Boot)

### Endpoint

```
POST https://api.monday.com/v2
Authorization: {MONDAY_API_TOKEN}
Content-Type: application/json
API-Version: 2024-10
Body: { "query": "...", "variables": {} }
```

### Error shapes

Monday does not return structured error codes. All error detection is string-based on `errors[].message`:

| Pattern | Meaning | Retry? |
|---|---|---|
| `"rate limit"` | API rate limit | Yes |
| `"complexity"` | Query complexity budget | Yes |
| `"budget exhausted"` | Complexity budget | Yes |
| `"HTTP 502"` / `"bad gateway"` | Gateway hiccup | Yes |
| `"HTTP 503"` / `"service unavailable"` | Transient infra | Yes |
| `"HTTP 504"` / `"gateway timeout"` | Timeout | Yes |
| Any other GraphQL error | Bad query or data error | No |

### Retry policy

5 attempts with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | 1 000 ms |
| 2 | 2 000 ms |
| 3 | 4 000 ms |
| 4 | 8 000 ms |
| 5 (final) | 16 000 ms → fail |

Non-retryable errors propagate immediately on attempt 1.

### Cursor pagination

Monday boards are paginated via `items_page` / `next_items_page`:

```
Page 1:  boards(ids: [N]) { items_page(limit: 100) { cursor items { ... } } }
Page 2+: next_items_page(limit: 100, cursor: "...") { cursor items { ... } }
```

Stop condition: `cursor == null` OR `items.length == 0`.

**Spring Boot implementation:**

```java
// MondayApiClient.java
public <T> List<T> fetchAllBoardItems(long boardId, String itemFragment, 
                                       Function<JsonNode, T> mapper) {
    List<T> all = new ArrayList<>();
    String cursor = null;
    boolean first = true;
    do {
        String query = first
            ? "{ boards(ids: [%d]) { items_page(limit: 100) { cursor items { %s } } } }"
                .formatted(boardId, itemFragment)
            : "{ next_items_page(limit: 100, cursor: \"%s\") { cursor items { %s } } }"
                .formatted(cursor, itemFragment);
        JsonNode page = executeWithRetry(query);
        JsonNode items = first
            ? page.path("boards").path(0).path("items_page").path("items")
            : page.path("next_items_page").path("items");
        cursor = first
            ? page.path("boards").path(0).path("items_page").path("cursor").asText(null)
            : page.path("next_items_page").path("cursor").asText(null);
        first = false;
        items.forEach(item -> all.add(mapper.apply(item)));
    } while (cursor != null && !cursor.isBlank());
    return all;
}
```

### MirrorValue typed fragment

Monday's `MirrorValue` columns return `null` for the standard `text` field. The `display_value` is only available via a typed inline fragment:

```graphql
column_values(ids: ["mirror3__1", "mirror9"]) {
  id type text
  ... on MirrorValue { display_value }
}
```

**Spring Boot:** Jackson does not understand GraphQL typed fragments natively. Pass the raw fragment string to the query and read `display_value` from the JSON node directly.

### BoardRelationValue typed fragment

Assets board's `link_to_hotel_ssms` returns linked item IDs via:

```graphql
column_values(ids: ["link_to_hotel_ssms"]) {
  id type text value
  ... on BoardRelationValue { linked_item_ids }
}
```

---

## D7. Step 1 — Hotel Location Import

**Source:** 4 hotel boards (Live Estate, Ready to Launch, Removed, Australia DCM)  
**Target:** `locations` table  
**Output:** `Map<String, UUID> hotelMondayIdToLocationId` (passed to Steps 2 and 5)

### Item fragment

```graphql
id
name
group { id title }
column_values(ids: ["mirror3__1", "location"]) {
  id type text
  ... on MirrorValue { display_value }
}
```

### Column semantics

| Column ID | Type | Content |
|---|---|---|
| `mirror3__1` | MirrorValue | RPS customer code (Cust_cd), comma-aggregated across kiosk rows. Use `display_value`. |
| `location` | LocationValue | Address string `"Hotel Name, Street, City, Country"`. Use `text`. Country is the last comma-token. |
| `group.title` | string | Region discriminator. See D11 for patterns. |

### `customer_code` extraction from `mirror3__1`

Multi-kiosk hotels produce comma-duplicated codes (`"2357, 2357"`) because the mirror aggregates one row per kiosk. Algorithm:

1. Split on `,`, trim each token, filter empty
2. Deduplicate via Set
3. If only 1 distinct value → use it
4. If multiple distinct values (operator data error — two RPS accounts on same hotel) → log the item id and distinct codes, return the first token. The same-name detection surface handles the conflict.

### Region resolution (2-pass)

**Pass 1:** Call `RegionGroupResolver.resolve(boardId, group.title)` — matches against `GROUP_TITLE_REGION_PATTERNS` (see D11)

**Pass 2:** If null, extract the last comma-token from the `location` column's text (e.g. `"..., UK"`) and call `resolve(boardId, countryToken)`

If still null → `hotelsSkippedNoRegion++`, add group title to `unmappedGroupTitles`, skip item.

### Pending-deployment detection

Group title matches `/^\s*ready to launch\s*$/i` → `isPlaceholder = true` (customer code may be null). These get imported as placeholder locations with NULL `customer_code`.

### Insert logic

```
INSERT INTO locations (name, normalised_name, customer_code, monday_item_id, primary_region_id, notes)
ON CONFLICT (monday_item_id) WHERE monday_item_id IS NOT NULL DO NOTHING
RETURNING id
```

**If `RETURNING` is empty** (row already exists): SELECT by `monday_item_id` to get the id — still add to the `hotelMondayIdToLocationId` map so Steps 2 and 5 can resolve it.

### Conflict recovery

Two 23505 scenarios require special handling. Each insert must be wrapped in a **SAVEPOINT** so a constraint violation doesn't abort a surrounding transaction:

**Scenario A — `(primary_region_id, customer_code)` collision:**

Constraint: `locations_region_customer_code_partial_uniq` (WHERE customer_code IS NOT NULL)

This means two distinct Monday items share the same RPS account code in the same region — an operator data error. Recovery:

```
ROLLBACK TO SAVEPOINT sp_hotel_{itemId}
SAVEPOINT sp_hotel_{itemId}_retry
INSERT ... WITH customer_code = NULL, notes = "[Phase 07-06] customer_code '{code}' already taken..."
RELEASE SAVEPOINT sp_hotel_{itemId}_retry
customerCodeConflictsRetried++
```

**Scenario B — `normalised_name` collision:**

Constraint: `locations_normalised_name_unique_active` (WHERE archived_at IS NULL)

This means the same hotel appears on multiple Monday boards (e.g. Live Estate + Australia DCM). Recovery:

```
ROLLBACK TO SAVEPOINT sp_hotel_{itemId}
-- Look up existing row by normalised_name WHERE archived_at IS NULL
-- Append conflict note to existing row's notes field
-- Use existing row's id for the hotelMondayIdToLocationId map
sameNameSkipped++
```

The existing row is used for the hotel-id map so the Assets importer can still attach kiosks to the canonical location.

### SAVEPOINT pattern (critical)

```java
String savepointName = "sp_hotel_" + itemId.replaceAll("[^A-Za-z0-9_]", "_");
jdbcTemplate.execute("SAVEPOINT " + savepointName);
try {
    // attempt insert
    jdbcTemplate.execute("RELEASE SAVEPOINT " + savepointName);
} catch (DataIntegrityViolationException e) {
    jdbcTemplate.execute("ROLLBACK TO SAVEPOINT " + savepointName);
    // handle conflict
}
```

**If this importer runs inside a `@Transactional` method, every insert must use SAVEPOINTs.** Without them, a 23505 sets the connection state to "in failed transaction" and all subsequent queries fail until ROLLBACK.

### Result shape

```java
public record HotelLocationImportResult(
    int locationsInserted,
    int locationsSkippedExisting,
    int hotelsSkippedNoRegion,
    int placeholderLocationsCreated,
    int customerCodesPopulated,
    int customerCodeConflictsRetried,
    int sameNameSkipped,
    List<String> unmappedGroupTitles,
    Map<String, UUID> hotelMondayIdToLocationId,   // passed to Steps 2 and 5
    int boardsProcessed,
    long durationMs
) {}
```

---

## D8. Step 2 — Assets Import (Kiosks)

**Source:** Assets board (`1426737864`, ~488 items)  
**Target:** `kiosks` + `kiosk_assignments`  
**Dependency:** `hotelMondayIdToLocationId` from Step 1

### Item fragment

```graphql
id
name
group { id title }
column_values(ids: ["outlet_code1", "link_to_hotel_ssms"]) {
  id type text value
  ... on BoardRelationValue { linked_item_ids }
}
```

### Column semantics

| Column ID | Type | Content |
|---|---|---|
| `outlet_code1` | Text | Per-kiosk outlet code (e.g. `"F9"`, `"CB"`). Use `text`. Single code per asset row. |
| `link_to_hotel_ssms` | BoardRelationValue | Linked hotel item id on one of the 4 hotel boards. Use `linked_item_ids[0]`. |

### Per-item algorithm

```
outletCode = item.column_values["outlet_code1"].text.trim()
if outletCode is empty → assetsSkippedNoOutletCode++; continue

linkedHotelId = item.column_values["link_to_hotel_ssms"].linked_item_ids[0]
if linkedHotelId is null → assetsSkippedNoLinkedHotel++; continue

locationId = hotelMondayIdToLocationId.get(linkedHotelId)
if locationId is null:
  assetsSkippedHotelNotResolvable++
  unmappedHotelMondayIds.add(linkedHotelId) [capped at 50]
  continue

kioskId = "ASSET-" + item.id    // universal idempotency key

INSERT INTO kiosks (kiosk_id, outlet_code)
ON CONFLICT (kiosk_id) DO NOTHING
RETURNING id

if kiosks.id not returned → SELECT kiosks WHERE kiosk_id = kioskId

// Idempotent assignment check (no UNIQUE constraint on the pair):
SELECT id FROM kiosk_assignments WHERE kiosk_id = kioskUuid AND location_id = locationId LIMIT 1
if not exists:
  INSERT INTO kiosk_assignments (kiosk_id, location_id, assigned_by, assigned_by_name)
  assignmentsInserted++
```

### Kiosk dedup key

`kiosk_id = "ASSET-{mondayItemId}"` — stable across re-runs because Monday item IDs are immutable. This means repeated imports update-in-place correctly without creating duplicates.

### Result shape

```java
public record AssetsImportResult(
    int kiosksInserted,
    int kiosksSkippedExisting,
    int assignmentsInserted,
    int assetsSkippedNoOutletCode,
    int assetsSkippedNoLinkedHotel,
    int assetsSkippedHotelNotResolvable,
    List<String> unmappedHotelMondayIds,   // up to 50, for diagnostics
    long durationMs
) {}
```

---

## D9. Step 3 — Heathrow Express SSMs Import

**Source:** Heathrow Express SSMs board (`1356657751`)  
**Target:** `locations` + `kiosks` + `kiosk_assignments` (inline — no Assets board dependency)  
**Runs in parallel with Step 2** (no shared data)

### Why Heathrow is a separate importer

- Outlet codes are in `outlet_code1` (direct text field), NOT `mirror9`. No Assets board link exists — every Heathrow outlet's kiosk must be synthesised inline.
- Codes can be slash-separated (`"H9/9H"`) in addition to comma-separated.
- Items mix transit venues and hotels, some of which also appear on Live Estate with different outlet codes. Duplicates are resolved by the operator via the merge UI — not auto-deduped here.

### Item fragment

```graphql
id
name
group { id title }
column_values(ids: ["outlet_code1", "text4", "location"]) {
  id type text
}
```

### Column semantics

| Column ID | Type | Content |
|---|---|---|
| `outlet_code1` | Text | Outlet code(s). Split on both `,` and `/`. |
| `text4` | Text | RPS customer code (Cust_cd). Mostly empty (~1/12 items populated). |
| `location` | Text | Address string. Country is the last comma-token (region fallback). |

### Group classification

| Pattern | Classification |
|---|---|
| `/^\s*live\b/i` | Live — create location + kiosks |
| `/^\s*in progress\s*$/i` | Pending — create placeholder location only (no kiosks) |
| Anything else | Skip silently |

### Per-item algorithm

```
groupTitle = item.group.title
isLive    = LIVE_GROUP_RE.test(groupTitle)
isPending = PENDING_GROUP_RE.test(groupTitle)
if !isLive && !isPending → skip

outletCodes = split(outlet_code1 text, on /[,/]/).trim().filter(non-empty)
if isLive && outletCodes.isEmpty → itemsSkippedNoOutlet++; continue

// Region resolution: country token from location text → resolveRegionIdByGroup
// Fallback: try group title itself
primaryRegionId = resolveRegionIdByGroup(boardId, country)
               ?? resolveRegionIdByGroup(boardId, groupTitle)
if null → itemsSkippedNoRegion++; continue

// Insert location (onConflictDoNothing on monday_item_id)
INSERT INTO locations (name, normalised_name, customer_code, monday_item_id, primary_region_id)
ON CONFLICT (monday_item_id) WHERE monday_item_id IS NOT NULL DO NOTHING

isPlaceholder = isPending && outletCodes.isEmpty
if !isPlaceholder:
  for each outletCode in outletCodes:
    kioskId = "HEATHROW-" + item.id + "-" + outletCode
    INSERT INTO kiosks (kiosk_id, outlet_code) ON CONFLICT (kiosk_id) DO NOTHING
    INSERT INTO kiosk_assignments (kiosk_id, location_id, assigned_by, assigned_by_name)
      WHERE NOT EXISTS (SELECT 1 ... WHERE kiosk_id=? AND location_id=?)
```

### Kiosk dedup key

`kiosk_id = "HEATHROW-{itemId}-{outletCode}"` — includes the outlet code because a single Heathrow item can produce multiple kiosks (slash-separated codes).

### Result shape

```java
public record HeathrowImportResult(
    int liveLocationsInserted,
    int liveLocationsSkippedExisting,
    int placeholderLocationsCreated,
    int itemsSkippedNoRegion,
    int itemsSkippedNoOutlet,
    int kiosksInserted,
    int kiosksSkippedExisting,
    int assignmentsInserted,
    int customerCodesPopulated,
    List<String> unmappedGroupTitles,
    long durationMs
) {}
```

---

## D10. Step 4 — Location Products Rebuild (TRUNCATE + Bulk Insert)

**Source:** Same 4 hotel boards as Step 1  
**Target:** `location_products` (TRUNCATE CASCADE + bulk INSERT)  
**Dependency:** Steps 1–3 must complete first (location lookup by `mondayItemId`)

### Item fragment

```graphql
id name
column_values(ids: ["mirror9"]) {
  id type
  ... on MirrorValue { display_value }
}
subitems {
  id name
  column_values { id text type }
}
```

### Column semantics

| Column / Subitem Field | Column ID | Content |
|---|---|---|
| `mirror9` (hotel item) | `mirror9` | Comma-separated outlet codes. `display_value` via typed fragment. Retained for telemetry only post-07-06. |
| Provider name (subitem) | `label2__1` | Provider / OTA name. Use `text`. |
| Availability (subitem) | `color5__1` | Status column. `text = "Yes"` → available. |
| Commission rate (subitem) | `dup__of_commission9__1` | Flat rate as decimal string. `parseFloat`. Null if empty. |
| Product name (subitem) | `item.name` | Product name. Used as key against `products` table. |

### Location resolution (post-07-06)

Location is resolved by `mondayItemId` directly — **not** by outlet code. Mirror9 codes are read for telemetry only.

```java
// locMapByMondayId: Map<String, UUID> built from locations WHERE monday_item_id IS NOT NULL
UUID locationId = locMapByMondayId.get(hotel.mondayItemId());
if (locationId == null) {
    skippedNoLoc++;
    continue;
}
```

### Placeholder promotion

Hotels with no mirror9 codes are normally skipped. On `PLACEHOLDER_IMPORT_BOARDS` (Live Estate `1356570756` and Australia DCM `5092887865`), they instead get a placeholder location created:

```java
// BOARD_REGION: only board 5092887865 → "AU"
// Live Estate has no unambiguous default — placeholder creation skipped + logged
String regionCode = BOARD_REGION.get(hotel.boardId());
if (regionCode == null) {
    placeholdersSkippedNoRegion++;
    continue;
}
```

This is intentional: Live Estate is a mixed-region board. Defaulting to UK (as was done pre-07-06) silently mis-attributed non-UK hotels. The `BOARD_REGION` map forces an explicit decision per board.

### Commission tiers JSONB

Each subitem with a non-null commission rate generates a single flat-rate tier backdated to `2020-01-01`:

```json
[
  {
    "effectiveFrom": "2020-01-01",
    "tiers": [
      { "minRevenue": 0, "maxRevenue": null, "rate": 0.15 }
    ]
  }
]
```

`maxRevenue = null` means the tier has no upper bound (the waterfall engine treats it as infinity).

Commission rate = `null` → `commission_tiers` column is NULL (no tier config for this product at this location).

### TRUNCATE + bulk insert

```java
// 1. Collect ALL rows in memory (no writes yet)
List<LocationProductRow> allRows = buildAllRows(hotels, locMapByMondayId, productMap, providerMap);

// 2. TRUNCATE (CASCADE handles FKs from commission_ledger if any)
jdbcTemplate.execute("TRUNCATE location_products CASCADE");

// 3. Batch insert — 20 rows per batch, 3 attempts on ECONNRESET/ETIMEDOUT
int BATCH_SIZE = 20;
for (int i = 0; i < allRows.size(); i += BATCH_SIZE) {
    List<LocationProductRow> batch = allRows.subList(i, Math.min(i + BATCH_SIZE, allRows.size()));
    insertBatchWithRetry(batch, 3);
}
```

> **Why batch size 20?** The original TypeScript chose this empirically for Neon serverless connection stability. In Spring Boot with a persistent connection pool this limit is less critical, but keeping it avoids generating very large prepared statements. Increase to 500 for a persistent `HikariCP` pool.

### Same-name warning detection

Before any DB writes, compute same-name warnings by comparing `normaliseName(hotel.name)` against all active `locations.normalised_name` values. This is a **read-only pre-check** — it does not block the import but surfaces potential duplicates in the result for operator review.

```java
// Load all active locations' normalised names once up front
Map<String, List<UUID>> normalisedNameToActiveIds = loadActiveNormalisedNames(db);

List<SameNameWarning> warnings = new ArrayList<>();
for (HotelItem hotel : hotels) {
    String norm = normaliseName(hotel.name());
    List<UUID> colliding = normalisedNameToActiveIds.getOrDefault(norm, List.of());
    if (!colliding.isEmpty()) {
        warnings.add(new SameNameWarning(norm, hotel.mondayItemId(), hotel.name(), colliding));
    }
}
```

### Dry-run mode

When `dryRun = true`:
- All Monday fetches and pre-checks run normally
- No `TRUNCATE`, no `INSERT`, no product/provider auto-creation
- Single `audit_logs` entry with `action = dry_import_warning` and the warning batch (if `persistWarnings = true`)
- Returns `rowsInserted = 0` with the full `sameNameWarnings` list

### Result shape

```java
public record MondayImportResult(
    int rowsInserted,
    int placeholdersCreated,
    List<String> placeholderNames,
    int hotelsSkipped,
    int placeholdersSkippedNoRegion,
    int productsResolved,
    int providersResolved,
    long durationMs,
    List<SameNameWarning> sameNameWarnings
) {}
```

---

## D11. Region Group Title Mapper

`RegionGroupResolver` translates a Monday group title (or LocationValue country token) into a `regions.id`. Configured via `application.yml`.

### `application.yml` configuration

```yaml
monday:
  api-token: ${MONDAY_API_TOKEN}
  api-version: "2024-10"
  group-region-patterns:
    - pattern: "(?i)\\b(uk|united kingdom|england|british)\\b"
      region-code: "UK"
    - pattern: "(?i)\\b(ireland|irish|\\bie\\b)\\b"
      region-code: "IE"
    - pattern: "(?i)\\b(spain|spanish|canary)\\b"
      region-code: "ES"
    - pattern: "(?i)\\b(germany|german)\\b"
      region-code: "DE"
    - pattern: "(?i)\\b(czech|prague|praha)\\b"
      region-code: "CZ"
    - pattern: "(?i)\\b(australia|australian)\\b"
      region-code: "AU"
```

### `@ConfigurationProperties`

```java
@ConfigurationProperties(prefix = "monday")
public record MondayProperties(
    String apiToken,
    String apiVersion,
    List<GroupRegionPattern> groupRegionPatterns
) {
    public record GroupRegionPattern(String pattern, String regionCode) {}
}
```

### `RegionGroupResolver` bean

```java
@Component
public class RegionGroupResolver {

    private final List<CompiledPattern> patterns;
    private final RegionRepository regionRepo;

    public RegionGroupResolver(MondayProperties props, RegionRepository regionRepo) {
        this.patterns = props.groupRegionPatterns().stream()
            .map(p -> new CompiledPattern(Pattern.compile(p.pattern()), p.regionCode()))
            .toList();
        this.regionRepo = regionRepo;
    }

    // Cache region code → UUID after first DB lookup (rarely more than 6 regions)
    private final Map<String, UUID> regionCodeToId = new ConcurrentHashMap<>();

    public UUID resolve(long boardId, String groupTitle) {
        for (CompiledPattern cp : patterns) {
            if (cp.pattern().matcher(groupTitle).find()) {
                return regionCodeToId.computeIfAbsent(cp.regionCode(),
                    code -> regionRepo.findByCode(code)
                                      .map(Region::getId)
                                      .orElseThrow(() -> new IllegalStateException(
                                          "No region row for code '" + code + "'. Seed regions first.")));
            }
        }
        return null;  // caller increments hotelsSkippedNoRegion and continues
    }

    private record CompiledPattern(Pattern pattern, String regionCode) {}
}
```

**Patterns are evaluated in order; first match wins.** When the operator creates a new Monday board with a new geography, they add one `pattern` entry to `application.yml` — no code deploy required (use Spring Config Server or restart with updated env var).

---

## D12. Placeholder Location Logic

A placeholder location represents a hotel that exists on Monday but has no live kiosks yet (pre-deployment or pending install). It ensures commission tiers can still be imported before the kiosk hardware arrives.

### Creation conditions

| Board | Condition | Action |
|---|---|---|
| Live Estate (`1356570756`) | No `mirror9` codes on the hotel item | Create placeholder if `BOARD_REGION` has an entry for this board |
| Australia DCM (`5092887865`) | No `mirror9` codes | Create placeholder; `BOARD_REGION["5092887865"] = "AU"` |
| Ready to Launch (`1743012104`) | Any | Skip — not live yet |
| Removed (`5026387784`) | Any | Skip — decommissioned |
| Heathrow (`1356657751`) | `isPending` group (`in progress`) | Create placeholder (NULL customer_code, no kiosks) |

### `BOARD_REGION` map (only unambiguous boards)

```yaml
monday:
  board-region:
    5092887865: "AU"   # Australia DCM — AU-only
    # Live Estate deliberately omitted. Pre-07-06 it defaulted to "UK",
    # silently mis-attributing non-UK hotels. See audit D5 Parts A+B.
```

### Insert

```sql
INSERT INTO locations (name, normalised_name, monday_item_id, primary_region_id, location_type, notes)
VALUES (?, ?, ?, ?, NULL, 'Imported from Monday (mondayItemId=...) on YYYY-MM-DD — no customer code...')
ON CONFLICT (monday_item_id) WHERE monday_item_id IS NOT NULL DO NOTHING
RETURNING id
```

If `RETURNING` is empty (already exists from a prior run) → SELECT by `mondayItemId`.

### Audit log on creation

```
entityType = "location"
action     = "imported_from_monday_placeholder"
entityId   = {inserted location UUID}
entityName = {hotel name}
metadata   = { mondayItemId, board }
```

---

## D13. Product and Provider Resolution

Products and providers from Monday subitems are resolved against the `products` and `providers` tables using a write-through in-memory cache. All unique names are pre-resolved before any `location_products` rows are written.

### Pre-resolution

```java
// Collect all unique names from the in-memory hotels list (no DB reads in hot path)
Set<String> allProductNames = new HashSet<>();
Set<String> allProviderNames = new HashSet<>();
for (HotelItem hotel : hotels) {
    for (SubitemData sub : hotel.subitems()) {
        allProductNames.add(sub.productName());
        if (sub.providerName() != null) allProviderNames.add(sub.providerName());
    }
}

// Pre-load existing entries into map
productMap  = loadExistingProducts(db);   // Map<String(lowercase name), UUID>
providerMap = loadExistingProviders(db);  // Map<String(lowercase name), UUID>

// Resolve / auto-create any missing
for (String name : allProductNames)  getOrCreateProduct(name);
for (String name : allProviderNames) getOrCreateProvider(name);
```

### `getOrCreateProduct` / `getOrCreateProvider`

```sql
-- First try: INSERT ... ON CONFLICT (name) DO NOTHING RETURNING id
-- If nothing returned: SELECT id FROM products WHERE name = ?
```

Both are idempotent. Concurrent callers are safe — the `ON CONFLICT DO NOTHING` means the second caller simply falls through to the SELECT.

---

## D14. `normalise_name` Invariant

`normalisedName` on `locations` is computed by `normaliseName(name)` and enforced by a partial unique index `(normalised_name) WHERE archived_at IS NULL`. This prevents the same hotel from landing twice in the system when it appears on multiple Monday boards.

The normalisation function: lowercase, strip punctuation, collapse whitespace. Example:

```
"Hilton London Paddington Hotel" → "hilton london paddington hotel"
"Hilton London Paddington Hotel." → "hilton london paddington hotel"
```

**Spring Boot:** implement as a `@Component StringNormaliser` with the same rules. Used in both hotel-location import (for the normalised_name column) and in Step 4's same-name pre-check.

---

## D15. Database Schema (Monday-specific additions)

The following columns / indexes are specific to Monday import and must be added alongside the ETL schema from Part A.

### `locations` (Monday-relevant columns)

```sql
ALTER TABLE locations ADD COLUMN monday_item_id   text;
ALTER TABLE locations ADD COLUMN normalised_name  text;
ALTER TABLE locations ADD COLUMN customer_code    text;
ALTER TABLE locations ADD COLUMN notes            text;
ALTER TABLE locations ADD COLUMN location_type    text;  -- enum: hotel|retail_desk|online|airport|hex_kiosk|internal
ALTER TABLE locations ADD COLUMN archived_at      timestamptz;

-- Partial unique indexes:
CREATE UNIQUE INDEX locations_monday_item_id_partial_uniq
    ON locations (monday_item_id) WHERE monday_item_id IS NOT NULL;

CREATE UNIQUE INDEX locations_normalised_name_unique_active
    ON locations (normalised_name) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX locations_region_customer_code_partial_uniq
    ON locations (primary_region_id, customer_code) WHERE customer_code IS NOT NULL;
```

### `kiosks` (Monday-relevant columns)

```sql
ALTER TABLE kiosks ADD COLUMN kiosk_id    text UNIQUE;  -- "ASSET-{id}" or "HEATHROW-{id}-{code}"
ALTER TABLE kiosks ADD COLUMN outlet_code text;
```

### `kiosk_assignments`

```sql
CREATE TABLE kiosk_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id        uuid NOT NULL REFERENCES kiosks(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES locations(id),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     text,
  assigned_by_name text,
  unassigned_at   timestamptz,   -- NULL = currently active
  INDEX (kiosk_id),
  INDEX (location_id)
);
```

### `location_products`

```sql
CREATE TABLE location_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       uuid NOT NULL REFERENCES locations(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  provider_id       uuid REFERENCES providers(id),
  availability      text NOT NULL DEFAULT 'available',  -- available|unavailable
  commission_tiers  jsonb,                               -- [{effectiveFrom, tiers:[{minRevenue,maxRevenue,rate}]}]
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  INDEX (location_id),
  INDEX (product_id)
);
```

> **CASCADE on TRUNCATE:** `TRUNCATE location_products CASCADE` will cascade to any table with a FK referencing `location_products`. Verify that `commission_ledger` does NOT reference `location_products` directly — it references `sales_records` and `location_products` separately. If a future migration adds a `location_products_id` FK on `commission_ledger`, the CASCADE will wipe ledger entries too. Guard this in the Spring Boot service: log a count of `commission_ledger` rows before TRUNCATE and throw if it would cascade to non-empty ledger rows.

---

## D16. Audit Trail

| Event | `entity_type` | `action` | `metadata` |
|---|---|---|---|
| Import triggered (all steps) | `system` | `monday_import_triggered` | `{rowsInserted, placeholdersCreated, placeholderNames, hotelsSkipped, productsResolved, providersResolved, durationMs}` |
| Placeholder location created | `location` | `imported_from_monday_placeholder` | `{mondayItemId, board}` |
| Dry-run warning batch | `system` | `dry_import_warning` | `{warnings: count, sample: first 5 warnings}` |

### Actor for admin-triggered runs

```
actorId   = session.user.id   (the admin who clicked "Run")
actorName = session.user.name
```

### Actor for placeholder location auto-creation (system action within the import)

```
actorId   = "script:import-location-products-from-monday"
actorName = "System (Monday import)"
```

---

## D17. Spring Boot Module Breakdown

```
com.wkg.monday
├── config/
│   ├── MondayProperties.java          -- @ConfigurationProperties(prefix="monday")
│   └── RegionGroupResolver.java       -- compiled pattern cache + region code → id lookup
│
├── client/
│   └── MondayApiClient.java           -- executeWithRetry(), fetchAllBoardItems(cursor pagination)
│
├── importer/
│   ├── MondayImportOrchestrator.java  -- runs Steps 1→2+3(parallel)→4 in sequence
│   ├── HotelLocationImportService.java -- Step 1
│   ├── AssetsImportService.java        -- Step 2
│   ├── HeathrowImportService.java      -- Step 3 (parallel with Step 2)
│   └── LocationProductsImportService.java -- Step 4 (TRUNCATE + rebuild)
│
├── model/
│   ├── HotelItem.java                 -- in-memory hotel with subitems + mondayItemId + boardId
│   ├── SubitemData.java               -- productName, providerName, available, commissionRate
│   ├── SameNameWarning.java           -- normalisedName, mondayItemId, collidingLocationIds
│   ├── HotelLocationImportResult.java
│   ├── AssetsImportResult.java
│   ├── HeathrowImportResult.java
│   └── MondayImportResult.java
│
├── normaliser/
│   └── NameNormaliser.java            -- normaliseName(): lowercase, strip punctuation, collapse whitespace
│
└── grpc/
    └── MondayServiceImpl.java         -- TriggerMondayImport RPC impl
```

### Key Spring Boot implementation notes

1. **Parallel execution (Steps 2 + 3):**
   ```java
   CompletableFuture<AssetsImportResult> assetsFuture =
       CompletableFuture.supplyAsync(() -> assetsService.run(hotelMap), executor);
   CompletableFuture<HeathrowImportResult> heathrowFuture =
       CompletableFuture.supplyAsync(() -> heathrowService.run(), executor);
   CompletableFuture.allOf(assetsFuture, heathrowFuture).join();
   ```

2. **SAVEPOINT wrapping:** Steps 1 and 3 (Heathrow) must issue `SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE SAVEPOINT` around each insert that can produce a 23505. Use `JdbcTemplate.execute(sql)` directly — Spring's `@Transactional` does not expose savepoint management at the method level cleanly.

3. **Token injection:** The TypeScript importers temporarily write `MONDAY_API_TOKEN` to `process.env` because the shared client reads it from env. In Spring Boot, inject `MondayApiClient` as a Spring bean pre-configured with the token — no env mutation needed.

4. **Pre-resolve locations for Step 4:** Load `SELECT id, monday_item_id FROM locations WHERE monday_item_id IS NOT NULL` once before the Step 4 loop, not per hotel. The Step 1–3 inserts will have committed to the same transaction by then.

5. **TRUNCATE requires its own transaction:** `TRUNCATE` acquires an ACCESS EXCLUSIVE lock that conflicts with concurrent SELECT queries. Wrap TRUNCATE + bulk INSERT in `@Transactional(propagation = REQUIRES_NEW)` so the lock is held for the minimum duration. Bulk INSERT should batch at 500 rows (safe for persistent pool) — not 20 (the Neon serverless limit).

6. **`normaliseName` consistency:** The Java implementation of `normaliseName` must produce exactly the same output as the TypeScript version, because `normalised_name` values inserted by the TypeScript importer (in existing prod data) will be compared against Java-computed values. Test with the known set: `"Hilton London Paddington Hotel"` → `"hilton london paddington hotel"`.

---

## D18. Cache Invalidation and Kafka Events

### Redis cache invalidation

After every successful import, invalidate all analytics query caches:

```java
// Pattern-delete all analytics keys (Spring Data Redis)
redisTemplate.keys("analytics:*").forEach(redisTemplate::delete);
```

This forces all analytics queries to re-execute against the updated `locations`, `kiosks`, and `location_products` tables on the next request.

### Kafka event (cross-service sync)

After the advisory lock is released, publish:

```json
{
  "topic": "monday.import.completed",
  "key": "{importRunId}",
  "value": {
    "importRunId": "uuid",
    "triggeredBy": "userId",
    "completedAt": "2026-05-25T16:45:00Z",
    "step1": { "locationsInserted": 42, "locationsSkippedExisting": 280, ... },
    "step2": { "kiosksInserted": 12, "assignmentsInserted": 12, ... },
    "step3": { "liveLocationsInserted": 3, "kiosksInserted": 6, ... },
    "step4": { "rowsInserted": 1840, "placeholdersCreated": 5, ... }
  }
}
```

The kiosk-service (or any other subscriber) can consume this event to sync its own `Country → Region → City → Location → Kiosk` hierarchy from the analytics-service's updated data without requiring direct DB sharing or synchronous gRPC calls.

---

## D19. gRPC and REST — Monday Import Endpoints

### Add to `EtlService` proto (or a new `MondayService`)

```protobuf
service EtlService {
  // ... existing Azure ETL RPCs ...

  // Trigger the full 4-step Monday import (admin-only).
  rpc TriggerMondayImport (TriggerMondayImportRequest)
      returns (TriggerMondayImportResponse);

  // Dry-run: fetch from Monday and compute same-name warnings, no DB writes.
  rpc DryRunMondayImport (TriggerMondayImportRequest)
      returns (TriggerMondayImportResponse);
}

message TriggerMondayImportRequest {
  // empty — auth enforced via x-user-role metadata
}

message TriggerMondayImportResponse {
  string status                     = 1;  // "ok" | "lock_contention" | "missing_token"
  int32  locations_inserted         = 2;
  int32  locations_skipped_existing = 3;
  int32  kiosks_inserted            = 4;
  int32  assignments_inserted       = 5;
  int32  location_products_inserted = 6;
  int32  placeholders_created       = 7;
  repeated string placeholder_names = 8;
  int32  hotels_skipped             = 9;
  int32  same_name_warnings         = 10;
  int64  duration_ms                = 11;
  repeated string unmapped_group_titles = 12;
}
```

### REST endpoints (api-gateway controller additions)

```
POST /api/v1/command-centre/monday/trigger
     Body: {} (empty)
     → TriggerMondayImportResponse
     gRPC: EtlService.TriggerMondayImport
     Requires: admin role. HTTP 403 for non-admin.
     HTTP 409 if advisory lock already held.
     HTTP 503 if MONDAY_API_TOKEN is not configured.

POST /api/v1/command-centre/monday/dry-run
     Body: {} (empty)
     → TriggerMondayImportResponse  (rowsInserted=0, sameNameWarnings populated)
     gRPC: EtlService.DryRunMondayImport
     Requires: admin role.
```

---

## D20. Non-Obvious Gotchas

| # | Gotcha | Detail |
|---|---|---|
| 1 | `MirrorValue` requires typed fragment | `mirror3__1` and `mirror9` return `null` for the standard `text` field. **You must include `... on MirrorValue { display_value }` in the fragment** or you get empty customer codes and outlet codes with no error. |
| 2 | `mirror3__1` dedupes comma-repeated codes | Multi-kiosk hotels produce `"2357, 2357"` because the mirror aggregates one row per kiosk. Deduplicate before comparing to the partial unique on `(region_id, customer_code)`. |
| 3 | Mirror9 is telemetry only post-07-06 | Step 4 resolves locations via `mondayItemId`, NOT via mirror9 outlet codes. Mirror9 outlet codes are read and counted for operator visibility but not used as the resolution key. Using mirror9 as a lookup key was the pre-07-06 design — don't recreate it. |
| 4 | SAVEPOINT is mandatory with 23505 inside a transaction | A PostgreSQL transaction that sees a 23505 is in `error` state. All subsequent queries fail with `ERROR: current transaction is aborted`. Steps 1 and 3 must use explicit SAVEPOINT/ROLLBACK TO SAVEPOINT around each insert. |
| 5 | Heathrow slash-codes | `"H9/9H"` must split on `/` as well as `,`. The dedup key includes the individual code: `"HEATHROW-{itemId}-H9"` and `"HEATHROW-{itemId}-9H"` are two distinct kiosks. |
| 6 | `BOARD_REGION` intentionally excludes Live Estate | Live Estate is a mixed-region board. The `BOARD_REGION` map has no entry for board `1356570756` by design. Defaulting to `"UK"` was the pre-07-06 bug (audit D5 Parts A+B mis-attributed hotels). When a placeholder is needed for a Live Estate hotel, the import skips it and increments `placeholdersSkippedNoRegion`. |
| 7 | TRUNCATE CASCADE scope | `TRUNCATE location_products CASCADE` will cascade to any table with a FK pointing at `location_products`. Verify no other table has such a FK before running. If `commission_ledger` ever gains a `location_product_id` column, this will wipe ledger rows. Guard with a pre-TRUNCATE count assertion. |
| 8 | `commissionTiers.effectiveFrom = "2020-01-01"` is backdated intentionally | The hard-coded date predates all historical sales data so the single flat-rate tier applies to all records regardless of when they were imported. Do not use the current date here. |
| 9 | `BoardRelationValue` JSON shape | `linked_item_ids` is only available via the typed fragment `... on BoardRelationValue { linked_item_ids }`. Without it, `text` and `value` on the column are both null or contain a human-readable label, not the raw item id. |
| 10 | Step 4 must run AFTER Steps 1–3 | The `locMapByMondayId` lookup in Step 4 requires `locations.monday_item_id` to be populated. Running Step 4 concurrently with Steps 1–3 means some hotels won't be found and will be counted as `hotelsSkipped` even though they're being inserted in parallel. |
| 11 | `normaliseName` must match the TypeScript output exactly | Existing prod `locations.normalised_name` values were written by the TypeScript `normaliseName` function. If the Java implementation differs (e.g. different Unicode handling, different punctuation stripping) the partial unique on `normalised_name` will produce false conflicts or false non-conflicts. Test against known hotel names including accented characters (`"Radisson Blu Gdańsk"` etc.). |
| 12 | Advisory lock key is different from Azure ETL | Azure ETL uses `738294105`, Monday import uses `738294106`. Using the same key would prevent both jobs from running simultaneously — unnecessary. Using different keys lets an operator trigger Monday import while the ETL is running. |
| 13 | Same-name warning pre-check always runs | The `sameNameWarnings` computation runs before the TRUNCATE in Step 4, even in non-dry-run mode. It is a cheap read-only SELECT followed by in-memory comparison. The warning list is returned in the result regardless of mode — callers log it but don't treat it as an error. |
| 14 | Unmapped group titles capped at 50 | `unmappedHotelMondayIds` in the Assets import result and `unmappedGroupTitles` in hotel/Heathrow results are capped at 50 entries. This is diagnostic output — the full list is not returned to avoid flooding the API response with hundreds of strings. |
