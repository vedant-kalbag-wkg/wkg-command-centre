---
phase: 07-data-foundation-rebuild
plan: 02
status: complete-with-known-gap
artifacts:
  - scripts/v2-wipe-and-reseed.ts
  - src/lib/monday/import-hotel-locations.ts
  - src/lib/monday/import-assets.ts
  - src/lib/sales/local-file-source.ts
  - src/lib/sentinel.ts
  - src/lib/normalise.ts
  - tests/locations/sentinel.spec.ts
---

# Plan 07-02 — Wipe-and-reseed runbook (SUMMARY)

## Outcome

Runbook lands end-to-end against the Neon UAT branch (`phase-07-uat`, forked
from prod). Two-phase transaction shape:

- **Phase 1 — atomic structural reseed** (single tx): wipe → ensure GLOBAL
  region + LOCATION_NEEDED sentinel → hotel-import → assets-import →
  commission-tier import → audit log
- **Phase 2 — per-CSV sales ETL** (one tx per file): each seed CSV is staged
  + committed independently and idempotently (sourceHash dedup)
- **Phase 3 — two-pass `assigned_at` backfill**: spawns the existing
  `scripts/backfill-kiosk-install-dates.ts --apply` once Phase 2 lands

Lock key `738294107` keeps the runbook from colliding with the Azure ETL
(`738294105`) or the Monday import (`738294106`).

## Validation (against UAT branch, `--apply --max-csv 1`)

| Metric | Plan A baseline (prod) | Phase 7 reseed (UAT) |
|---|---|---|
| `regions` | 6 (AU, CZ, DE, ES, IE, UK) | 7 (+GLOBAL) |
| `locations` (active) | 373 | 357 (356 hotels + sentinel) |
| `kiosks` | 442 | 381 (Monday Assets is the SoT) |
| `kiosk_assignments` (active) | 380 | 381 |
| `location_products` | 2024 | 1952 |
| `sales_records` (1 of 3 CSVs) | 95,103 | 87,879 (Feb only) |

`tsc --noEmit` clean across all touched files. Sentinel Playwright spec
(`tests/locations/sentinel.spec.ts`) parses; full live run gated to Plan E.

## Known unresolved gap — sales orphan rate

**66,165 of 87,879 GB Feb 2026 sales rows (75.29%) routed to LOCATION_NEEDED.**

Root cause is upstream, not in this plan's code:

- The 47 unmatched outlet codes are airport / transport / shuttle outlets.
- They are NOT on the Monday Assets board (1426737864, 488 items) — confirmed
  by walking every item.
- They are NOT on the 4 hotel boards' `mirror9` column either.
- The Assets-vs-mirror9 set difference is functionally zero: the 7 codes
  mirror9 had that Assets doesn't (P4, PA, PB, PC, MN, MM, MO) have **0
  rows** in the seed CSV. So switching the importer from mirror9-synthesis
  to Assets is a clean lateral move at parity, not a coverage win.
- Coverage from Assets alone: **244/291 distinct outlet codes (83.8%)**.

### Top 30 unmatched codes (code, sales row count) — operator triage list

```
CB  12975    BK   322    A2   194
UG   8385    H0   290    H5   162
T2   5178    H6   256
T3   4923    3H   228
M5   4483    5X   200
M3   4232
T5   4097
4T   2703
A3   2419
T4   2126
M2   2097
2M   1986
IN   1304
HC   1220
HU   1158
H3    756
5H    738
8H    716
H2    546
7S    522
A5    448
H1    422
7H    330
```

The full set is 47 codes — these are the top 30 by row count. The pattern
strongly suggests airport-specific (T-prefixed = terminals, H-prefixed =
heathrow, A-prefixed = airport) and transit (CB = Central Bus Station,
UG = Underground) outlets.

### Resolution path (deferred to Plan C / operator)

Per the plan's design intent (D-06 / DATA-04), unknown outlet codes during
sales ETL route to the LOCATION_NEEDED sentinel, and Plan C's merge UI is
the operator's surface for triaging the orphan kiosks. After Plan C ships:

1. Sales rows for these 47 codes appear under `/locations/<sentinel-id>`.
2. Operator either creates a real location row + reassigns the orphan
   kiosks, OR (preferred for v2) extends Monday with the missing
   airport/transit outlets so future reseeds pick them up automatically.

This is exactly the workflow Plan C is meant to absorb. Plan B's importer
is architecturally correct; the Monday SoT is incomplete for non-hotel
outlets.

## Deviations from the original Plan B spec (deliberate)

| Deviation | Reason |
|---|---|
| Renamed `GOLDEN_TOTAL_REVENUE_PENCE` → `_GROSS_GBP` | Schema is `numeric(12,2)` decimal pounds (per Plan A snapshot), not pence — the constant must match the data shape |
| Two-phase tx (structural / per-CSV sales) instead of one big tx | Neon's 512MB project storage cap killed single-tx full reseed mid-COMMIT; per-CSV tx keeps WAL bounded |
| Pinned drizzle to the runbook's `PoolClient` | Required so importers see the uncommitted wipe state (drizzle-on-Pool would acquire a different connection and miss the in-flight transaction) |
| Removed `markets` from wipe set | `regions.market_id → markets.id` cascades from markets — `TRUNCATE markets CASCADE` would drag regions down with it (preflight had 0 rows in markets anyway) |
| Added FK ordering in `_commitImportForActor` | `sales_records.original_record_id` is a self-referential immediate FK; chunked inserts with reversals before originals fired FK violations. Sort: non-reversals first, then reversals |
| Broadened Monday API retry predicate | HTTP 502/503/504 from the GraphQL gateway are transient; existing predicate only retried rate-limit errors |
| `--max-csv N` flag | UAT branch storage cap forces a small validation footprint; production cutover omits the flag |
| Per-kiosk fallback in `dimension-resolver` | Per the v2 data-model rule "outlet_code is per-kiosk", sales codes match `kiosks.outlet_code` first, falling through `kiosk_assignments` → `locations.id`. Sentinel fallback only triggers if neither path resolves |
| Group-title → region resolution (vs board → region) | Hotel boards on Monday partition items by region inside groups (e.g. "Live: UK Hotels", "Removed Spain"). Per-item group is the only reliable region signal; board-level mapping only worked for AU |
| Net-new Assets importer (`runAssetsImport`) | Original spec only had `runHotelLocationImport` synthesizing kiosks from comma-split mirror9. The Monday Assets board is the SoT for per-kiosk outlet codes — direct import gives canonical kiosk identity |
| Hotel-importer no longer creates kiosks | Kiosk creation moved to the Assets importer; hotel-importer's only job is `locations` |

## What's next

Wave 3 (Plans 07-03 + 07-04) consume Plan B's substrate:

- **07-03 (Location-merge UI)** — operator path for triaging the 47 orphan
  outlet codes (and the 16 same-name groups Plan A flagged on Monday)
- **07-04 (Same-name guardrails)** — partial unique index on
  `locations.normalised_name` (column already shipped in Plan B)

Wave 4 (Plan 07-05) provisions the prod cutover; the runbook is ready to
run there with `--apply` (no `--max-csv` cap, since prod's storage budget
exceeds the UAT branch fork).
