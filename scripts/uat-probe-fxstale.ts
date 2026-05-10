/**
 * Phase 9.1 UAT diagnostic — reproduce the SSR `getTime()` failure on the
 * preview branch when admin/performance-alerts renders with a back-dated
 * exchange_rates.fetched_at. The Playwright spec hits a Vercel "Server
 * error" page after the operator back-date step; this script runs the same
 * Drizzle query the page does and inspects the runtime type of the
 * `MAX(fetched_at)` value to confirm whether it's a Date or a string. If
 * it's a string, the `.getTime()` call in page.tsx throws a TypeError
 * during SSR.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { exchangeRates } from "@/db/schema";

async function main() {
  const [row] = await db
    .select({ ts: sql<Date | null>`MAX(${exchangeRates.fetchedAt})` })
    .from(exchangeRates);
  const v = row?.ts;
  // eslint-disable-next-line no-console
  console.log("typeof =", typeof v);
  // eslint-disable-next-line no-console
  console.log("isDate =", v instanceof Date);
  // eslint-disable-next-line no-console
  console.log("constructor =", v?.constructor?.name);
  // eslint-disable-next-line no-console
  console.log("raw value =", v);
  if (v instanceof Date) {
    // eslint-disable-next-line no-console
    console.log("getTime() =", v.getTime());
  } else if (typeof v === "string") {
    // eslint-disable-next-line no-console
    console.log("string parsed =", new Date(v).getTime());
  }
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("FAILED", err);
    process.exit(1);
  });
