// Phase 9.1 Plan 09.1-01 Task 2 — RED-stage unit tests for the BoE CSV
// parser. Drives FX-01 ingest fetch+parse (Wave 1 plan 09.1-03 Task 2 turns
// these GREEN by creating `src/lib/fx/boe-fetch.ts`).
//
// Analog: src/lib/performance-alerts/format-currency.test.ts (single
// describe block, scalar `expect`s, no DB / no HTTP). Fixture file paths
// MUST use the actual capture date (2026-05-07) — not the placeholder
// 2026-05-08 that the plan body uses — because BoE had not published
// 2026-05-08 when fixtures were captured. See
// src/lib/fx/__fixtures__/README.md § "Why these dates".
//
// Wave 0 invariant (plan must_haves.truths): "Real BoE CSV fixture is
// committed (no live network in unit tests)." `readFileSync` honours that —
// every assertion below operates on bytes captured from the live BoE IADB
// endpoint and committed into __fixtures__/.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SUT does not exist yet (Wave 1 plan 09.1-03 creates it). The import
// itself is the RED gate: vitest reports "Cannot find module './boe-fetch'"
// until parseBoeCsv ships.
import { parseBoeCsv, BOE_SERIES_TO_CCY } from "./boe-fetch";

const FIXTURE_SINGLE = readFileSync(
  join(__dirname, "__fixtures__/boe-2026-05-07.csv"),
  "utf8",
);

const FIXTURE_MULTI = readFileSync(
  join(__dirname, "__fixtures__/boe-multi-day.csv"),
  "utf8",
);

describe("parseBoeCsv", () => {
  it("parses single-day fixture into 6 ParsedRate entries (one per series code)", () => {
    // Single-day fixture has 1 publish-date row × 6 series columns.
    // The parser melts wide-form CSV → long-form ParsedRate[] (D-01 / D-03).
    const rates = parseBoeCsv(FIXTURE_SINGLE);
    expect(rates).toHaveLength(6);
  });

  it("maps series codes to ISO 4217 currency codes via BOE_SERIES_TO_CCY", () => {
    // BOE_SERIES_TO_CCY is the canonical translation table:
    // XUDLUSS → USD, XUDLERS → EUR, XUDLJYS → JPY, XUDLADS → AUD,
    // XUDLCDS → CAD, XUDLSFS → CHF.
    expect(BOE_SERIES_TO_CCY).toMatchObject({
      XUDLUSS: "USD",
      XUDLERS: "EUR",
      XUDLJYS: "JPY",
      XUDLADS: "AUD",
      XUDLCDS: "CAD",
      XUDLSFS: "CHF",
    });
    const rates = parseBoeCsv(FIXTURE_SINGLE);
    const currencies = rates.map((r) => r.currency).sort();
    expect(currencies).toEqual(["AUD", "CAD", "CHF", "EUR", "JPY", "USD"]);
  });

  it("emits positive finite numeric rate and ISO YYYY-MM-DD rateDate", () => {
    const rates = parseBoeCsv(FIXTURE_SINGLE);
    for (const r of rates) {
      expect(Number.isFinite(r.rate)).toBe(true);
      expect(r.rate).toBeGreaterThan(0);
      // Date in fixture is "07 May 2026"; parser must canonicalise to
      // ISO YYYY-MM-DD so downstream lookup keys are sortable strings.
      expect(r.rateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Pin the actual published date so a regenerated fixture is caught.
    const usd = rates.find((r) => r.currency === "USD");
    expect(usd?.rateDate).toBe("2026-05-07");
  });

  it("returns one ParsedRate per (currency, publish-date) for multi-day fixture (no Sat/Sun rows)", () => {
    // Fixture covers Mon 2026-04-27 → Thu 2026-05-07 (8 BoE-published
    // weekdays; Sat 2 May, Sun 3 May, UK BH Mon 4 May absent). Six series
    // × 8 publish dates = 48 ParsedRate entries.
    const rates = parseBoeCsv(FIXTURE_MULTI);
    expect(rates).toHaveLength(48);

    // Carry-forward fixture invariant: no row exists for the 3-day gap.
    const dates = new Set(rates.map((r) => r.rateDate));
    expect(dates.has("2026-05-02")).toBe(false); // Sat
    expect(dates.has("2026-05-03")).toBe(false); // Sun
    expect(dates.has("2026-05-04")).toBe(false); // UK Early-May BH
  });

  it("returns [] (or throws) for empty / blank CSV input", () => {
    // Defensive: empty input from a future BoE outage must not produce
    // bogus ParsedRate entries that upsert silently. Either return [] or
    // throw — both are acceptable; the cron caller treats both as
    // "fetch failed" and routes to the fx_rate_fetch_failed alert (D-06).
    expect(() => {
      const out = parseBoeCsv("");
      // If the parser chooses to return rather than throw, it must be [].
      expect(out).toEqual([]);
    }).not.toThrow();
  });

  it("throws a descriptive error when a numeric cell is malformed (D-03 fail-loud)", () => {
    // Per D-03 ("CSV with unknown currency → ETL fails loudly; no silent
    // fallback to GBP"): malformed rate cells must surface, not get
    // silently coerced to NaN/0. Planner's call: throw with a message
    // naming the offending row so the operator can triage.
    const malformed =
      "DATE,XUDLUSS,XUDLERS,XUDLJYS,XUDLADS,XUDLCDS,XUDLSFS\n" +
      "07 May 2026,1.3631,not-a-number,212.9834,1.8779,1.8586,1.0587\n";
    expect(() => parseBoeCsv(malformed)).toThrow(/XUDLERS|EUR|07 May 2026|invalid/i);
  });
});
