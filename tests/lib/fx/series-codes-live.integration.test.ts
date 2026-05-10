/**
 * Phase 9.1 UAT discovery — regression gate against silent BoE series-code rot.
 *
 * Probes every key in `BOE_SERIES_TO_CCY` against the live IADB endpoint and
 * asserts:
 *   1. HTTP 200 (rejects 302 "Object Moved" → ErrorPage redirects, which would
 *      otherwise poison the entire daily fetch and throw "missing header row"
 *      in `parseBoeCsv`).
 *   2. The returned magnitude is within an order-of-magnitude band of the real
 *      GBP-spot rate. Catches future BK-style index/rate confusion where a
 *      series returns realistic-looking numbers (e.g. NOK 94.255 vs real ~12)
 *      that would silently corrupt every backfill and live ingest.
 *
 * Skipped under `vitest run` by default — flagged as `integration` and only
 * fires when `INTEGRATION_TESTS=1` is set, because BoE's endpoint is throttled
 * and a unit-test loop would burn the project's quota. Plan 09.1-08 + this
 * UAT cycle ran it once against May-2026 data; CI invokes it via the
 * `npm run test:integration` script (Phase 11 plan).
 *
 * The bounds below are 50% wider than the historical 5-year envelope per
 * currency — wide enough to absorb realistic FX moves, narrow enough that an
 * ERI mis-mapping (typically 3-30× off) trips the assertion immediately.
 */

import { describe, expect, it } from "vitest";

import { BOE_SERIES_TO_CCY } from "@/lib/fx/currencies";

type Bound = { min: number; max: number };

// Realistic GBP-spot envelopes (foreign per 1 GBP). Sourced from the 2010-2026
// 5y rolling spread on BoE's IADB short-form series, padded ±50%. If the BoE
// publishes a value outside this band, the world has changed enough that the
// operator should manually re-validate before trusting the rate.
const GBP_SPOT_BOUNDS: Record<string, Bound> = {
  USD: { min: 0.8, max: 2.2 },
  EUR: { min: 0.9, max: 1.8 },
  JPY: { min: 100, max: 350 },
  AUD: { min: 1.2, max: 3.0 },
  CAD: { min: 1.2, max: 2.7 },
  CHF: { min: 0.7, max: 1.7 },
  NZD: { min: 1.5, max: 3.5 },
  NOK: { min: 7, max: 18 },
  SEK: { min: 7, max: 18 },
  DKK: { min: 6, max: 13 },
  HKD: { min: 7, max: 15 },
  SGD: { min: 1.3, max: 2.5 },
  ZAR: { min: 12, max: 35 },
  SAR: { min: 3.5, max: 8 },
  TWD: { min: 25, max: 60 },
};

const FROM = "2024-01-15";
const TO = "2024-01-15";

const SHOULD_RUN =
  process.env.INTEGRATION_TESTS === "1" ||
  process.env.PHASE_09_1_UAT === "1";

describe.skipIf(!SHOULD_RUN)("@fx BoE IADB series codes — live probe", () => {
  it("every BOE_SERIES_TO_CCY entry returns HTTP 200 with a sane GBP-spot magnitude", async () => {
    const failures: string[] = [];
    for (const [seriesCode, currency] of Object.entries(BOE_SERIES_TO_CCY)) {
      const url =
        `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp` +
        `?CodeVer=new&csv.x=yes&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N` +
        `&Datefrom=${formatDate(FROM)}&Dateto=${formatDate(TO)}&SeriesCodes=${seriesCode}`;
      const resp = await fetch(url, { redirect: "manual" });
      if (resp.status !== 200) {
        failures.push(`${currency} (${seriesCode}) — HTTP ${resp.status} (likely 302→ErrorPage)`);
        continue;
      }
      const csv = await resp.text();
      const second = csv.split(/\r?\n/)[1] ?? "";
      const rate = Number(second.split(",").pop());
      if (!Number.isFinite(rate)) {
        failures.push(`${currency} (${seriesCode}) — non-numeric body`);
        continue;
      }
      const bounds = GBP_SPOT_BOUNDS[currency];
      if (!bounds) {
        failures.push(`${currency} (${seriesCode}) — no GBP_SPOT_BOUNDS defined; add a band before merging`);
        continue;
      }
      if (rate < bounds.min || rate > bounds.max) {
        failures.push(
          `${currency} (${seriesCode}) — rate ${rate} outside [${bounds.min}, ${bounds.max}] — ERI/index?`,
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 90_000);
});

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d}/${months[Number(m) - 1]}/${y}`;
}
