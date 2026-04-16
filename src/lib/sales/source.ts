/**
 * SalesDataSource — abstraction over "where the raw sales bytes come from."
 *
 * Phase 1 (this file + csv-file-source.ts) has one concrete impl:
 * `CsvFileSource` wraps a Web File from a FormData upload.
 *
 * Phase 3 will add e.g. `SupabaseExportSource` that reads a CSV dump from
 * Supabase storage, without touching the staging pipeline — _stageImport
 * takes a SalesDataSource and calls pull() on it.
 *
 * Why bytes + label + hash (and not parsed rows)? Two reasons:
 *   1. The pipeline needs to STAGE invalid rows so the admin UI can show
 *      them. Moving parsing into the source would hide that.
 *   2. sourceHash must derive from the exact bytes that were persisted,
 *      so duplicate-upload detection is faithful to what hit the server.
 */

export type SalesSourcePullResult = {
  filename: string;
  sourceLabel: string; // "csv:filename.csv" today; "supabase:YYYY-MM-DD→YYYY-MM-DD" in Phase 3
  sourceHash: string;
  bytes: Uint8Array;
};

export interface SalesDataSource {
  pull(): Promise<SalesSourcePullResult>;
}
