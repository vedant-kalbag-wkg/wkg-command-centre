import type { BlobServiceClient } from "@azure/storage-blob";
import { basename } from "node:path";
import { computeSourceHash } from "@/lib/csv/sales-csv";
import type { SalesDataSource, SalesSourcePullResult } from "./source";

/**
 * AzureBlobSource — pulls a single CSV blob from Azure Blob Storage.
 *
 * The client is injected (not constructed here) so tests can stub the
 * `BlobServiceClient` shape without touching env vars or the auth factory.
 * Production callers should obtain `client` from {@link getAzureBlobClient}.
 *
 * Return type extends {@link SalesSourcePullResult} with the blob's `etag`
 * (quotes stripped) so the ETL layer can persist it for idempotency / audit.
 * The base interface stays unchanged — `etag` is additive metadata.
 */

export type AzureBlobSourceOptions = {
  containerName: string;
  blobPath: string;
  client: BlobServiceClient;
};

export type AzureBlobPullResult = SalesSourcePullResult & {
  etag: string | null;
};

export class AzureBlobSource implements SalesDataSource {
  constructor(private readonly opts: AzureBlobSourceOptions) {}

  async pull(): Promise<AzureBlobPullResult> {
    const container = this.opts.client.getContainerClient(
      this.opts.containerName,
    );
    const blob = container.getBlobClient(this.opts.blobPath);
    const buffer = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    const bytes = new Uint8Array(buffer);
    const rawEtag = (props.etag ?? "").replace(/^"|"$/g, "");
    const etag = rawEtag.length > 0 ? rawEtag : null;
    return {
      filename: basename(this.opts.blobPath),
      sourceLabel: `azure:${this.opts.containerName}/${this.opts.blobPath}`,
      sourceHash: computeSourceHash(bytes),
      bytes,
      etag,
    };
  }
}
