// LocalFileSource — pulls a single sales CSV from disk so the Phase 7
// wipe-and-reseed runbook (scripts/v2-wipe-and-reseed.ts) can drive the
// existing stage+commit pipeline against `seed_data/*.csv` without going
// through Azure blob storage. CSV byte format is identical to what
// AzureBlobSource yields — the runbook's filename → (regionId, blobDate)
// inference handles the metadata that the path pattern would otherwise
// encode.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { computeSourceHash } from "@/lib/csv/sales-csv";

import type { SalesDataSource, SalesSourcePullResult } from "./source";

export type LocalFileSourceOptions = {
  /** Absolute or process-relative path to the CSV. */
  path: string;
};

export class LocalFileSource implements SalesDataSource {
  constructor(private readonly opts: LocalFileSourceOptions) {}

  async pull(): Promise<SalesSourcePullResult> {
    const buffer = await readFile(this.opts.path);
    const bytes = new Uint8Array(buffer);
    return {
      filename: basename(this.opts.path),
      sourceLabel: `local:${this.opts.path}`,
      sourceHash: computeSourceHash(bytes),
      bytes,
    };
  }
}
