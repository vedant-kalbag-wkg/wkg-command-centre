/**
 * Phase 1 synthetic load generator.
 *
 * Walks every measured route on a target Vercel preview URL, issuing
 * `iterations` serial authenticated navigations per route. The point is to
 * fill `pg_stat_statements` on the backing Neon dev branch with
 * representative traffic so the companion analysis tooling has something to
 * read.
 *
 * This script's contract is explicitly "generate traffic":
 *   - no timing capture
 *   - no JSON report
 *   - no statistics
 * Timing / reporting lives in `scripts/perf-measure.ts` (Phase 0 Gate 3) and
 * `scripts/phase-1-measure.ts` (Task 5).
 *
 * Traffic generation: browser navigation via Playwright. Every page under
 * `/analytics/*` in this codebase is a `"use client"` component whose DB
 * queries only fire after client hydration triggers server actions
 * (`fetchHeatMapData`, `fetchHotelGroupsList`, ...). A raw `fetch()` request
 * would return the HTML shell without ever running the client JS, leaving
 * `pg_stat_statements` empty for the analytics tables. Driving each route
 * with `page.goto()` + `waitForLoadState('networkidle')` forces hydration
 * and lets the client-side fetches complete, so the queries land where we
 * can measure them.
 *
 * Auth: spins up headless chromium, logs in via the /login form using
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD env vars, then keeps the same
 * authenticated `Page` for every subsequent navigation (cookies live on the
 * browser context natively).
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json \
 *     scripts/phase-1-load.ts --url=https://<preview>.vercel.app [--iterations=5]
 */
import { performance } from "node:perf_hooks";
import { chromium, errors as playwrightErrors } from "@playwright/test";

const ROUTES = [
  "/analytics/heat-map",
  "/analytics/hotel-groups",
  "/installations",
  "/kiosks",
  "/locations",
  "/analytics/portfolio",
  "/analytics/commission",
  "/analytics/trend-builder",
  "/analytics/experiments",
  "/analytics/actions-dashboard",
] as const;

type CliArgs = {
  url: string;
  iterations: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const raw of argv.slice(2)) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }

  const url = args.url;
  if (!url) {
    console.error(
      "Missing --url. Usage: phase-1-load.ts --url=https://<target> [--iterations=N]",
    );
    process.exit(1);
  }

  const iterationsArg = args.iterations ?? "5";
  const iterations = Number(iterationsArg);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    console.error(
      `Invalid --iterations=${iterationsArg} (must be a positive integer)`,
    );
    process.exit(1);
  }

  return { url: url.replace(/\/$/, ""), iterations };
}

async function main() {
  const { url, iterations } = parseArgs(process.argv);

  // Env check surfaced early with a clean exit code rather than an uncaught
  // throw out of the login path.
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      "TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars are required",
    );
    process.exit(1);
  }

  console.log(`Logging in to ${url} via headless chromium...`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(`${url}/login`);
    await page.getByLabel("Email address").fill(email);
    await page.locator("input#password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/kiosks", { timeout: 15_000 });

    console.log("Login OK. Starting load run.\n");

    let totalRequests = 0;
    let warnings = 0;
    let errors = 0;

    for (let idx = 0; idx < ROUTES.length; idx++) {
      const route = ROUTES[idx];
      console.log(
        `Route ${idx + 1}/${ROUTES.length}: ${route} \u00d7 ${iterations}`,
      );
      const t0 = performance.now();

      for (let i = 1; i <= iterations; i++) {
        totalRequests += 1;
        try {
          const resp = await page.goto(`${url}${route}`, {
            waitUntil: "networkidle",
            timeout: 45_000,
          });
          if (!resp) {
            console.log(`WARN ${route} iter=${i} no-response`);
            warnings += 1;
            continue;
          }
          const status = resp.status();
          if (status < 200 || status >= 300) {
            warnings += 1;
            console.log(`WARN ${route} iter=${i} status=${status}`);
          }
        } catch (err) {
          if (err instanceof playwrightErrors.TimeoutError) {
            warnings += 1;
            console.log(`WARN ${route} iter=${i} timeout-45s`);
            continue;
          }
          errors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`ERROR ${route} iter=${i} ${msg}`);
        }
      }

      const elapsed = performance.now() - t0;
      console.log(`  done in ${elapsed.toFixed(0)} ms`);
    }

    console.log(
      `\nLoad complete. Total requests: ${totalRequests}. Warnings: ${warnings}. Errors: ${errors}.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
