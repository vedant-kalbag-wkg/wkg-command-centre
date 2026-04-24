/**
 * Performance measurement harness for Phase 0 Gate 3 (Neon driver swap).
 *
 * Issues N authenticated GET requests serially against a set of read-only pages
 * on a target deployment and records:
 *   - Vercel function duration (from `server-timing: fn;dur=<ms>` response header)
 *   - client-observed total request duration
 *
 * Writes a JSON report with per-page p50/p95/p99/mean/samples and prints a
 * compact summary table.
 *
 * Auth: spins up headless chromium, logs in via the /login form using
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD env vars, then reuses the session
 * cookie for subsequent fetch requests.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json \
 *     scripts/perf-measure.ts --url=https://<preview>.vercel.app [--samples=20] [--out=path.json]
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const PAGES = [
  "/analytics/portfolio",
  "/analytics/regions",
  "/analytics/maturity",
  "/analytics/heat-map",
  "/analytics/location-groups",
  "/analytics/hotel-groups",
  "/analytics/compare",
  "/analytics/pivot-table",
  "/analytics/trend-builder",
  "/installations",
  "/kiosks",
  "/locations",
] as const;

type CliArgs = {
  url: string;
  out: string;
  samples: number;
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
      "Missing --url. Usage: perf-measure.ts --url=https://<target> [--samples=N] [--out=path.json]",
    );
    process.exit(1);
  }

  const samples = args.samples ? Number(args.samples) : 20;
  if (!Number.isFinite(samples) || samples <= 0) {
    console.error(`Invalid --samples=${args.samples} (must be a positive integer)`);
    process.exit(1);
  }

  const out =
    args.out ?? path.join("test-results", `perf-${Math.floor(Date.now() / 1000)}.json`);

  return { url: url.replace(/\/$/, ""), out, samples };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

type PageStats = {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  count: number;
  null_count?: number;
  raw: Array<number | null>;
};

function summarise(raw: Array<number | null>, includeNullCount: boolean): PageStats {
  const filtered = raw.filter((v): v is number => v != null);
  const sorted = [...filtered].sort((a, b) => a - b);
  const stats: PageStats = {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: mean(filtered),
    count: filtered.length,
    raw,
  };
  if (includeNullCount) {
    stats.null_count = raw.length - filtered.length;
  }
  return stats;
}

async function loginAndGetCookie(baseUrl: string): Promise<string> {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars are required",
    );
  }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel("Email address").fill(email);
    await page.locator("input#password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/kiosks", { timeout: 15_000 });
    const cookies = await ctx.cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

function parseFnDur(headerValue: string | null): number | null {
  if (!headerValue) return null;
  // server-timing: fn;dur=123.45, cache;desc="HIT"
  const match = headerValue.match(/(?:^|[,\s])fn;dur=([0-9.]+)/);
  return match ? Number.parseFloat(match[1]) : null;
}

type RawSample = { fn: number | null; client: number | null };

async function measurePage(
  baseUrl: string,
  pathname: string,
  samples: number,
  cookieHeader: string,
): Promise<RawSample[]> {
  const out: RawSample[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${baseUrl}${pathname}`, {
        headers: {
          cookie: cookieHeader,
          "user-agent": "perf-measure/1.0",
        },
        redirect: "manual",
      });
      // Drain body so timing reflects the full response.
      await res.arrayBuffer();
      const clientDur = performance.now() - t0;
      const fnDur = parseFnDur(res.headers.get("server-timing"));
      out.push({ fn: fnDur, client: clientDur });
    } catch (err) {
      const clientDur = performance.now() - t0;
      console.warn(
        `  request failed for ${pathname} (sample ${i + 1}/${samples}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // fetch threw — we didn't get a response at all.
      out.push({ fn: null, client: clientDur });
    }
  }
  return out;
}

function formatMs(n: number): string {
  if (!Number.isFinite(n)) return "  -  ";
  return n.toFixed(0).padStart(5, " ");
}

function printSummary(report: Report): void {
  console.log(`\nTarget: ${report.target}`);
  console.log(`Samples per page: ${report.samples_per_page}\n`);
  const header =
    "page".padEnd(30) +
    "p50 (fn)".padStart(10) +
    "p95 (fn)".padStart(10) +
    "mean (fn)".padStart(12) +
    "p95 (client)".padStart(14);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const pathname of PAGES) {
    const pageData = report.pages[pathname];
    if (!pageData) continue;
    const fn = pageData.fn_ms;
    const client = pageData.client_ms;
    console.log(
      pathname.padEnd(30) +
        formatMs(fn.p50).padStart(10) +
        formatMs(fn.p95).padStart(10) +
        formatMs(fn.mean).padStart(12) +
        formatMs(client.p95).padStart(14),
    );
  }
}

type Report = {
  target: string;
  samples_per_page: number;
  timestamp: string;
  pages: Record<string, { fn_ms: PageStats; client_ms: PageStats }>;
};

async function main() {
  const { url, out, samples } = parseArgs(process.argv);

  console.log(`Logging in to ${url} via headless chromium...`);
  const cookieHeader = await loginAndGetCookie(url);
  if (!cookieHeader) {
    throw new Error("Login completed but no cookies were captured");
  }
  console.log("Login OK. Starting measurement run.\n");

  const report: Report = {
    target: url,
    samples_per_page: samples,
    timestamp: new Date().toISOString(),
    pages: {},
  };

  for (const pathname of PAGES) {
    console.log(`Measuring ${pathname} (${samples} samples)...`);
    const raw = await measurePage(url, pathname, samples, cookieHeader);
    report.pages[pathname] = {
      fn_ms: summarise(
        raw.map((r) => r.fn),
        true,
      ),
      client_ms: summarise(
        raw.map((r) => r.client),
        false,
      ),
    };
  }

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReport written to ${out}`);

  printSummary(report);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
