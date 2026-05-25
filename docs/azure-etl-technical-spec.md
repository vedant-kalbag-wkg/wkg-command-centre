# Azure Sales ETL — Technical Specification

> Source codebase: `wkg-command-centre` (Next.js/TypeScript/Drizzle ORM on Neon PostgreSQL)
> Target: Java Spring Boot + PostgreSQL + Redis + Kafka
> Written: 2026-05-25

---

## 1. System Overview

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

## 2. High-Level Pipeline Flow

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

## 3. Concurrency Control

### PostgreSQL Advisory Lock

- **Lock key:** `738_294_105` (integer constant)
- **Function:** `pg_try_advisory_lock` — non-blocking; returns immediately with false if held
- **Scope:** session-scoped; auto-released if the connection drops (no leak risk)
- **Purpose:** Only one ETL run active per database at a time — prevents cron overlap and manual kick-off races

**Spring Boot equivalent:** Use a `ShedLock` table (or Redis `SET NX PX`) to replicate this. If using PostgreSQL advisory locks directly, use `DataSourceUtils.getConnection()` to get a persistent connection and call `pg_try_advisory_lock` via JDBC, then release in a `finally` block.

---

## 4. Environment Variables

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

## 5. Azure Blob Storage Layout

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

## 6. CSV Format and Parsing

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

## 7. Dimension Resolution

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

## 8. Staging Phase

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

## 9. FX Rate System

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
  return { rate: 1.0, staleDays: 0 }  -- no DB query (D-04)

SELECT * FROM exchange_rates
WHERE currency = ? AND rate_date <= ?   -- carry-forward (D-05)
ORDER BY rate_date DESC LIMIT 1

if no row:
  return null  -- caller hard-fails (D-03)

staleDays = days(isoDate - row.rate_date)  -- pure string arithmetic

return { rate, rateDate, staleDays }
```

### Staleness rules

- `staleDays > 7` → ETL hard-fails the blob
- Before committing, ETL does a **pre-check** on all distinct `(currency, date)` pairs from staged rows
- If stale pair found: emit `fx_rate_stale` email alert via Inngest → fail the blob
- Inside the commit transaction: per-chunk rate check repeats this (D-07 double-gate)

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

## 10. Reversal Matching

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

## 11. Commit Phase

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

## 12. Idempotency

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

## 13. Commission Calculation (Post-Commit)

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

## 14. Email Alerts

The ETL sends email alerts via an **Inngest event** (`email/send.requested`). The `send-email` Inngest function handles this event and delivers the email via **Resend** (HTTP API, not SMTP). The function has `retries: 5` with Inngest's exponential backoff.

### Alert types relevant to ETL

| `kind` | Trigger | Subject |
|---|---|---|
| `fx_rate_stale` | `staleDays > 7` for any `(currency, date)` in a blob | `Sales ETL halted: stale FX rate for {currency}` |
| `fx_rate_fetch_failed` | BoE HTTP/parse error in daily cron | `FX rates daily fetch failed ({isoDate})` |

Both use `template: "plain-text"` — they bypass React email templates entirely and render as `<pre>` HTML + plain text. The `send-email` function dispatches on `kind` to pick the text body.

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

## 15. Audit Trail

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

## 16. Import Abandonment

`_cancelImportForActor` abandons a staged import without committing:

1. Deletes all `import_stagings` rows for the import
2. Sets `sales_imports.status = 'failed'`
3. Writes an `audit_logs` entry with `action = 'cancel'`

**Critically: the `sales_imports` row itself is NOT deleted.** Its `source_hash` is retained, so re-uploading identical bytes is permanently blocked (same error as a duplicate import). To retry after a cancellation the operator must modify the file so its SHA-256 changes.

---

## 17. Fee Code Fallback Propagation

`updateFeeCodeFallback(db, actor, productName, newCode)` atomically propagates a `product_code_fallbacks` edit in a single transaction:

1. Update `product_code_fallbacks.netsuite_code` for the given `product_name`
2. Update `products.netsuite_code` where `name = productName AND netsuite_code = oldCode`
   - If 0 rows updated AND a product with that name exists with a different code → **throw drift error** (manual reconciliation required before update is allowed)
3. Update ALL `sales_records.netsuite_code = newCode WHERE netsuite_code = oldCode` — no `product_id` filter, because the unique constraint on `products.netsuite_code` means one code maps to at most one product; filtering by `product_id` would miss historical rows whose `product_id` drifted from the code's current owner
4. Write a single `audit_logs` entry with `metadata: { updatedProducts, updatedSalesRecords }`

**In Spring Boot:** this must remain in one transaction. The sales_records UPDATE could affect millions of rows on a long-running instance — consider running it as a background job with progress tracking rather than a synchronous HTTP response.

---

## 18. ETL System Actor

A fixed synthetic user represents the ETL pipeline for audit logging:

```
id:   "00000000-0000-0000-0000-000000000001"
name: "Azure ETL"
```

This UUID is seeded by migration `0018`. A matching row must exist in the `user` table (not just referenced in audit logs) because `sales_imports.uploaded_by` is a FK to `user.id`. When recreating the schema, seed this row in Flyway before any ETL run.

---

## 19. Complete Database Schema (ETL-relevant tables)

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

## 21. Spring Boot Architecture Recommendation

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

## 22. Data Flow Summary Diagram

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

## 23. Non-Obvious Gotchas

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
| 9 | Dead BK BoE series | Many `XUDLBK*` series are ERIs (indices), not spot rates. Only the verified `XUDL*S` codes listed above are safe. |
| 10 | Stale-rate pre-check | The pre-check on staging JSONB runs before the commit transaction. It exists to send a named-currency alert; the commit-phase check is the actual enforcement gate. Both are needed. |
| 11 | Orphan refunds | Unmatched refunds are valid and committed. `original_record_id = NULL` with `is_reversal = true` is a queryable pattern in analytics. |
| 12 | `source_hash` deduplication | Same bytes = rejected even if the prior import failed OR was cancelled. `_cancelImportForActor` deletes staging rows but keeps the `sales_imports` row (and its `source_hash`). The operator must modify the file to retry. |
| 13 | `FX_ALERT_TO` is pre-lock | `getFxAlertRecipient()` is called before `withAdvisoryLock`. An unset env var aborts the entire run before the lock is acquired. It must be configured in all environments where the ETL runs, including CI/staging. |
| 14 | `commissionableAmount == grossAmount` | The commission engine signature has a `bookingFee` parameter but it is currently ignored (`_bookingFee` prefix, value `0`). The ledger's `commissionable_amount` equals `net_amount_gbp` for all current records. |
| 15 | Email provider is Resend | The notification system uses the Resend API (HTTP), not SMTP/SES/JavaMailSender. The `email_log.payload_hash` partial unique index deduplicates across Inngest retries — implement the same dedup logic in Spring Boot to avoid alert spam on retry. |
| 16 | Audit log uses text `entity_id` | `audit_logs.entity_id` is `text`, not `uuid`, because Better Auth user IDs are 32-char random strings (not UUIDs). Do not declare it as `UUID` type in JPA — it will reject auth-related audit rows. |
