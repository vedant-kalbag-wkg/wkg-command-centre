import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the app's drizzle client so importing the route doesn't try to open
// a real DB connection via `@/db`.
vi.mock("@/db", () => ({ db: {} }));

// Mock the ETL orchestrator — each test sets its own return value.
vi.mock("@/lib/sales/etl/azure-etl", () => ({
  runAzureEtl: vi.fn(),
}));

import { runAzureEtl } from "@/lib/sales/etl/azure-etl";
import { POST } from "./route";

const mockedRunAzureEtl = vi.mocked(runAzureEtl);

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/etl/azure/run", {
    method: "POST",
    headers,
  });
}

describe("POST /api/etl/azure/run", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedRunAzureEtl.mockReset();
    // Clean slate — tests opt in to the envs they need.
    delete process.env.ETL_SHARED_SECRET;
    delete process.env.ETL_AZURE_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when no token and no Vercel cron header", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    process.env.ETL_AZURE_ENABLED = "true";

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
    expect(mockedRunAzureEtl).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    process.env.ETL_AZURE_ENABLED = "true";

    const res = await POST(makeRequest({ "x-etl-token": "nope" }));
    expect(res.status).toBe(401);
    expect(mockedRunAzureEtl).not.toHaveBeenCalled();
  });

  it("returns 503 when token is valid but ETL_AZURE_ENABLED is not 'true'", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    // ETL_AZURE_ENABLED intentionally unset.

    const res = await POST(makeRequest({ "x-etl-token": "s3cret" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/ETL disabled/);
    expect(mockedRunAzureEtl).not.toHaveBeenCalled();
  });

  it("returns 200 when authorized + enabled + runAzureEtl returns ok", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    process.env.ETL_AZURE_ENABLED = "true";
    mockedRunAzureEtl.mockResolvedValueOnce({
      status: "ok",
      processed: [{ regionCode: "GB", blobPath: "GB/2026/01/01/x.csv", rows: 3 }],
      skipped: [],
      failed: [],
    });

    const res = await POST(makeRequest({ "x-etl-token": "s3cret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.processed).toHaveLength(1);
    expect(mockedRunAzureEtl).toHaveBeenCalledTimes(1);
  });

  it("returns 207 when ok but some blobs failed", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    process.env.ETL_AZURE_ENABLED = "true";
    mockedRunAzureEtl.mockResolvedValueOnce({
      status: "ok",
      processed: [],
      skipped: [],
      failed: [{ regionCode: "GB", blobPath: "GB/2026/01/01/x.csv", error: "boom" }],
    });

    const res = await POST(makeRequest({ "x-etl-token": "s3cret" }));
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.failed).toHaveLength(1);
  });

  it("returns 409 when the advisory lock was not acquired", async () => {
    process.env.ETL_SHARED_SECRET = "s3cret";
    process.env.ETL_AZURE_ENABLED = "true";
    mockedRunAzureEtl.mockResolvedValueOnce({ status: "skipped-lock" });

    const res = await POST(makeRequest({ "x-etl-token": "s3cret" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("skipped-lock");
  });

  it("returns 200 when Vercel cron header is present + enabled (no token needed)", async () => {
    // No ETL_SHARED_SECRET set — Vercel cron header alone must authorize.
    process.env.ETL_AZURE_ENABLED = "true";
    mockedRunAzureEtl.mockResolvedValueOnce({
      status: "ok",
      processed: [],
      skipped: [],
      failed: [],
    });

    const res = await POST(makeRequest({ "x-vercel-cron": "1" }));
    expect(res.status).toBe(200);
    expect(mockedRunAzureEtl).toHaveBeenCalledTimes(1);
  });
});
