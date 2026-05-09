/**
 * Bank of England IADB series codes → ISO 4217 currency codes.
 *
 * Source: https://www.bankofengland.co.uk/statistics/exchange-rates
 *
 * Locked at the BoE-supported broad set (~25 majors) per CONTEXT.md D-03.
 * CSV currency outside `BOE_SUPPORTED_CURRENCIES` → ETL hard-fail (no silent
 * GBP fallback). Adding a new code here REQUIRES verifying via the BoE
 * Rates page that the series code is live; a wrong code returns silently
 * missing data in the fetch (RESEARCH §"Assumptions Log" A2).
 *
 * The first six entries (XUDLUSS … XUDLSFS) are exercised verbatim by the
 * Wave 0 fixtures committed at `src/lib/fx/__fixtures__/`.
 */
export const BOE_SERIES_TO_CCY = {
  XUDLUSS: "USD",
  XUDLERS: "EUR",
  XUDLJYS: "JPY",
  XUDLADS: "AUD",
  XUDLCDS: "CAD",
  XUDLSFS: "CHF",
  XUDLBK22: "CNY",
  XUDLBK35: "INR",
  XUDLBK39: "KRW",
  XUDLBK44: "MXN",
  XUDLBK47: "ZAR",
  XUDLBK63: "BRL",
  XUDLBK64: "NOK",
  XUDLBK65: "NZD",
  XUDLBK67: "SAR",
  XUDLBK68: "SEK",
  XUDLBK69: "SGD",
  XUDLBK70: "THB",
  XUDLBK73: "TRY",
  XUDLBK75: "AED",
  XUDLBK76: "ILS",
  XUDLBK78: "PLN",
  XUDLBK79: "HKD",
  XUDLBK80: "DKK",
  XUDLBK87: "HUF",
  XUDLBK89: "TWD",
  XUDLBK91: "RUB",
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
