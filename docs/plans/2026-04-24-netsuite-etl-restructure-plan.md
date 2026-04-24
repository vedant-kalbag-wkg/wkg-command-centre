# NetSuite ETL Restructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the manual wide-format sales CSV import with a region-aware, Azure-Blob-sourced ETL that ingests the lean 22-column NetSuite export, and rebuild the `salesRecords` schema around net/VAT measures with proper region-scoped outlet codes.

**Architecture:** Platform-agnostic core (`runAzureEtl`) called by two thin entrypoints (CLI + HTTP), Postgres advisory lock for concurrency, `sales_blob_ingestions(regionId, blobPath)` for idempotency, `DefaultAzureCredential` with connection-string fallback for auth. Schema uses FK-based regions (`regions.id`) so code/azureCode edits don't require data backfill; denormalised fee codes on `salesRecords` get backfilled via explicit helper on config edit.

**Tech Stack:** Next.js 15, Drizzle ORM, Postgres, `@azure/storage-blob`, `@azure/identity`, Papaparse, Vitest (unit + integration via Testcontainers), Playwright.

**Source-of-truth design doc:** `docs/plans/2026-04-24-netsuite-etl-restructure-design.md` — use for any schema ambiguity.

---

## Prerequisites

Before starting:

1. Current branch is `fix/maturity-buckets-end-date`. Verify: `git branch --show-current` prints that.
2. `.env.local` has a valid `DATABASE_URL` (local Postgres).
3. Design doc read end-to-end: `docs/plans/2026-04-24-netsuite-etl-restructure-design.md`.
4. Sample CSV available at repo root: `WKG_NETSUITE_VK.csv` (37-col NetSuite export, Jan 2026, GB region).
5. `@carl-rules`: absolute paths in code, batch independent tool calls, validate before marking tasks complete.

Install new deps once, before Phase 4:
```bash
npm install @azure/storage-blob @azure/identity
```

---

## Phase 1 — Schema migration

One Drizzle-generated migration SQL + one hand-written companion for data backfill + check constraints. The wipe happens here so downstream phases work on a clean slate.

### Task 1: Update `regions` schema (add `azureCode`, make `code` unique)

**Files:**
- Modify: `src/db/schema.ts:450-457` — `regions` table definition.

**Step 1:** Edit the `regions` table:

```ts
export const regions = pgTable("regions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),                 // was nullable/non-unique
  azureCode: text("azure_code").unique(),                // NEW — nullable
  marketId: uuid("market_id").references(() => markets.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by").references(() => user.id),
});
```

**Step 2:** Don't generate the migration yet — Task 6 consolidates all schema edits into one drizzle-kit run.

### Task 2: Update `locations` schema (add `primaryRegionId`, drop global-unique `outletCode`, drop `region`)

**Files:**
- Modify: `src/db/schema.ts:140-188` — `locations` table.

**Step 1:** Edit the `locations` table. Remove the `region` column and the global-unique constraint on `outletCode`; add `primaryRegionId` and the composite unique:

```ts
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // ...all existing columns stay...
    outletCode: text("outlet_code").notNull(),                            // was .unique()
    primaryRegionId: uuid("primary_region_id")                            // NEW
      .notNull()
      .references(() => regions.id),
    // DROPPED: region (free-text) — replaced by primaryRegionId
    // ...rest of existing columns...
  },
  (t) => ({
    outletRegionUniq: unique("locations_region_outlet_unique").on(
      t.primaryRegionId,
      t.outletCode,
    ),
  }),
);
```

**Step 2:** Grep for any code referencing `locations.region` that would break:

```bash
grep -rn "locations\.region\b\|\.region\s*:" src/ | grep -v "regionGroup\|regionId"
```

Note everything that needs updating — callers must switch to `primaryRegionId` or derive region via the `regions` FK. Defer fixes to Phase 9 (UI cleanup); for now the schema change breaks them, which is what we want for compile-time pressure.

### Task 3: Update `products` schema (add NetSuite columns)

**Files:**
- Modify: `src/db/schema.ts` — `products` table.

**Step 1:** Locate the `products` table and add three columns:

```ts
// inside the products pgTable definition:
netsuiteCode: text("netsuite_code").unique(),   // NEW — nullable; dimension resolver's preferred key
categoryCode: text("category_code"),            // NEW
categoryName: text("category_name"),            // NEW
```

### Task 4: Rewrite `salesRecords` schema

**Files:**
- Modify: `src/db/schema.ts:577-609`.

**Step 1:** Replace the whole `salesRecords` definition with:

```ts
export const salesRecords = pgTable(
  "sales_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id").references(() => salesImports.id, { onDelete: "set null" }),
    regionId: uuid("region_id").notNull().references(() => regions.id),
    saleRef: text("sale_ref").notNull(),            // basket ID
    refNo: text("ref_no").notNull(),                // line ID (may repeat for reversals)
    transactionDate: date("transaction_date").notNull(),
    transactionTime: time("transaction_time"),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    providerId: uuid("provider_id").references(() => providers.id),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
    currency: text("currency").notNull().default("GBP"),
    isBookingFee: boolean("is_booking_fee").notNull().default(false),
    netsuiteCode: text("netsuite_code").notNull(),
    agent: text("agent"),
    businessDivision: text("business_division"),
    categoryCode: text("category_code"),
    categoryName: text("category_name"),
    apiProductName: text("api_product_name"),
    city: text("city"),
    country: text("country"),
    customerCode: text("customer_code"),
    customerName: text("customer_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    regionDateIdx: index("sales_region_date_idx").on(t.regionId, t.transactionDate),
    regionRefNoIdx: index("sales_region_refno_idx").on(t.regionId, t.refNo),
    regionSaleRefIdx: index("sales_region_saleref_idx").on(t.regionId, t.saleRef),
    locDateIdx: index("sales_loc_date_idx").on(t.locationId, t.transactionDate),
    prodDateIdx: index("sales_prod_date_idx").on(t.productId, t.transactionDate),
    provDateIdx: index("sales_prov_date_idx").on(t.providerId, t.transactionDate),
    txnDateIdx: index("sales_txn_date_idx").on(t.transactionDate),
    // No natural unique — idempotency enforced at blob level.
  }),
);
```

**Removed fields:** `grossAmount`, `quantity`, `discountCode`, `discountAmount`, `bookingFee`, `saleCommission`, `unique(saleRef, transactionDate)`.

### Task 5: Add new tables (`sales_blob_ingestions`, `product_code_fallbacks`)

