/**
 * Phase 9.1 UAT helper — invoke the same code path as the fx-rates-fetch-daily
 * cron, but for an arbitrary isoDate or date range. Used during the autonomous
 * UAT run to populate `exchange_rates` from the live BoE IADB endpoint when
 * the Inngest dashboard cron has not yet fired for the test branch.
 *
 * Run:
 *   DATABASE_URL='<env>' npx tsx --tsconfig tsconfig.json \
 *     scripts/uat-trigger-fx-fetch.ts \
 *       [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--date=YYYY-MM-DD]
 *
 *   `--date` alone fetches that single day. `--from` + `--to` fetches the
 *   full inclusive range in one BoE call (BoE supports range queries on the
 *   IADB endpoint — RESEARCH Open Question #1 — so the historical backfill
 *   can prime months of data with a single round-trip). Defaults to today
 *   (Europe/London).
 *
 * Mirrors the cron's step 1 (fetch-boe via `buildBoeCsvUrl`+`parseBoeCsv`)
 * and step 2 (upsert-rates with the same `onConflictDoNothing` shape). Skips
 * step 3 (write-run-audit) — `audit_logs` is not load-bearing for any UAT
 * assertion and the writer expects an authenticated Inngest runtime.
 */
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { buildBoeCsvUrl, parseBoeCsv, type ParsedRate } from "@/lib/fx/boe-fetch";
import { BOE_SERIES_TO_CCY } from "@/lib/fx/currencies";

function todayIsoLondon(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function readArg(name: string): string | undefined {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

async function fetchBoeRange(from: string, to: string): Promise<ParsedRate[]> {
  const url = buildBoeCsvUrl(from, to, Object.keys(BOE_SERIES_TO_CCY));
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`BoE fetch HTTP ${resp.status} (${from}..${to})`);
  const csv = await resp.text();
  return parseBoeCsv(csv);
}

async function main() {
  const dateArg = readArg("date");
  const fromArg = readArg("from");
  const toArg = readArg("to");

  const today = todayIsoLondon();
  const from = fromArg ?? dateArg ?? today;
  const to = toArg ?? dateArg ?? today;

  // eslint-disable-next-line no-console
  console.log(`[uat-fx] today (London)=${today} from=${from} to=${to} series=${Object.keys(BOE_SERIES_TO_CCY).length}`);

  const rates = await fetchBoeRange(from, to);
  // eslint-disable-next-line no-console
  console.log(`[uat-fx] BoE returned ${rates.length} rate rows across ${new Set(rates.map((r) => r.rateDate)).size} dates`);

  if (rates.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[uat-fx] empty payload (weekend/holiday/non-publish range). Try a different range.");
    return;
  }

  // Upsert in chunks — BoE's range endpoint can return ~3k rows for a 4-month window
  // (~25 currencies × ~80 weekdays). pg's default max param is 65k, so a 1k-row chunk
  // (~5k params at 5 columns each) is safe.
  const CHUNK = 1000;
  let upserted = 0;
  for (let i = 0; i < rates.length; i += CHUNK) {
    const slice = rates.slice(i, i + CHUNK);
    const result = await db
      .insert(exchangeRates)
      .values(
        slice.map((r) => ({
          currency: r.currency,
          rateDate: r.rateDate,
          rateToGbp: String(r.rate),
          source: "boe" as const,
        })),
      )
      .onConflictDoNothing({
        target: [exchangeRates.currency, exchangeRates.rateDate],
      });
    upserted += (result as { rowCount?: number }).rowCount ?? 0;
  }
  // eslint-disable-next-line no-console
  console.log(`[uat-fx] upsert ok (rowCount=${upserted})`);

  // GBP identity rows for every distinct rate_date BoE published — backfill's
  // D-04 GBP shortcut bypasses the rate lookup, but other downstream surfaces
  // (e.g. analytics joins that LEFT-JOIN exchange_rates for symbol resolution)
  // expect a row to exist. Idempotent on the (currency, rate_date) PK.
  const distinctDates = Array.from(new Set(rates.map((r) => r.rateDate)));
  await db
    .insert(exchangeRates)
    .values(
      distinctDates.map((d) => ({
        currency: "GBP",
        rateDate: d,
        rateToGbp: "1.0000000000",
        source: "boe" as const,
      })),
    )
    .onConflictDoNothing({
      target: [exchangeRates.currency, exchangeRates.rateDate],
    });
  // eslint-disable-next-line no-console
  console.log(`[uat-fx] GBP identity rows ensured for ${distinctDates.length} dates`);
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[uat-fx] FAILED", err);
    process.exit(1);
  });
