import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Auth factory for the Azure Blob client.
 *
 * Branches (in order):
 *   1. AZURE_STORAGE_CONNECTION_STRING → BlobServiceClient.fromConnectionString
 *      (preferred for local dev + Azurite).
 *   2. AZURE_STORAGE_ACCOUNT_URL       → DefaultAzureCredential chain
 *      (managed identity in Azure, env creds, CLI, VS Code — in that order).
 *   3. Neither set                     → throw with clear guidance.
 *
 * The client is memoised. Tests that need a different client shouldn't reach
 * for a cache-reset hook — they should inject the client directly via the
 * caller's `{ client }` option (see `runAzureEtl`, `AzureBlobSource`).
 */

let cached: BlobServiceClient | null = null;

export function getAzureBlobClient(): BlobServiceClient {
  if (cached) return cached;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (conn) {
    cached = BlobServiceClient.fromConnectionString(conn);
    return cached;
  }
  const url = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (!url) {
    throw new Error(
      "Azure not configured: set AZURE_STORAGE_CONNECTION_STRING (dev) or AZURE_STORAGE_ACCOUNT_URL (prod)",
    );
  }
  cached = new BlobServiceClient(url, new DefaultAzureCredential());
  return cached;
}