**Files:**
- Modify: `src/db/schema.ts` — append at end of the sales section (after `importStagings` block ~line 630).

**Step 1:** Add both tables:

```ts
export const salesBlobIngestions = pgTable(
  "sales_blob_ingestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id),
    blobPath: text("blob_path").notNull(),
    blobDate: date("blob_date").notNull(),
    etag: text("etag"),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
    importId: uuid("import_id").references(() => salesImports.id, { onDelete: "set null" }),
    status: text("status", { enum: ["success", "failed"] }).notNull(),
    errorMessage: text("error_message"),
  },
  (t) => ({
    regionBlobUniq: unique("sales_blob_ingestions_region_blob_unique").on(t.regionId, t.blobPath),
    byRegionDate: index("sales_blob_ingestions_region_date_idx").on(t.regionId, t.blobDate),
  }),
);

export const productCodeFallbacks = pgTable(
  "product_code_fallbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productName: text("product_name").notNull().unique(),
    netsuiteCode: text("netsuite_code").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);
```

### Task 6: Generate + author the migration SQL

**Files:**
- Run: `npx drizzle-kit generate` (will create `migrations/0018_*.sql`).
- Hand-edit: `migrations/0018_*.sql` to add backfill + check constraints + truncate.

**Step 1:** Generate:

```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool
npx drizzle-kit generate
```

