# BoE IADB CSV fixtures

Real Bank of England Interactive Database (IADB) responses captured for Phase
9.1 (multi-currency analytics — forex normalisation to GBP base reporting).

These fixtures back the `src/lib/fx/boe-fetch.test.ts` unit suite. They MUST
NOT be regenerated from new live BoE fetches without re-validating the parser
tests against the new shape — BoE rates are real, dated values that the
boundary tests in `src/lib/fx/rate-lookup.test.ts` reason about explicitly
(carry-forward across the May 2026 weekend + UK Early-May bank holiday).

## Why these dates

The plan (`09.1-01-PLAN.md`, Task 1) specified `2026-05-08` as the canonical
single-day date. The BoE IADB returned a header-only response for that date
when fixtures were captured on `2026-05-09` — BoE only publishes spot rates
for past business days. Per Task 1's fall-back instruction:

> If 2026-05-08 returns empty (BoE non-publish), use the most recent
> BoE-published weekday and update the fixture filename + README.md to match.

The most recent published weekday on capture was **Thursday 2026-05-07**, so
the single-day fixture is `boe-2026-05-07.csv` (filename matches actual data
date).

The multi-day fixture spans **Mon 2026-04-27 → Thu 2026-05-07** (10
calendar days, 8 BoE-published weekdays). This window deliberately straddles
two non-publish gaps:

- **Sat 2026-05-02 + Sun 2026-05-03** — routine weekend (BoE publishes
  Mon-Fri only).
- **Mon 2026-05-04** — UK Early May bank holiday (no BoE publish even though
  it's a weekday).

The 3-day gap between Fri 2026-05-01 and Tue 2026-05-05 is what drives the
`getRateForDate` carry-forward boundary cases in `rate-lookup.test.ts`.

## Source URLs

Both fixtures were captured via the BoE IADB CSV download endpoint (no auth,
public dataset). The exact URLs used:

### `boe-2026-05-07.csv`

```
https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?CodeVer=new&csv.x=yes&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N&Datefrom=07/May/2026&Dateto=07/May/2026&SeriesCodes=XUDLUSS,XUDLERS,XUDLJYS,XUDLADS,XUDLCDS,XUDLSFS
```

### `boe-multi-day.csv`

```
https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?CodeVer=new&csv.x=yes&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N&Datefrom=27/Apr/2026&Dateto=07/May/2026&SeriesCodes=XUDLUSS,XUDLERS,XUDLJYS,XUDLADS,XUDLCDS,XUDLSFS
```

## Series-code legend (covered by both fixtures)

| Series code | ISO 4217 | Meaning                                  |
| ----------- | -------- | ---------------------------------------- |
| `XUDLUSS`   | USD      | Spot exchange rate, US Dollar per Sterling |
| `XUDLERS`   | EUR      | Spot exchange rate, Euro per Sterling      |
| `XUDLJYS`   | JPY      | Spot exchange rate, Japanese Yen per Sterling |
| `XUDLADS`   | AUD      | Spot exchange rate, Australian Dollar per Sterling |
| `XUDLCDS`   | CAD      | Spot exchange rate, Canadian Dollar per Sterling |
| `XUDLSFS`   | CHF      | Spot exchange rate, Swiss Franc per Sterling |

These are the GBP-base series IDs; rate values are "1 GBP = X foreign" — the
inverse of `rate_to_gbp`. The Wave 1 parser
(`src/lib/fx/boe-fetch.ts::parseBoeCsv`) is responsible for converting (per
RESEARCH.md § "BoE CSV download URL (verified)" + D-04).

## Capture date

`2026-05-09` (Friday).

## Provenance rule

If a future test expects a different fixture shape (e.g., adds a new
currency series, adds a new date), capture a new fixture from BoE — do NOT
hand-edit these files. Synthetic CSVs would defeat the Wave 0 invariant
("Real BoE CSV fixture committed; no live network in unit tests" — see plan
`must_haves.truths`).
