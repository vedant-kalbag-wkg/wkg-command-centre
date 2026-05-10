# Phase 9.1 — Deferred items

Items intentionally not closed during phase merge. Each entry names the
trigger, the reason for deferral, and the conditions under which it
should be picked back up.

---

## DEFERRED-09.1-01 — `analytics-currency-render` Test 1 (single-currency native render)

- **Discovered during:** Phase 9.1 autonomous UAT, 2026-05-10.
- **Spec:** `tests/fx-normalisation/analytics-currency-render.spec.ts` Test 1.
- **What it asserts:** `/analytics/regions` filtered to a single-currency
  cohort (e.g. EUR-only or AUD-only) renders the native currency symbol
  (€, A$, …) not £.
- **Why deferred:** The preview Neon DB has no non-GBP sales data
  (auto-memory: all 95,103 prod rows are GBP-only). The renderer dispatch
  for the native path is unit-tested in vitest
  (`src/lib/analytics/revenue-display.test.ts` — D-10/D-11 contract); only
  the live-preview visual confirmation against real seed data is missing.
- **Pickup conditions:** Run against any future preview/staging environment
  that has non-GBP sales data — typically when an Azure ETL run for an
  AU/NZ/EU region lands. No code change needed; just re-run the spec.
- **Recorded in:** `09.1-HUMAN-UAT.md` UAT caveat 2.

## DEFERRED-09.1-02 — exchange_rates seed (operator action, not code)

- **State at merge (2026-05-10):** `exchange_rates` table on prod is
  empty. The first row lands when the Inngest BoE cron
  `fx-rates-fetch-daily` fires at 06:00 Europe/London (next firing ~14h
  after merge).
- **Risk window:** Until the cron seeds at least one row per supported
  currency, any non-GBP sales import would hard-fail at D-03
  (`No FX rate exists for <CCY> on or before …`). Today's prod is
  GBP-only, so the practical risk is zero — this is just a "will be
  populated tomorrow morning" reminder, not a regression.
- **Pickup conditions:**
  - **Default path:** wait for the 06:00 London cron run; verify with
    `psql "$DATABASE_URL_PROD" -c "SELECT COUNT(*), MAX(fetched_at) FROM exchange_rates;"`.
  - **Manual seed (only if a non-GBP import is imminent):** trigger one
    `fx-rates-fetch-daily` run from the Inngest dashboard against the
    production env, then re-verify the row count.
- **No retroactive backfill needed:** every existing prod row was stamped
  with a GBP-identity `net_amount_gbp` (95,103 rows during the 2026-05-10
  backfill) so the rate-lookup carry-forward never reaches the empty
  table for historical data.

---

## How this list closes

DEFERRED-09.1-01 closes when a non-GBP cohort exists in any preview/
staging env and the spec is re-run green. DEFERRED-09.1-02 closes the
moment the BoE cron writes its first row (verified by the operator
running the SELECT above). Both are one-line updates here when done.
