import { NextResponse } from "next/server";
import { db } from "@/db";
import { runAzureEtl } from "@/lib/sales/etl/azure-etl";

/**
 * Azure ETL HTTP entry point.
 *
 * Auth is satisfied by either:
 *   - Vercel cron (`x-vercel-cron: 1` — only Vercel's platform can set this), or
 *   - a manual caller with `x-etl-token: <ETL_SHARED_SECRET>`.
 *
 * Gated behind `ETL_AZURE_ENABLED=true` so the schedule is a no-op until we
 * flip the flag in prod.
 *
 * Status codes:
 *   200 — ok, nothing failed
 *   207 — ok, but one or more blobs failed (partial success)
 *   401 — unauthorized (neither Vercel cron header nor valid token)
 *   409 — another run holds the advisory lock
 *   503 — feature flag disabled
 */
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — blob enumeration can be slow

export async function POST(req: Request) {
  const token = req.headers.get("x-etl-token");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const authorized =
    isVercelCron || (!!token && token === process.env.ETL_SHARED_SECRET);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.ETL_AZURE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "ETL disabled (set ETL_AZURE_ENABLED=true)" },
      { status: 503 },
    );
  }
  const result = await runAzureEtl(db);
  const status =
    result.status === "skipped-lock"
      ? 409
      : result.status === "ok" && result.failed.length > 0
        ? 207
        : 200;
  return NextResponse.json(result, { status });
}
