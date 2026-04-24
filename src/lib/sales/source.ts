/**
 * SalesDataSource — abstraction over "where the raw sales bytes come from."
 *
 * The current concrete impl is `AzureBlobSource` (see ./azure-blob-source.ts),
 * which pulls a CSV blob from Azure Blob Storage. The interface is kept for
 * pluggability — alternative sources (e.g. an S3 export, a direct NetSuite
 * API pull) can be added without touching the staging pipeline, which only
 * depends on `pull()` returning bytes + label + hash.
 *
 * Why bytes + label + hash (and not parsed rows)? Two reasons:
 *   1. The pipeline needs to STAGE invalid rows so the admin UI can show
 *      them. Moving parsing into the source would hide that.
 *   2. sourceHash must derive from the exact bytes that were persisted,
 *      so duplicate-ingestion detection is faithful to what hit the server.
 */

export type SalesSourcePullResult = {
  filename: string;
  sourceLabel: string; // e.g. "azure:<container>/<blobPath>"
  sourceHash: string;
  bytes: Uint8Array;
};

export interface SalesDataSource {
  pull(): Promise<SalesSourcePullResult>;
}
