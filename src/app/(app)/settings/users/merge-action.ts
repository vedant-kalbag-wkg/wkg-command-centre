"use server";

import { mergeUsers } from "@/lib/merge";

export async function mergeUsersAction(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown>
) {
  return mergeUsers(targetId, sourceIds, fieldResolutions);
}
