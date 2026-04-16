import { computeSourceHash } from "@/lib/csv/sales-csv";
import type { SalesDataSource, SalesSourcePullResult } from "./source";

/**
 * Minimal file-like shape we accept. Matches Web File / Blob so callers can
 * pass FormData file entries directly, but we only require what we use
 * (name + arrayBuffer) so tests can stub without pulling in a polyfill.
 */
export type CsvFileLike = {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export class CsvFileSource implements SalesDataSource {
  constructor(private readonly file: CsvFileLike) {}

  async pull(): Promise<SalesSourcePullResult> {
    const buffer = await this.file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return {
      filename: this.file.name,
      sourceLabel: `csv:${this.file.name}`,
      sourceHash: computeSourceHash(bytes),
      bytes,
    };
  }
}
