import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getAzureBlobClient", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_URL;
  });

  it("uses connection string when provided", async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
    const { getAzureBlobClient } = await import("./azure-client");
    const client = getAzureBlobClient();
    expect(client).toBeDefined();
  });

  it("uses DefaultAzureCredential when AZURE_STORAGE_ACCOUNT_URL is set", async () => {
    process.env.AZURE_STORAGE_ACCOUNT_URL = "https://x.blob.core.windows.net";
    const { getAzureBlobClient } = await import("./azure-client");
    const client = getAzureBlobClient();
    expect(client).toBeDefined();
  });

  it("throws when neither env var is set", async () => {
    const { getAzureBlobClient } = await import("./azure-client");
    expect(() => getAzureBlobClient()).toThrow(/AZURE_STORAGE_CONNECTION_STRING/);
  });
});
