# Phase 1 Milestone 5 — Supabase ETL Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Also: superpowers:test-driven-development for Task 5.2.

**Goal:** One-shot migration script that reads ALL live data from data-dashboard's Supabase Postgres and writes it into wkg-kiosk-tool's local Postgres, normalising the denormalised Supabase shape into our FK-based schema.

**Design reference:** `docs/plans/2026-04-16-kiosk-platform-merge-design.md` section 5

**Branch:** `phase-1/m5-supabase-etl`

**Supabase instance:** `oeizzpgjzsteurjbobze.supabase.co` — credentials in data-dashboard's `.env.local` (referenced at runtime, not copied).

---

## Scope decisions (confirmed with human 2026-04-17)

- **Full data, no vertical slice.** Migrate everything in one shot.
- **One-shot script at `scripts/migrate-from-supabase.ts`** — run via `npx tsx --env-file=<path> scripts/migrate-from-supabase.ts`.
- **Resumable/idempotent.** Uses upsert-on-conflict + a progress checkpoint so re-running after a mid-script failure skips already-migrated rows.
- **Service-role key required.** Bypasses Supabase RLS policies.
- **Weather cache NOT migrated** (starts fresh from Open-Meteo).
- **Commission NOT calculated** (Phase 3 — raw `saleCommission` column preserved from source).
- **User passwords NOT migrated** (Supabase auth ≠ Better Auth). Migrated users will need to reset passwords via "set password" flow. Script sets a random placeholder.

---

## Data flow summary

```
Supabase                           wkg-kiosk-tool
────────                           ──────────────
hotel_metadata_cache  ──────────▶  locations (upsert on outlet_code)
                                   + hotelGroups / regions / locationGroups (upsert)
distinct products     ──────────▶  products (upsert on name)
distinct providers    ──────────▶  providers (upsert on name)
profiles              ──────────▶  user (Better Auth createUser API)
user_permissions      ──────────▶  userScopes (expand arrays → rows)
sales_data            ──────────▶  salesRecords (batch, FK-resolve, upsert)
outlet_exclusions     ──────────▶  outletExclusions (upsert)
event_categories      ──────────▶  eventCategories (upsert)
business_events       ──────────▶  businessEvents (upsert)
saved_views           ──────────▶  analyticsSavedViews (upsert, re-map userId)
permission_presets    ──────────▶  analyticsPresets (upsert)
```

---

## Task 5.1: Environment prep

