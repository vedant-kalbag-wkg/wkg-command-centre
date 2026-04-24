import { describe, it, expect } from "vitest";
import { AzureBlobSource } from "./azure-blob-source";

function mockClient(bytes: Buffer, etag: string = '"abc-123"') {
  return {
    getContainerClient: () => ({
      getBlobClient: () => ({
        downloadToBuffer: async () => bytes,
        getProperties: async () => ({ etag }),
      }),
    }),
  } as unknown as import("@azure/storage-blob").BlobServiceClient;
}

describe("AzureBlobSource", () => {
  it("pull() returns filename, sourceLabel, bytes, hash, etag", async () => {
    const bytes = Buffer.from("Saleref,Ref No\n1,X\n");
    const source = new AzureBlobSource({
      containerName: "clientdata",
      blobPath: "GB/2026/04/23/sales.csv",
      client: mockClient(bytes),
    });
    const r = await source.pull();
    expect(r.filename).toBe("sales.csv");
    expect(r.sourceLabel).toBe("azure:clientdata/GB/2026/04/23/sales.csv");
    expect(r.bytes).toHaveLength(bytes.length);
    expect(r.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.etag).toBe("abc-123"); // surrounding double-quotes stripped
  });

  it("returns null etag when blob has no etag", async () => {
    const bytes = Buffer.from("x");
    const source = new AzureBlobSource({
      containerName: "c",
      blobPath: "GB/2026/04/23/empty.csv",
      client: mockClient(bytes, ""),
    });
    const r = await source.pull();
    expect(r.etag).toBeNull();
  });
});
