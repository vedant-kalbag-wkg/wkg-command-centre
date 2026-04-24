"use server";

/**
 * Manual sales CSV import has been replaced by the Azure ETL (Phase 5 of the
 * NetSuite ETL restructure). The legacy server actions — stageImport,
 * commitImport, cancelImport — are retained as stubs that throw a clear
 * migration pointer so anything still wired to them surfaces loudly instead
 * of silently doing the wrong thing.
 *
 * Phase 8 will remove this file entirely along with the upload UI.
 */

const DEPRECATION_MESSAGE =
  "Manual CSV import has been replaced by the Azure ETL. See POST /api/etl/azure/run or `npm run etl:azure`.";

export async function stageImport(_formData: FormData): Promise<never> {
  throw new Error(DEPRECATION_MESSAGE);
}

export async function commitImport(_importId: string): Promise<never> {
  throw new Error(DEPRECATION_MESSAGE);
}

export async function cancelImport(_importId: string): Promise<never> {
  throw new Error(DEPRECATION_MESSAGE);
}
