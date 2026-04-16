"use server";

import { mergeKiosks } from "@/lib/merge";

export async function mergeKiosksAction(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
) {
  return mergeKiosks(targetId, sourceIds, fieldResolutions);
}
