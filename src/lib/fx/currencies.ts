/**
 * Bank of England IADB series codes → ISO 4217 currency codes.
 *
 * Source: https://www.bankofengland.co.uk/statistics/exchange-rates
 *
 * Locked at the BoE-supported broad set per CONTEXT.md D-03. CSV currency
 * outside `BOE_SUPPORTED_CURRENCIES` → ETL hard-fail (no silent GBP fallback).
 *
 * Adding a new code here REQUIRES probing the BoE IADB endpoint with that
 * single series and verifying the returned magnitude matches the real
 * GBP-spot rate for that currency. Two failure modes silently corrupt
 * data:
 *   1. Dead codes return HTTP 302 to ErrorPage.asp, which poisons the
 *      entire daily fetch (the URL response is the redirect, not a CSV,
 *      so `parseBoeCsv` throws "missing header row" and every other
 *      series in the same call is dropped).
 *   2. Wrong-magnitude codes return HTTP 200 with realistic-looking
 *      numbers that are NOT GBP-spot rates — many `XUDLBK*` series turn
 *      out to be Effective Exchange Rate Indices (ERIs) or other
 *      derivatives. Phase 9.1 originally shipped with 21 such codes;
 *      they returned values 3× to 30× off the real GBP-spot rate, which
 *      would silently corrupt every backfill and live ingest for those
 *      currencies. The integration test at
 *      `tests/lib/fx/series-codes-live.integration.test.ts` is the
 *      regression gate — it issues one HEAD per series and fails if any
 *      returns non-200, AND a separate spot-check fails if a known
 *      GBP-spot rate has diverged > 50% from the BoE feed (catches
 *      future BK-style index/rate confusion).
 *
 * The first six entries (XUDLUSS … XUDLSFS) are exercised verbatim by the
 * Wave 0 fixtures committed at `src/lib/fx/__fixtures__/`; the remaining
 * nine entries (XUDLNDS … XUDLTWS) were added during the Phase 9.1 UAT
 * (2026-05-10) after the BK codes were discovered to be ERIs.
 *
 * Phase 9.1 UAT discovery (2026-05-10):
 *   - 4 codes 302-dead: `XUDLBK70 (THB)`, `XUDLBK79 (HKD)`, `XUDLBK80
 *     (DKK)`, `XUDLBK91 (RUB)` — these blocked every cron run.
 *   - 11 codes wrong-magnitude (ERIs, not spot): `XUDLBK22 (CNY)`,
 *     `XUDLBK35 (INR)`, `XUDLBK39 (KRW)`, `XUDLBK44 (MXN)`,
 *     `XUDLBK47 (ZAR)`, `XUDLBK63 (BRL)`, `XUDLBK64 (NOK)`,
 *     `XUDLBK65 (NZD)`, `XUDLBK67 (SAR)`, `XUDLBK68 (SEK)`,
 *     `XUDLBK69 (SGD)`, `XUDLBK73 (TRY)`, `XUDLBK75 (AED)`,
 *     `XUDLBK76 (ILS)`, `XUDLBK78 (PLN)`, `XUDLBK87 (HUF)`,
 *     `XUDLBK89 (TWD)` — replaced where a verified short-form `XUDL<2-3>S`
 *     code exists; dropped otherwise.
 *
 * Currencies with no verified GBP-spot series at the IADB endpoint
 * (DROPPED until BoE republishes or another source is wired):
 *   CNY, INR, KRW, MXN, BRL, TRY, AED, ILS, PLN, HUF, THB, RUB.
 * Operators ingesting sales in these currencies will hit D-03 hard-fail
 * with a clear "currency not in BOE_SUPPORTED_CURRENCIES" message —
 * preferable to silently writing 7× wrong `net_amount_gbp` figures.
 */
export const BOE_SERIES_TO_CCY = {
  XUDLUSS: "USD",
  XUDLERS: "EUR",
  XUDLJYS: "JPY",
  XUDLADS: "AUD",
  XUDLCDS: "CAD",
  XUDLSFS: "CHF",
  XUDLNDS: "NZD",
  XUDLNKS: "NOK",
  XUDLSKS: "SEK",
  XUDLDKS: "DKK",
  XUDLHDS: "HKD",
  XUDLSGS: "SGD",
  XUDLZRS: "ZAR",
  XUDLSRS: "SAR",
  XUDLTWS: "TWD",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Currencies this phase supports. CSV row with currency outside this set
 * fails the ETL blob loudly (D-03). GBP is included as the identity case
 * (D-04: net_amount_gbp = net_amount, no rate lookup, no series code).
 *
 * Sorted to keep the list deterministic — assertions in unit + integration
 * tests can compare without re-sorting.
 */
export const BOE_SUPPORTED_CURRENCIES: readonly string[] = Object.freeze(
  [
    "GBP",
    ...Array.from(new Set(Object.values(BOE_SERIES_TO_CCY))),
  ].sort(),
);
