"use server";

import { mergeLocations } from "@/lib/merge";

export async function mergeLocationsAction(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
) {
  return mergeLocations(targetId, sourceIds, fieldResolutions);
}
