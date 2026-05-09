/**
 * Bank of England IADB CSV fetch + parse.
 *
 * Pure parser (`parseBoeCsv`) is split from the I/O wrapper
 * (`fetchBoeRatesForDate`) so unit tests can exercise the wide-form → long-form
 * melt against committed fixtures (no live network — Wave 0 invariant).
 *
 * Implements:
 * - D-01 (BoE source).
 * - D-03 (rejects unknown series via the {@link BOE_SERIES_TO_CCY} keyset; cells
 *   for unknown series codes are skipped, malformed numeric cells throw with a
 *   descriptive message naming the offending row).
 *
 * Zero new npm dependencies — native fetch + native split + zod (already a
 * project dep). Per RESEARCH §"Don't Hand-Roll" the BoE CSV is simple enough
 * (single-line header, scalar cells, no quoting) that papaparse buys nothing
 * and would force a lockfile regen on Linux x64 (CLAUDE.md § "npm lockfile must
 * stay in sync").
 */

import { z } from "zod";

import { BOE_SERIES_TO_CCY } from "./currencies";

// Re-export so `boe-fetch.test.ts`'s `import { BOE_SERIES_TO_CCY } from
// "./boe-fetch"` resolves without dragging the test through the currencies
// module separately. Single import surface for the FX library.
export { BOE_SERIES_TO_CCY };

export type ParsedRate = {
  currency: string;
  rateDate: string; // ISO YYYY-MM-DD
  rate: number;
};

const ParsedRateSchema = z.object({
  currency: z.string().refine(
    (c) => Object.values(BOE_SERIES_TO_CCY).includes(c),
    { message: "currency not in BOE_SERIES_TO_CCY" },
  ),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "rateDate must be ISO YYYY-MM-DD"),
  rate: z.number().positive().finite(),
});

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

/** "08 May 2026" → "2026-05-08". Throws on unrecognised month tokens. */
function boeDateToIso(boe: string): string {
  const [d, m, y] = boe.trim().split(/\s+/);
  const mm = MONTHS[m];
  if (!mm) throw new Error(`unrecognised BoE month token "${m}" in date "${boe}"`);
  return `${y}-${mm}-${d.padStart(2, "0")}`;
}

/** "2026-05-08" → "8/May/2026" (BoE IADB query format). */
function isoToBoeQueryDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const monthName = Object.keys(MONTHS).find((k) => MONTHS[k] === m);
  if (!monthName) throw new Error(`isoToBoeQueryDate: unrecognised month in "${iso}"`);
  return `${Number(d)}/${monthName}/${y}`;
}

/**
 * Wide-form BoE CSV → long-form ParsedRate[].
 *
 * Skips:
 * - Blank / whitespace-only lines.
 * - Cells for series codes not in {@link BOE_SERIES_TO_CCY} (forward
 *   compatibility — BoE may extend its set; cron pulls a fixed list anyway).
 * - Empty cells (BoE leaves the cell blank for currencies it does not publish
 *   on a given date — e.g. holiday gaps in long-running ranges).
 *
 * Throws (D-03 fail-loud):
 * - When no header row (starts with `Date,`) is present AND the input is not
 *   empty. Truly empty input returns `[]` so a future BoE outage does not
 *   manifest as a parser crash inside the cron — see test "returns [] (or
 *   throws) for empty / blank CSV input".
 * - When a non-empty cell fails to parse as a positive finite number — error
 *   names the series code and the row's date so an operator can triage.
 */
export function parseBoeCsv(csv: string): ParsedRate[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const headerIdx = lines.findIndex((l) => l.toLowerCase().startsWith("date,"));
  if (headerIdx === -1) {
    throw new Error("BoE CSV missing header row starting with 'Date,'");
  }

  const header = lines[headerIdx].split(",").map((c) => c.trim());
  const seriesCols = header.slice(1); // skip the "Date" column itself
  const out: ParsedRate[] = [];

  for (const line of lines.slice(headerIdx + 1)) {
    const cells = line.split(",").map((c) => c.trim());
    const dateCell = cells[0];
    if (!dateCell) continue;
    const isoDate = boeDateToIso(dateCell);

    for (let i = 0; i < seriesCols.length; i++) {
      const series = seriesCols[i];
      const ccy = BOE_SERIES_TO_CCY[series as keyof typeof BOE_SERIES_TO_CCY];
      if (!ccy) continue; // unknown series → skip (D-03 fail-loud is at the
      // *currency* boundary; series codes come from BoE itself so an unknown
      // one is a BoE-side change, not bad data — see RESEARCH A2).

      const cell = cells[i + 1];
      if (!cell || cell === "") continue; // BoE non-publish row for this currency

      const rate = Number(cell);
      if (!Number.isFinite(rate)) {
        throw new Error(
          `BoE CSV invalid rate "${cell}" for series ${series} (${ccy}) on ${dateCell}`,
        );
      }

      const parsed = ParsedRateSchema.parse({ currency: ccy, rateDate: isoDate, rate });
      out.push(parsed);
    }
  }
  return out;
}

/**
 * Build the BoE IADB CSV query URL for a date range and series-code list.
 *
 * Exposed for the historical backfill (year-by-year ranges per RESEARCH Open
 * Question #1) and reused by {@link fetchBoeRatesForDate} for the single-day
 * cron pull.
 *
 * URL shape sourced verbatim from RESEARCH §"BoE CSV download URL (verified)";
 * ASP endpoint is stable per RESEARCH A1.
 */
export function buildBoeCsvUrl(
  from: string, // ISO YYYY-MM-DD
  to: string, // ISO YYYY-MM-DD
  seriesCodes: readonly string[],
): string {
  return (
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp` +
    `?CodeVer=new&csv.x=yes&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N` +
    `&Datefrom=${isoToBoeQueryDate(from)}&Dateto=${isoToBoeQueryDate(to)}` +
    `&SeriesCodes=${seriesCodes.join(",")}`
  );
}

/**
 * Fetch + parse a single day's BoE rates for the full {@link BOE_SERIES_TO_CCY}
 * keyset.
 *
 * Throws on non-2xx HTTP. Throws (via {@link parseBoeCsv}) on malformed CSV.
 * Both surface to the cron caller as a fetch failure → `fx_rate_fetch_failed`
 * email per D-06 / D-08.
 */
export async function fetchBoeRatesForDate(isoDate: string): Promise<ParsedRate[]> {
  const url = buildBoeCsvUrl(isoDate, isoDate, Object.keys(BOE_SERIES_TO_CCY));
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`BoE fetch HTTP ${resp.status} for ${isoDate}`);
  const csv = await resp.text();
  return parseBoeCsv(csv);
}