**Step 2:** Open the new migration. Prepend a PRE-SCHEMA SECTION (before any of drizzle's generated DDL):

```sql
-- ============================================================================
-- PRE-SCHEMA: backfill + safety checks that must run before drizzle's DDL
-- ============================================================================

-- 1. Seed canonical regions if missing (no-ops if already present).
INSERT INTO regions (name, code)
VALUES
  ('United Kingdom', 'UK'),
  ('Ireland',        'IE'),
  ('Germany',        'DE'),
  ('Spain',          'ES'),
  ('Czech Republic', 'CZ')
ON CONFLICT (name) DO NOTHING;

-- 2. Safety gate: refuse to apply if any location can't be mapped to a region.
-- Locations carry a free-text `region` today; map via locationRegionMemberships
-- first, fall back to kiosks.regionGroup via kioskAssignments.
CREATE TEMP TABLE _loc_region_map AS
SELECT
  l.id AS location_id,
  COALESCE(
    (SELECT r.id FROM location_region_memberships lrm
       JOIN regions r ON r.id = lrm.region_id
      WHERE lrm.location_id = l.id LIMIT 1),
    (SELECT r.id FROM kiosk_assignments ka
       JOIN kiosks k ON k.id = ka.kiosk_id
       JOIN regions r ON r.code = CASE k.region_group
           WHEN 'UK'      THEN 'UK'
           WHEN 'Prague'  THEN 'CZ'
           WHEN 'Spain'   THEN 'ES'
           WHEN 'Germany' THEN 'DE'
           ELSE NULL END
      WHERE ka.location_id = l.id LIMIT 1)
  ) AS region_id
FROM locations l;

DO $$
DECLARE unresolved int;
BEGIN
  SELECT COUNT(*) INTO unresolved FROM _loc_region_map WHERE region_id IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION
      'Migration blocked: % locations cannot be mapped to a region. Resolve manually before re-running.',
      unresolved;
  END IF;
END$$;

-- 3. Wipe existing sales data — new schema is incompatible with old rows.
TRUNCATE TABLE sales_records, import_stagings, sales_imports, commission_ledger RESTART IDENTITY CASCADE;
```

**Step 3:** After drizzle's generated DDL, append a POST-SCHEMA SECTION:

```sql
-- ============================================================================
-- POST-SCHEMA: populate the new NOT NULL primary_region_id + seed fallbacks
-- ============================================================================

-- Populate locations.primary_region_id from the temp table computed above.
-- (The temp table lives for this transaction only.)
UPDATE locations
SET primary_region_id = m.region_id
FROM _loc_region_map m
WHERE locations.id = m.location_id;

-- Drop the free-text region column (replaced by primary_region_id FK).
ALTER TABLE locations DROP COLUMN IF EXISTS region;

-- Seed product_code_fallbacks for the known fee types.
INSERT INTO product_code_fallbacks (product_name, netsuite_code) VALUES
  ('Booking Fee',       '9991'),
  ('Cash Handling Fee', '9992')
ON CONFLICT (product_name) DO NOTHING;

-- Seed the ETL system actor (fixed UUID so tests and runtime agree).
INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Azure ETL',
  'etl-system@internal.weknowgroup.com',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Check constraints for text-enum columns (pattern matches 0008/0009 migrations).
ALTER TABLE sales_blob_ingestions
  ADD CONSTRAINT sales_blob_ingestions_status_check
  CHECK (status IN ('success', 'failed'));
```

**Step 4:** Dry-run the migration against a local test DB:

```bash
# Assumes a disposable local DB; DO NOT run against shared envs.
DATABASE_URL=postgresql://localhost:5432/wkg_test npx drizzle-kit migrate
```

Expected: clean apply, or a `RAISE EXCEPTION` listing unresolved locations (which tells you which Monday.com rows need fixing).

**Step 5:** Commit:

```bash
git add src/db/schema.ts migrations/0018_*.sql migrations/meta/
git commit -m "feat(schema): restructure salesRecords + add region-scoped outlet codes"
```

---

## Phase 2 — Parser rewrite

### Task 7: Write failing tests for new parser

**Files:**
- Modify: `src/lib/csv/sales-csv.test.ts` — rewrite entirely.

**Step 1:** Replace the test file with scenarios derived from the design:

```ts
import { describe, it, expect } from "vitest";
import { parseSalesCsv } from "./sales-csv";

const HEADER = [
  "Saleref", "Ref No", "Code", "Product Name", "Category Code", "Category Name",
  "agent", "Outlet Code", "Outlet Name", "Date", "Time", "Customer Code",
  "Customer Name", "supp_nam", "API Product Name", "City", "Country",
  "Business Division", "VAT Rate", "Net Amt", "VAT Amt", "Currency",
].join(",");

function csv(rows: string[][]) {
  return [HEADER, ...rows.map((r) => r.join(","))].join("\n");
}

const fallbacks = new Map([
  ["Booking Fee", "9991"],
  ["Cash Handling Fee", "9992"],
]);

describe("parseSalesCsv (NetSuite format)", () => {
  it("parses a principal row end-to-end", () => {
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","0:02:23","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.totalRows).toBe(1);
    expect(res.validCount).toBe(1);
    const p = res.rows[0].parsed!;
    expect(p.saleRef).toBe("5578141");
    expect(p.refNo).toBe("Q5A4558585");
    expect(p.netsuiteCode).toBe("4603");
    expect(p.transactionDate).toBe("2026-01-01");
    expect(p.netAmount).toBe("12.48");
    expect(p.vatAmount).toBe("2.5");
    expect(p.isBookingFee).toBe(false);
  });

  it("uses fee-code fallback when Code is empty for a Booking Fee row", () => {
    const text = csv([[
      "5578141","Q5A4558585-b","","Booking Fee","TRNSCAR","Transfers - Cars",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","2.24","0.45","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.netsuiteCode).toBe("9991");
    expect(res.rows[0].parsed?.isBookingFee).toBe(true);
  });

  it("uses fallback for Cash Handling Fee", () => {
    const text = csv([[
      "5578141","X-c","","Cash Handling Fee","TRNSCAR","Fees",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","0.10","0.02","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.netsuiteCode).toBe("9992");
    expect(res.rows[0].parsed?.isBookingFee).toBe(false);
  });

  it("rejects a row with empty Code and unknown Product Name", () => {
    const text = csv([[
      "5578141","X","","Unknown Product","TRNSCAR","X",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","1.00","0.20","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(0);
    expect(res.rows[0].errors.some((e) => e.field === "netsuiteCode")).toBe(true);
  });

  it("accepts negative Net Amt and VAT Amt (reversal rows)", () => {
    const text = csv([[
      "5578165","2XA4558609","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","2X","Some Hotel","1-Jan-26","","2620",
      "Some Hotel","Uber API","UberX","London","GB",
      "UberSSM","20","-34.09","-6.82","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(1);
    expect(res.rows[0].parsed?.netAmount).toBe("-34.09");
    expect(res.rows[0].parsed?.vatAmount).toBe("-6.82");
  });

  it("uses Date column (not Din) as transactionDate", () => {
    // Put a "Din" column in the raw CSV to verify it's ignored (it won't even
    // be in HEADER, but this documents the property).
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","2026-01-15","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.transactionDate).toBe("2026-01-15");
  });

  it("treats NULL-string cells as absent (NetSuite convention)", () => {
    const text = csv([[
      "5578141","Q5A4558585-b","","Booking Fee","NULL","NULL",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","NULL","2580",
      "Staycity Greenwich","NULL","NULL","London","GB",
      "UberSSM","20","2.24","0.45","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(1);
    expect(res.rows[0].parsed?.transactionTime).toBeNull();
    expect(res.rows[0].parsed?.providerName).toBeNull();
    expect(res.rows[0].parsed?.apiProductName).toBeNull();
    expect(res.rows[0].parsed?.categoryCode).toBeNull();
  });

  it("emits validation errors for missing Ref No / Outlet Code / Date", () => {
    const text = csv([[
      "5578141","","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","","Staycity Greenwich","","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    const fields = res.rows[0].errors.map((e) => e.field);
    expect(fields).toContain("refNo");
    expect(fields).toContain("outletCode");
    expect(fields).toContain("transactionDate");
  });
});
```

**Step 2:** Run the tests — expect ALL FAIL (old parser doesn't match new contract):

```bash
npx vitest run src/lib/csv/sales-csv.test.ts
```

### Task 8: Rewrite parser to pass the tests

**Files:**
- Modify: `src/lib/csv/sales-csv.ts` — rewrite entirely.

**Step 1:** Replace the file with:

```ts
import { createHash } from "node:crypto";
import Papa from "papaparse";

export type ParsedSalesRow = {
  saleRef: string;
  refNo: string;
  netsuiteCode: string;
  productName: string;
  categoryCode: string | null;
  categoryName: string | null;
  agent: string | null;
  outletCode: string;
  outletName: string | null;
  transactionDate: string;
  transactionTime: string | null;
  customerCode: string | null;
  customerName: string | null;
  providerName: string | null;
  apiProductName: string | null;
  city: string | null;
  country: string | null;
  businessDivision: string | null;
  vatRate: string | null;
  netAmount: string;
  vatAmount: string;
  currency: string;
  isBookingFee: boolean;
};

export type RowValidationError = { field: string; message: string };

export type ParseResult = {
  rows: Array<{
    rowNumber: number;
    raw: Record<string, string>;
    parsed: ParsedSalesRow | null;
    errors: RowValidationError[];
  }>;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  totalRows: number;
  validCount: number;
  invalidCount: number;
};

export type ParseOptions = { feeCodeFallbacks: Map<string, string> };

const HEADER_MAP: Record<string, keyof ParsedSalesRow | "ignore"> = {
  saleref: "saleRef",
  refno: "refNo",
  code: "netsuiteCode",
  productname: "productName",
  categorycode: "categoryCode",
  categoryname: "categoryName",
  agent: "agent",
  outletcode: "outletCode",
  outletname: "outletName",
  date: "transactionDate",
  time: "transactionTime",
  customercode: "customerCode",
  customername: "customerName",
  suppnam: "providerName",
  apiproductname: "apiProductName",
  city: "city",
  country: "country",
  businessdivision: "businessDivision",
  vatrate: "vatRate",
  netamt: "netAmount",
  vatamt: "vatAmount",
  currency: "currency",
};

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function canonicalizeHeader(h: string): keyof ParsedSalesRow | "ignore" | undefined {
  const key = h.trim().toLowerCase().replace(/[_\s]/g, "");
  return HEADER_MAP[key];
}

function isAbsent(s: string | undefined): boolean {
  if (s === undefined) return true;
  const t = s.trim();
  return t === "" || t.toUpperCase() === "NULL";
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "NULL") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
  }
  const ddMonYy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
  if (ddMonYy) {
    const [, d, monRaw, yy] = ddMonYy;
    const mm = MONTH_ABBR[monRaw.toLowerCase()];
    if (!mm) return null;
    return `${2000 + Number(yy)}-${mm}-${d.padStart(2, "0")}`;
  }
  return null;
}

function parseTime(raw: string): string | null {
  if (isAbsent(raw)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [, h, mm, ss] = m;
  const H = h.padStart(2, "0");
  if (+H > 23 || +mm > 59 || (ss !== undefined && +ss > 59)) return null;
  return `${H}:${mm}:${ss ?? "00"}`;
}

function parseSignedDecimal(raw: string): { ok: true; value: string } | { ok: false } | { ok: "empty" } {
  if (isAbsent(raw)) return { ok: "empty" };
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function optText(v: string | undefined): string | null {
  return isAbsent(v) ? null : (v as string).trim();
}

export function parseSalesCsv(text: string, opts: ParseOptions): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const rows: ParseResult["rows"] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    const errors: RowValidationError[] = [];
    const canonical: Partial<Record<keyof ParsedSalesRow, string>> = {};

    for (const [k, v] of Object.entries(raw)) {
      const field = canonicalizeHeader(k);
      if (field && field !== "ignore") {
        canonical[field] = (v ?? "").toString();
      }
    }

    // Required strings
    const saleRef = (canonical.saleRef ?? "").trim();
    if (!saleRef) errors.push({ field: "saleRef", message: "saleRef is required" });
    const refNo = (canonical.refNo ?? "").trim();
    if (!refNo) errors.push({ field: "refNo", message: "refNo is required" });
    const outletCode = (canonical.outletCode ?? "").trim();
    if (!outletCode) errors.push({ field: "outletCode", message: "outletCode is required" });
    const productName = (canonical.productName ?? "").trim();
    if (!productName) errors.push({ field: "productName", message: "productName is required" });

    // netsuiteCode with fallback
    let netsuiteCode = (canonical.netsuiteCode ?? "").trim();
    if (isAbsent(netsuiteCode)) {
      const fallback = opts.feeCodeFallbacks.get(productName);
      if (fallback) netsuiteCode = fallback;
      else errors.push({ field: "netsuiteCode", message: `Code is required and no fallback configured for Product Name '${productName}'` });
    }

    const isBookingFee = productName === "Booking Fee";

    const transactionDate = parseDate(canonical.transactionDate ?? "");
    if (!transactionDate) errors.push({ field: "transactionDate", message: "transactionDate (Date column) is missing or unparseable" });

    const rawTime = canonical.transactionTime ?? "";
    const transactionTime = parseTime(rawTime);
    if (!isAbsent(rawTime) && !transactionTime) {
      errors.push({ field: "transactionTime", message: "transactionTime is not a valid HH:MM[:SS]" });
    }

    // Required signed decimals
    const netRes = parseSignedDecimal(canonical.netAmount ?? "");
    let netAmount = "";
    if (netRes.ok === "empty") errors.push({ field: "netAmount", message: "netAmount is required" });
    else if (netRes.ok === false) errors.push({ field: "netAmount", message: "netAmount is not a valid number" });
    else netAmount = netRes.value;

    const vatRes = parseSignedDecimal(canonical.vatAmount ?? "");
    let vatAmount = "";
    if (vatRes.ok === "empty") errors.push({ field: "vatAmount", message: "vatAmount is required" });
    else if (vatRes.ok === false) errors.push({ field: "vatAmount", message: "vatAmount is not a valid number" });
    else vatAmount = vatRes.value;

    // Optional signed decimal
    const vatRateRes = parseSignedDecimal(canonical.vatRate ?? "");
    const vatRate = vatRateRes.ok === true ? vatRateRes.value : null;
    if (vatRateRes.ok === false) errors.push({ field: "vatRate", message: "vatRate is not a valid number" });

    const currency = ((canonical.currency ?? "").trim() || "GBP").toUpperCase();

    const row: ParseResult["rows"][number] = { rowNumber: i + 1, raw, parsed: null, errors };

    if (errors.length === 0 && transactionDate) {
      row.parsed = {
        saleRef,
        refNo,
        netsuiteCode,
        productName,
        categoryCode: optText(canonical.categoryCode),
        categoryName: optText(canonical.categoryName),
        agent: optText(canonical.agent),
        outletCode,
        outletName: optText(canonical.outletName),
        transactionDate,
        transactionTime,
        customerCode: optText(canonical.customerCode),
        customerName: optText(canonical.customerName),
        providerName: optText(canonical.providerName),
        apiProductName: optText(canonical.apiProductName),
        city: optText(canonical.city),
        country: optText(canonical.country),
        businessDivision: optText(canonical.businessDivision),
        vatRate,
        netAmount,
        vatAmount,
        currency,
        isBookingFee,
      };
      validCount++;
      if (minDate === null || transactionDate < minDate) minDate = transactionDate;
      if (maxDate === null || transactionDate > maxDate) maxDate = transactionDate;
    } else {
      invalidCount++;
    }

    rows.push(row);
  }

  return { rows, dateRangeStart: minDate, dateRangeEnd: maxDate, totalRows: rows.length, validCount, invalidCount };
}

export function computeSourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

**Step 2:** Run tests — expect all green:

```bash
npx vitest run src/lib/csv/sales-csv.test.ts
```

**Step 3:** Commit:

```bash
git add src/lib/csv/sales-csv.ts src/lib/csv/sales-csv.test.ts
git commit -m "feat(csv): rewrite sales parser for 22-column NetSuite format"
```

---

## Phase 3 — Dimension resolver

### Task 9: Update resolver tests for region scoping

**Files:**
- Modify: `src/lib/csv/dimension-resolver.ts` (reference only).
- Create: `src/lib/csv/dimension-resolver.test.ts` (if absent; otherwise extend).

**Step 1:** Read the current resolver to understand its signature:

```bash
cat src/lib/csv/dimension-resolver.ts
```

**Step 2:** Write tests in `src/lib/csv/dimension-resolver.test.ts`. The resolver needs to accept a `regionId` and scope outlet lookups by it. Cover:

- Same `outletCode` in two different regions → different `locationId`.
- Product resolution prefers `netsuiteCode` over `productName`.
- Provider auto-create by `supp_nam` still works.
- Unknown outlet returns a validation error mentioning the region.

Because the resolver hits the DB, these are **integration** tests (`*.integration.test.ts`) using the existing Testcontainers setup. Model the pattern off any existing `*.integration.test.ts` in `tests/`.

**Step 3:** Run and expect failures:

```bash
npx vitest run --project integration
```

### Task 10: Update resolver implementation

**Files:**
- Modify: `src/lib/csv/dimension-resolver.ts`.

**Step 1:** Change the signature:

```ts
export type DimensionInput = {
  rowNumber: number;
  outletCode: string;
  productName: string;
  netsuiteCode: string;         // NEW — preferred key for product resolution
  categoryCode: string | null;
  categoryName: string | null;
  apiProductName: string | null;
  providerName: string | null;
};

export type ResolveOptions = { regionId: string };

export async function resolveDimensions(
  db: AnyDb,
  rows: DimensionInput[],
  opts: ResolveOptions,
): Promise<ResolveResult[]>;
```

**Step 2:** Inside the implementation:
- Outlet query changes to `WHERE primary_region_id = $regionId AND outlet_code = $code`.
- Product resolver first tries `WHERE netsuite_code = $code`; if not found, falls back to `WHERE name = $productName`. On match, updates `categoryCode/categoryName/apiProductName` if null. Auto-creates with all fields populated if neither match.
- Provider resolver stays essentially the same (auto-create by `supp_nam`).
- The error for unknown outlet becomes `Unknown outletCode '<X>' for region <regionId>`.

**Step 3:** Run tests green:

```bash
npx vitest run --project integration src/lib/csv/dimension-resolver.integration.test.ts
```

**Step 4:** Commit:

```bash
git add src/lib/csv/dimension-resolver.ts src/lib/csv/dimension-resolver.integration.test.ts
git commit -m "feat(csv): region-scope outlet resolution + prefer netsuiteCode for products"
```

---

## Phase 4 — Azure Blob source

### Task 11: Install Azure SDKs

**Step 1:**

```bash
cd /Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool
npm install @azure/storage-blob @azure/identity
```

**Step 2:** Confirm:

```bash
grep -E "@azure/storage-blob|@azure/identity" package.json
```

### Task 12: Write `azure-client.ts` auth factory

**Files:**
- Create: `src/lib/sales/azure-client.ts`.
- Create: `src/lib/sales/azure-client.test.ts`.

**Step 1:** Test file — stub env vars, assert the right path is chosen:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getAzureBlobClient", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_URL;
  });

  it("uses connection string when provided", async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
    const { getAzureBlobClient } = await import("./azure-client");
    const client = getAzureBlobClient();
    expect(client).toBeDefined();
  });

  it("uses DefaultAzureCredential when AZURE_STORAGE_ACCOUNT_URL is set", async () => {
    process.env.AZURE_STORAGE_ACCOUNT_URL = "https://x.blob.core.windows.net";
    const { getAzureBlobClient } = await import("./azure-client");
    const client = getAzureBlobClient();
    expect(client).toBeDefined();
  });

  it("throws when neither env var is set", async () => {
    const { getAzureBlobClient } = await import("./azure-client");
    expect(() => getAzureBlobClient()).toThrow(/AZURE_STORAGE_CONNECTION_STRING/);
  });
});
```

**Step 2:** Implementation:

```ts
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

let cached: BlobServiceClient | null = null;

export function getAzureBlobClient(): BlobServiceClient {
  if (cached) return cached;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (conn) {
    cached = BlobServiceClient.fromConnectionString(conn);
    return cached;
  }
  const url = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (!url) {
    throw new Error(
      "Azure not configured: set AZURE_STORAGE_CONNECTION_STRING (dev) or AZURE_STORAGE_ACCOUNT_URL (prod)",
    );
  }
  cached = new BlobServiceClient(url, new DefaultAzureCredential());
  return cached;
}

export function resetAzureBlobClientCacheForTests(): void {
  cached = null;
}
```

**Step 3:** Run tests:

```bash
npx vitest run src/lib/sales/azure-client.test.ts
```

### Task 13: Write `azure-blob-source.ts`

**Files:**
- Create: `src/lib/sales/azure-blob-source.ts`.
- Create: `src/lib/sales/azure-blob-source.test.ts`.

**Step 1:** Test (uses a mock `BlobServiceClient` — no real Azure):

```ts
import { describe, it, expect } from "vitest";
import { AzureBlobSource } from "./azure-blob-source";

function mockClient(bytes: Buffer) {
  return {
    getContainerClient: () => ({
      getBlobClient: () => ({
        downloadToBuffer: async () => bytes,
        getProperties: async () => ({ etag: '"abc-123"' }),
      }),
    }),
  } as unknown as import("@azure/storage-blob").BlobServiceClient;
}

describe("AzureBlobSource", () => {
  it("pull() returns filename, sourceLabel, bytes, hash, etag", async () => {
    const bytes = Buffer.from("Saleref,Ref No\n1,X\n");
    const source = new AzureBlobSource({
      containerName: "clientdata",
      blobPath: "GB/2026/04/23/sales.csv",
      client: mockClient(bytes),
    });
    const r = await source.pull();
    expect(r.filename).toBe("sales.csv");
    expect(r.sourceLabel).toBe("azure:clientdata/GB/2026/04/23/sales.csv");
    expect(r.bytes).toHaveLength(bytes.length);
    expect(r.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.etag).toBe("abc-123"); // quotes stripped
  });
});
```

**Step 2:** Implementation:

```ts
import type { BlobServiceClient } from "@azure/storage-blob";
import { basename } from "node:path";
import { computeSourceHash } from "@/lib/csv/sales-csv";
import type { SalesDataSource, SalesSourcePullResult } from "./source";

export type AzureBlobSourceOptions = {
  containerName: string;
  blobPath: string;
  client: BlobServiceClient;
};

export type AzureBlobPullResult = SalesSourcePullResult & { etag: string | null };

export class AzureBlobSource implements SalesDataSource {
  constructor(private readonly opts: AzureBlobSourceOptions) {}

  async pull(): Promise<AzureBlobPullResult> {
    const container = this.opts.client.getContainerClient(this.opts.containerName);
    const blob = container.getBlobClient(this.opts.blobPath);
    const buffer = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    const bytes = new Uint8Array(buffer);
    const etag = (props.etag ?? "").replace(/^"|"$/g, "") || null;
    return {
      filename: basename(this.opts.blobPath),
      sourceLabel: `azure:${this.opts.containerName}/${this.opts.blobPath}`,
      sourceHash: computeSourceHash(bytes),
      bytes,
      etag,
    };
  }
}
```

**Step 3:** Extend `src/lib/sales/source.ts` to accept the widened result type (pull returns `SalesSourcePullResult` — `etag` is extra metadata that ETL cares about). Keep `SalesSourcePullResult` as the minimum contract; the ETL casts/reads `etag` off `AzureBlobPullResult` specifically.

**Step 4:** Run tests, commit:

```bash
npx vitest run src/lib/sales/azure-client.test.ts src/lib/sales/azure-blob-source.test.ts
git add src/lib/sales/azure-client.ts src/lib/sales/azure-blob-source.ts src/lib/sales/*.test.ts package.json package-lock.json
git commit -m "feat(sales): add AzureBlobSource + auth factory with DefaultAzureCredential fallback"
```

---

## Phase 5 — ETL orchestrator

### Task 14: Advisory lock helper

**Files:**
- Create: `src/lib/sales/etl/advisory-lock.ts`.
- Create: `src/lib/sales/etl/advisory-lock.test.ts`.

**Step 1:** Test:

```ts
// Integration: uses real pg to verify the lock keys.
// See existing *.integration.test.ts for the Testcontainers fixture pattern.
```

**Step 2:** Implementation:

```ts
import { sql } from "drizzle-orm";

export const ETL_AZURE_LOCK_KEY = 738_294_105; // arbitrary, unique within app

export async function withAdvisoryLock<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  key: number,
  fn: () => Promise<T>,
): Promise<T | { skipped: "lock-not-acquired" }> {
  const [{ acquired }] = await db.execute(
    sql`SELECT pg_try_advisory_lock(${key}) AS acquired`,
  );
  if (!acquired) return { skipped: "lock-not-acquired" as const };
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
  }
}
```

### Task 15: Extend pipeline helpers to accept `regionId`

**Files:**
- Modify: `src/app/(app)/settings/data-import/sales/pipeline.ts`.

**Step 1:** Add `regionId` to `_stageImportForActor` signature:

```ts
export async function _stageImportForActor(
  source: SalesDataSource,
  actor: ImportActor,
  db: AnyDb,
  opts: { regionId: string; feeCodeFallbacks: Map<string, string> },
): Promise<StageSummary>
```

**Step 2:** Thread `regionId` into:
- `parseSalesCsv(text, { feeCodeFallbacks: opts.feeCodeFallbacks })`
- `resolveDimensions(db, inputs, { regionId: opts.regionId })`
- Stored on `salesImports` (add a `regionId` column — mini-migration: add to schema + generate follow-up migration; include in the same 0018 migration if not yet committed, otherwise add 0019).
- Propagate through to `salesRecords.regionId` inside `_commitImportForActor`.

**Step 3:** Update existing callers of `_stageImportForActor`. There's currently one (the server action); update Phase 9 removes it. For now, pass `regionId` as required.

### Task 16: `runAzureEtl` orchestrator

**Files:**
- Create: `src/lib/sales/etl/azure-etl.ts`.
- Create: `src/lib/sales/etl/azure-etl.integration.test.ts`.

**Step 1:** Test skeleton (integration — real Postgres, mock blob client):

```ts
// Test outline:
// 1. Seed regions { code: 'UK', azureCode: 'GB' }.
// 2. Seed product_code_fallbacks.
// 3. Seed one location for (regionId=UK, outletCode='Q5').
// 4. Mock blob client listing one blob at clientdata/GB/2026/01/01/sales.csv.
// 5. Call runAzureEtl.
// 6. Assert:
//    - salesRecords has the expected rows.
//    - sales_blob_ingestions has 1 success row.
//    - Running again is a no-op (processedBlobs=0, skippedBlobs=1).
//    - A second blob with a parse error lands as sales_blob_ingestions.status='failed'
//      without blocking subsequent blobs.
```

**Step 2:** Implementation:

```ts
import { sql, eq, and } from "drizzle-orm";
import { regions, productCodeFallbacks, salesBlobIngestions } from "@/db/schema";
import { getAzureBlobClient } from "@/lib/sales/azure-client";
import { AzureBlobSource } from "@/lib/sales/azure-blob-source";
import { _stageImportForActor, _commitImportForActor } from "@/app/(app)/settings/data-import/sales/pipeline";
import { withAdvisoryLock, ETL_AZURE_LOCK_KEY } from "./advisory-lock";

const CONTAINER = process.env.AZURE_BLOB_CONTAINER ?? "clientdata";
const ETL_ACTOR = { id: "00000000-0000-0000-0000-000000000001", name: "Azure ETL" };

// Path pattern: {azureCode}/YYYY/MM/DD/<filename>.csv
const BLOB_PATH_RE = /^([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.csv$/;

export type EtlRunResult =
  | { status: "skipped-lock" }
  | {
      status: "ok";
      processed: Array<{ regionCode: string; blobPath: string; rows: number }>;
      skipped: Array<{ regionCode: string; blobPath: string }>;
      failed: Array<{ regionCode: string; blobPath: string; error: string }>;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAzureEtl(db: any): Promise<EtlRunResult> {
  const result = await withAdvisoryLock(db, ETL_AZURE_LOCK_KEY, async () => {
    const processed: Array<{ regionCode: string; blobPath: string; rows: number }> = [];
    const skipped: Array<{ regionCode: string; blobPath: string }> = [];
    const failed: Array<{ regionCode: string; blobPath: string; error: string }> = [];

    // Load configured regions (those with an azureCode set).
    const configuredRegions = await db
      .select({ id: regions.id, code: regions.code, azureCode: regions.azureCode })
      .from(regions)
      .where(sql`${regions.azureCode} IS NOT NULL`);

    // Load fee-code fallbacks into a Map.
    const fallbackRows = await db
      .select({ productName: productCodeFallbacks.productName, netsuiteCode: productCodeFallbacks.netsuiteCode })
      .from(productCodeFallbacks);
    const feeCodeFallbacks = new Map<string, string>(
      fallbackRows.map((r: { productName: string; netsuiteCode: string }) => [r.productName, r.netsuiteCode]),
    );

    const client = getAzureBlobClient();
    const container = client.getContainerClient(CONTAINER);

    for (const region of configuredRegions) {
      const prefix = `${region.azureCode}/`;
      for await (const item of container.listBlobsFlat({ prefix })) {
        if (!item.name.endsWith(".csv")) continue;
        const m = BLOB_PATH_RE.exec(item.name);
        if (!m) continue;
        const [, , yyyy, mm, dd] = m;
        const blobDate = `${yyyy}-${mm}-${dd}`;

        // Idempotency check.
        const existing = await db
          .select({ id: salesBlobIngestions.id })
          .from(salesBlobIngestions)
          .where(
            and(
              eq(salesBlobIngestions.regionId, region.id),
              eq(salesBlobIngestions.blobPath, item.name),
              eq(salesBlobIngestions.status, "success"),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          skipped.push({ regionCode: region.code, blobPath: item.name });
          continue;
        }

        try {
          const source = new AzureBlobSource({ containerName: CONTAINER, blobPath: item.name, client });
          const stage = await _stageImportForActor(source, ETL_ACTOR, db, {
            regionId: region.id,
            feeCodeFallbacks,
          });
          if (stage.invalidCount > 0) {
            throw new Error(
              `Validation failed: ${stage.invalidCount}/${stage.totalRows} rows invalid`,
            );
          }
          const commit = await _commitImportForActor(stage.importId, ETL_ACTOR, db);
          await db.insert(salesBlobIngestions).values({
            regionId: region.id,
            blobPath: item.name,
            blobDate,
            etag: (source as AzureBlobSource & { lastEtag?: string }).lastEtag ?? null,
            importId: stage.importId,
            status: "success" as const,
          });
          processed.push({ regionCode: region.code, blobPath: item.name, rows: commit.committedRows });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .insert(salesBlobIngestions)
            .values({ regionId: region.id, blobPath: item.name, blobDate, status: "failed" as const, errorMessage: message })
            .onConflictDoUpdate({
              target: [salesBlobIngestions.regionId, salesBlobIngestions.blobPath],
              set: { status: "failed", errorMessage: message, processedAt: new Date() },
            });
          failed.push({ regionCode: region.code, blobPath: item.name, error: message });
        }
      }
    }

    return { status: "ok" as const, processed, skipped, failed };
  });

  if ("skipped" in result && result.skipped === "lock-not-acquired") {
    return { status: "skipped-lock" };
  }
  return result as EtlRunResult;
}
```

**Step 3:** Run integration tests:

```bash
npx vitest run --project integration src/lib/sales/etl/azure-etl.integration.test.ts
```

**Step 4:** Commit:

```bash
git add src/lib/sales/etl/ src/app/\(app\)/settings/data-import/sales/pipeline.ts
git commit -m "feat(etl): add Azure blob ingestion orchestrator with advisory lock + idempotency"
```

---

## Phase 6 — Entry points

### Task 17: CLI script

**Files:**
- Create: `scripts/run-azure-etl.ts`.

**Step 1:**

```ts
#!/usr/bin/env -S npx tsx --env-file=.env.local
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runAzureEtl } from "@/lib/sales/etl/azure-etl";
import * as schema from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const result = await runAzureEtl(db);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "ok" && result.failed.length > 0) process.exit(1);
    if (result.status === "skipped-lock") process.exit(2);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Step 2:** Add npm script to `package.json`:

```json
"scripts": {
  "etl:azure": "npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/run-azure-etl.ts"
}
```

**Step 3:** Smoke-test against Azurite (if available) or a mocked container; otherwise run with no matching blobs to verify plumbing:

```bash
npm run etl:azure
```

Expected: `{ status: "ok", processed: [], skipped: [], failed: [] }` (empty run).

### Task 18: HTTP route

**Files:**
- Create: `src/app/api/etl/azure/run/route.ts`.

**Step 1:**

```ts
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { runAzureEtl } from "@/lib/sales/etl/azure-etl";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — blob-iter can be slow

export async function POST(req: Request) {
  const token = req.headers.get("x-etl-token");
  if (!token || token !== process.env.ETL_SHARED_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.ETL_AZURE_ENABLED !== "true") {
    return NextResponse.json({ error: "ETL disabled (set ETL_AZURE_ENABLED=true)" }, { status: 503 });
  }
  const result = await runAzureEtl(db);
  const status = result.status === "skipped-lock" ? 409
    : result.status === "ok" && result.failed.length > 0 ? 207
    : 200;
  return NextResponse.json(result, { status });
}
```

**Step 2:** Add Vercel cron:

```json
// vercel.json
{
  "crons": [
    { "path": "/api/etl/azure/run", "schedule": "0 4 * * *" }
  ]
}
```

Note: Vercel cron doesn't send custom headers — add a bypass that accepts the Vercel `x-vercel-cron` header as a valid auth path (since only Vercel can set it):

```ts
const isVercelCron = req.headers.get("x-vercel-cron") === "1";
if (!isVercelCron && token !== process.env.ETL_SHARED_SECRET) { ... }
```

**Step 3:** Commit:

```bash
git add scripts/run-azure-etl.ts src/app/api/etl/azure/run/route.ts vercel.json package.json
git commit -m "feat(etl): add CLI + HTTP entry points for Azure ETL + Vercel cron"
```

---

## Phase 7 — Commission rewrite

### Task 19: Update commission calculator

**Files:**
- Modify: `src/lib/commission/processor.ts` (and any nearby calculation files).

**Step 1:** Read the existing calculator:

```bash
find src/lib/commission -type f
```

**Step 2:** Locate where it sums `grossAmount`. Replace the aggregation logic:

```ts
// BEFORE (conceptual):
// SUM(grossAmount) WHERE locationId = $loc AND period = $p

// AFTER:
// SUM(netAmount) WHERE locationId = $loc AND period = $p AND is_booking_fee = true
```

**Step 3:** Existing unit/integration tests for commission likely reference `grossAmount` — update their fixtures to use `netAmount` + `isBookingFee = true` setup. Add a new test case verifying that principal (non-fee) rows do NOT contribute to commission base.

**Step 4:** Run tests + commit:

```bash
npx vitest run src/lib/commission
git add src/lib/commission/
git commit -m "feat(commission): base calc on sum(netAmount) where isBookingFee=true"
```

---

## Phase 8 — UI removal + history view

### Task 20: Delete CsvFileSource and old upload client

**Files:**
- Delete: `src/lib/sales/csv-file-source.ts`.
- Delete: `src/lib/sales/source.test.ts` (if it tests CsvFileSource; keep tests for any residual helpers).
- Delete: `src/app/(app)/settings/data-import/sales/sales-import-client.tsx`.

**Step 1:**

```bash
rm src/lib/sales/csv-file-source.ts
rm src/app/\(app\)/settings/data-import/sales/sales-import-client.tsx
```

**Step 2:** Compile check:

```bash
npx tsc --noEmit
```

Fix any dangling imports.

### Task 21: Repurpose page as history view

**Files:**
- Modify: `src/app/(app)/settings/data-import/sales/page.tsx`.
- Modify: `src/app/(app)/settings/data-import/sales/actions.ts` — strip `stageImport` / `commitImport` / `cancelImport` server actions (they're no longer callable from a UI form).

**Step 1:** The page becomes a read-only history table:
- Query recent `sales_blob_ingestions` joined with `salesImports` (last 50).
- Show: region code, blob path, blob date, processed at, status, error message, committed row count.
- A "Retry" action for `status='failed'` rows that triggers `runAzureEtl` for just that blob (or links to a manual admin flow).

**Step 2:** Commit:

```bash
git add -A src/app/\(app\)/settings/data-import/
git commit -m "refactor(ui): remove manual sales upload; show Azure ingestion history"
```

---

## Phase 9 — Config propagation helper

### Task 22: `updateFeeCodeFallback` helper

**Files:**
- Create: `src/lib/sales/config/fee-fallbacks.ts`.
- Create: `src/lib/sales/config/fee-fallbacks.integration.test.ts`.

**Step 1:** Integration test:

```ts
// Test outline:
// 1. Seed product_code_fallbacks('Booking Fee', '9991').
// 2. Seed products('Booking Fee', netsuiteCode='9991').
// 3. Seed 3 salesRecords with productId pointing at Booking Fee, netsuiteCode='9991'.
// 4. Call updateFeeCodeFallback(db, actor, 'Booking Fee', '9993').
// 5. Assert:
//    - product_code_fallbacks now has netsuite_code='9993'.
//    - products row updated to netsuite_code='9993'.
//    - All 3 salesRecords now have netsuite_code='9993'.
//    - Audit log has a single entry with { oldValue: '9991', newValue: '9993', affectedRows: 4 }.
// 6. A second call with the same new code is a no-op (idempotent).
```

**Step 2:** Implementation:

```ts
import { eq, and } from "drizzle-orm";
import { productCodeFallbacks, products, salesRecords } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import type { ImportActor } from "@/app/(app)/settings/data-import/sales/pipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateFeeCodeFallback(
  db: any,
  actor: ImportActor,
  productName: string,
  newCode: string,
): Promise<{ updatedProducts: number; updatedSalesRecords: number }> {
  return db.transaction(async (tx: typeof db) => {
    const [existing] = await tx
      .select({ id: productCodeFallbacks.id, oldCode: productCodeFallbacks.netsuiteCode })
      .from(productCodeFallbacks)
      .where(eq(productCodeFallbacks.productName, productName))
      .limit(1);
    if (!existing) throw new Error(`No fallback configured for productName '${productName}'`);
    if (existing.oldCode === newCode) {
      return { updatedProducts: 0, updatedSalesRecords: 0 };
    }

    await tx
      .update(productCodeFallbacks)
      .set({ netsuiteCode: newCode, updatedAt: new Date() })
      .where(eq(productCodeFallbacks.id, existing.id));

    const updatedProductRows = await tx
      .update(products)
      .set({ netsuiteCode: newCode })
      .where(and(eq(products.name, productName), eq(products.netsuiteCode, existing.oldCode)))
      .returning({ id: products.id });

    const updatedSalesRows = await tx
      .update(salesRecords)
      .set({ netsuiteCode: newCode })
      .where(and(
        eq(salesRecords.netsuiteCode, existing.oldCode),
        // scope by product name via productId ∈ updated products
      ))
      .returning({ id: salesRecords.id });

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "product_code_fallback",
        entityId: existing.id,
        entityName: productName,
        action: "update",
        field: "netsuite_code",
        oldValue: existing.oldCode,
        newValue: newCode,
        metadata: { affectedProducts: updatedProductRows.length, affectedSalesRecords: updatedSalesRows.length },
      },
      tx,
    );

    return { updatedProducts: updatedProductRows.length, updatedSalesRecords: updatedSalesRows.length };
  });
}
```

**Step 3:** Run tests + commit:

```bash
npx vitest run --project integration src/lib/sales/config/fee-fallbacks.integration.test.ts
git add src/lib/sales/config/
git commit -m "feat(sales): updateFeeCodeFallback propagates config edits across products + history"
```

---

## Phase 10 — End-to-end validation

### Task 23: Run against real CSV fixture

**Files:**
- Create: `tests/etl/azure-etl-full.integration.test.ts`.

**Step 1:** Load `WKG_NETSUITE_VK.csv` into a mock blob at `clientdata/GB/2026/01/01/sales.csv`. Run `runAzureEtl`. Assert:
- `processed.length === 1`, `processed[0].rows === 2663` (matching `wc -l` minus header).
- `SELECT COUNT(*) FROM sales_records WHERE is_booking_fee = true` matches the CSV's `Booking Fee` row count (1273).
- `SELECT SUM(net_amount) FROM sales_records WHERE ref_no = '2XA4558609'` returns `0.00` (reversal pair nets out).
- `SELECT COUNT(*) FROM sales_records WHERE netsuite_code = '9991'` === 1273 (fallback applied for fee rows with NULL Code).
- Second `runAzureEtl` call is a no-op: `processed=[]`, `skipped=[{..}]`.

**Step 2:**

```bash
npx vitest run --project integration tests/etl/azure-etl-full.integration.test.ts
```

### Task 24: Playwright UAT

**Files:**
- Create: `tests/etl-history.spec.ts`.
- Create: `tests/region-scoped-sales.spec.ts` (if region-aware sales UI exists).

**Step 1:** Follow the `playwright-best-practices` skill. For `etl-history.spec.ts`:
- Log in as admin.
- Navigate to `/settings/data-import/sales`.
- Verify table renders with at least one row if seeded.
- Click a `failed` row — error message displays.

**Step 2:**

```bash
npx playwright test tests/etl-history.spec.ts
```

### Task 25: Smoke checklist (manual)

Before merging to `optimisation`:

- [ ] `npm run build` succeeds.
- [ ] `npx vitest run` all unit + integration pass.
- [ ] `npx playwright test` passes.
- [ ] `npm run etl:azure` against Azurite emulator (or staging Azure) processes at least one fixture blob and is idempotent on second run.
- [ ] `POST /api/etl/azure/run` with `x-etl-token` returns identical result; without token returns 401.
- [ ] `ETL_AZURE_ENABLED=false` causes the route to return 503.
- [ ] Admin UI at `/settings/data-import/sales` shows the history view; no upload form is rendered.
- [ ] Commission dashboard reflects the new base calculation against seeded test data.
- [ ] DB backup captured before production migration apply.

**Step 2:** Final commit if any polish changes:

```bash
git commit -m "chore: final polish + smoke-test verification"
```

---

## Rollback

If anything goes wrong **before** production deploy:
- Revert the commits on this branch; `git push --force` *not* acceptable — open a revert PR if already pushed.

If anything goes wrong **after** production migration:
- Restore from the pre-migration DB backup captured in Task 25's checklist.
- Set `ETL_AZURE_ENABLED=false` in Vercel env to stop further ingestion.
- File a bug, triage, fix forward.

No in-place rollback is supported because the migration truncates `sales_records`.

---

## Known follow-ups (out of scope)

- Admin UIs for managing `regions.azureCode` and `product_code_fallbacks`. Config edits today go via migration or direct DB + `updateFeeCodeFallback` helper.
- Self-hosted infra migration — already enabled by the CLI entry point; no code changes needed when that happens.
- Commission rate configuration UX — only the calc base changed in this phase.