**Files:**
- Modify: `.env.local` — add `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Modify: `package.json` — add `@supabase/supabase-js` dep + `db:migrate:supabase` script
- Create: `scripts/migrate-from-supabase.ts` (stub + Supabase client init + connectivity check)

### Steps
1. `npm install @supabase/supabase-js`
2. Add to `.env.local`:
   ```
   SUPABASE_URL=https://oeizzpgjzsteurjbobze.supabase.co
   SUPABASE_SERVICE_KEY=<service_role_key from data-dashboard .env.local>
   ```
3. Add script entry in `package.json`:
   ```
   "db:migrate:supabase": "npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/migrate-from-supabase.ts"
   ```
4. Create stub script that:
   - Connects to Supabase via service-role client.
   - Runs a `select count(*) from sales_data` to verify connectivity.
   - Prints the count and exits.

Commit:
```bash
git commit -m "chore(m5): Supabase client + migration script stub"
```

---

## Task 5.2: Dimension migration (hotel_metadata_cache → locations + dimension tables)

**Files:**
- Modify: `scripts/migrate-from-supabase.ts`
- Create: `tests/db/supabase-etl.integration.test.ts` (testcontainers — test the transformer logic, not the Supabase read)

### Steps

1. **Read `hotel_metadata_cache`** (all rows, ~100s of rows expected):
   ```ts
   const { data: hotels } = await supabase.from('hotel_metadata_cache').select('*');
   ```

2. **Upsert locations** — for each hotel:
   - Match on `locations.outletCode = hotel.outlet_code`.
   - If exists: update `name`, `hotelGroup`, `region`, `locationGroup`, `numRooms`, `starRating`, `liveDate`.
   - If new: insert with all fields.
   - Track inserted/updated counts.

3. **Upsert dimension tables** — collect distinct `hotel_group`, `region`, `location_group` values from hotel_metadata_cache:
   - `hotelGroups` table — upsert on `name`.
   - `regions` table — upsert on `name`.
   - `locationGroups` table — upsert on `name`.
   - Also join locations to their dimension FKs (hotelGroupId, etc.) if schema requires.

4. **Upsert products** — read distinct `product_name` from `sales_data`:
   ```ts
   const { data } = await supabase.rpc('distinct_dimension_values', { col: 'product_name' });
   ```
   OR just `select distinct product_name from sales_data`. Upsert into `products`.

5. **Upsert providers** — if data-dashboard has a concept of providers (check: category_name may be the provider proxy, or there's no separate provider in Supabase). If not: skip, providers will be null on sales rows.

### TDD
- Test the transformer functions (hotel → location mapping, dimension extraction) against canned hotel_metadata_cache fixtures.

Commit:
```bash
git commit -m "feat(m5): dimension migration (hotels → locations + dimension tables)"
```

---

## Task 5.3: User migration (profiles + user_permissions → user + userScopes)

**Files:**
- Modify: `scripts/migrate-from-supabase.ts`

### Steps

1. **Read `profiles`** — all rows.
2. **For each profile:**
   - Check if `user` already exists by email (idempotent).
   - If not: `auth.api.createUser({ email, password: randomPassword(), name: full_name, role: mapRole(profile.role) })`.
   - Map role: Supabase `admin` → our `admin`; Supabase `user` → our `member`.
   - Store old Supabase user ID → new Better Auth user ID mapping for later FK fixup.
   - Set `userType = 'internal'` (all existing dashboard users are internal).

3. **Read `user_permissions`** — all rows.
4. **Expand arrays → userScopes rows:**
   - `permissions.products` (string[]) → one `userScopes` row each with `dimensionType: 'product'`, `dimensionId: <productId by name>`.
   - `permissions.hotels` (string[]) → one row each with `dimensionType: 'hotel_group'` and `dimensionId: <hotelGroupId by name>`.
   - (Same for `hotel_groups`, `regions`.)
   - If ALL arrays are empty/null → no scopes (unrestricted internal user).
   - Upsert via `onConflictDoNothing` on the unique triple.

5. **Log:** `Migrated N users, M scopes`.

Commit:
```bash
git commit -m "feat(m5): user + userScopes migration from Supabase profiles"
```

---

## Task 5.4: Sales data migration (sales_data → salesRecords)

**Files:**
- Modify: `scripts/migrate-from-supabase.ts`

### Steps

1. **Count total rows** — `select count(*) from sales_data`.
2. **Batch-read** — paginate with `.range(offset, offset + BATCH - 1)` in batches of 1000.
3. **For each batch:**
   - Resolve FKs:
     - `outlet_code` → `locationId` via `locations.outletCode`.
     - `product_name` → `productId` via `products.name` (case-insensitive).
     - Provider: if category_name or a vendor field exists, resolve; else null.
   - Map fields:
     - `saleref` → `saleRef` (generate a deterministic fallback if null: `${outlet_code}-${sale_date}-${rowIndex}`).
     - `sale_date` → `transactionDate`.
     - `sale_time` → `transactionTime` (may be null).
     - `amount` → `grossAmount`.
     - `total_amount` → `netAmount` (or vice versa — confirm from data-dashboard schema).
     - `booking_fee` → `bookingFee`.
     - `sale_commission` → `saleCommission`.
     - `discount_amount` → `discountAmount`.
     - `quantity` → `quantity` (default 1 if null).
     - `currency` → default `"GBP"`.
   - Skip rows where `locationId` can't be resolved (log warning + count).
   - Upsert into `salesRecords` on `(saleRef, transactionDate)` unique constraint.
   - Checkpoint: write `{ lastOffset, processedRows }` to console.log after each batch.

4. **Final log:** `Migrated N sales rows, skipped M (unresolvable outlet), in K batches`.

Commit:
```bash
git commit -m "feat(m5): sales data migration (batched, FK-resolved, idempotent)"
```

---

## Task 5.5: Analytics metadata migration

**Files:**
- Modify: `scripts/migrate-from-supabase.ts`

### Steps

Migrate remaining tables (all small — 10s to 100s of rows):

1. **outlet_exclusions** → `outletExclusions` — direct field map, upsert on `(outletCode, patternType)`.
2. **event_categories** → `eventCategories` — upsert on `name`.
3. **business_events** → `businessEvents` — remap `created_by` via user ID map.
4. **saved_views** → `analyticsSavedViews` — remap `user_id` via user ID map; `series_config` jsonb → `config` jsonb.
5. **permission_presets** → `analyticsPresets` — if table exists in target schema.

Log counts for each table.

Commit:
```bash
git commit -m "feat(m5): analytics metadata migration (exclusions, events, views, presets)"
```

---

## Task 5.6: Verification pass

**Steps:**

1. **Row counts:** compare Supabase source counts vs target counts for every migrated table.
2. **FK integrity:** `SELECT * FROM salesRecords WHERE locationId NOT IN (SELECT id FROM locations)` — expect 0.
3. **Scope coverage:** every external user has ≥ 1 scope row (invariant).
4. **No orphans:** `SELECT * FROM importStagings WHERE importId NOT IN (SELECT id FROM salesImports)` — expect 0.
5. **Date range sanity:** `SELECT min(transactionDate), max(transactionDate) FROM salesRecords` — matches Supabase.
6. **Duplicates:** `SELECT saleRef, transactionDate, count(*) FROM salesRecords GROUP BY 1,2 HAVING count(*) > 1` — expect 0.

Print a verification report to stdout. Any failure → non-zero exit code.

Commit:
```bash
git commit -m "feat(m5): post-migration verification pass"
```

---

## Task 5.7: Documentation + verification gate

- Create `docs/MIGRATION-FROM-SUPABASE.md` — connection setup, prerequisites, run instructions, rollback, monitoring.
- Run the full migration against dev DB.
- Full test suite: vitest + playwright — no regressions.
- Report M5 merge readiness.

Commit:
```bash
git commit -m "docs(m5): Supabase migration runbook"
```

---

## Out of scope for M5

- **Password migration.** Better Auth ≠ Supabase Auth. Users reset passwords post-migration.
- **Commission calculation.** Phase 3 — raw `saleCommission` preserved.
- **Weather cache.** Starts fresh from Open-Meteo API.
- **RPC functions.** Analytics queries are M6 (port analytics pages). We only port the DATA, not the query layer.
- **Supabase shutdown.** M5 migrates data; old dashboard stays live until M6+ are verified.

---

## Answered questions

1. **Vertical slice?** No — full migration.
2. **Monday.com importer?** Deleted from this repo (M4.5 cleanup commit). Source remains in kiosk-management.
3. **Typecheck error?** Fixed alongside (M4.5 cleanup commit).
4. **Sales demo seed?** Created (`npm run db:seed:sales-demo`, M4.5 cleanup commit).
