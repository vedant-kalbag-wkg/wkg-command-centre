"use server";

/**
 * Public server actions for the sales CSV import pipeline.
 *
 * Each action gates on `requireRole('admin')` and then delegates to the
 * _*ForActor helpers in `./pipeline.ts`. Implementation, types, and the
 * testable internal helpers all live there — see its file header for the
 * (security + Turbopack) rationale.
 */

import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import { CsvFileSource } from "@/lib/sales/csv-file-source";
import {
  _cancelImportForActor,
  _commitImportForActor,
  _stageImportForActor,
  type CommitResult,
  type ImportActor,
  type StageSummary,
} from "./pipeline";

async function getActor(): Promise<ImportActor> {
  const session = await requireRole("admin");
  return { id: session.user.id, name: session.user.name ?? session.user.email ?? "admin" };
}

/**
 * Stage a CSV upload. Call from a <form action={stageImport}> — the form must
 * include a `file` field of type File.
 */
export async function stageImport(formData: FormData): Promise<StageSummary> {
  const actor = await getActor();

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Only .csv files are supported");

  return _stageImportForActor(new CsvFileSource(file), actor, db);
}

export async function commitImport(importId: string): Promise<CommitResult> {
  const actor = await getActor();
  return _commitImportForActor(importId, actor, db);
}

export async function cancelImport(importId: string): Promise<void> {
  const actor = await getActor();
  return _cancelImportForActor(importId, actor, db);
}
