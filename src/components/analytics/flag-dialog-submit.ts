import type { LocationFlag, FlagType, ActionItem } from "@/lib/analytics/types";

/**
 * Submit-handler core for FlagDialog. Extracted from the component so it can
 * be unit-tested without a DOM and without dragging in the server-action
 * import chain (which pulls `db`, auth, audit logging, etc.).
 *
 * Always creates the flag; if `createLinkedAction` is true, also creates a
 * paired investigation action item with `sourceId = flag.id`.
 *
 * Returns `{ ok: true }` on full success, or `{ ok: false, error }` if the
 * paired action failed (the flag itself is preserved — operators can create
 * the action manually from the Flag Review page). The flag-creation call
 * itself is not wrapped: a failure there means nothing happened and the
 * caller should let it bubble to React's transition error handling.
 */

export type FlagDialogCreateFlagFn = (data: {
  locationId: string;
  flagType: FlagType;
  reason?: string;
}) => Promise<LocationFlag>;

export type FlagDialogCreateActionFn = (data: {
  title: string;
  actionType: ActionItem["actionType"];
  description?: string;
  ownerId?: string;
  dueDate?: string;
  locationId?: string;
  sourceType: "flag" | "manual" | "data_quality";
  sourceId?: string;
}) => Promise<ActionItem>;

export type SubmitFlagResult =
  | { ok: true; flagId: string }
  | { ok: false; flagId: string; error: string };

export async function submitFlagWithOptionalAction(args: {
  locationId: string;
  locationName: string;
  flagType: FlagType;
  reason?: string;
  createLinkedAction: boolean;
  createFlagFn: FlagDialogCreateFlagFn;
  createActionItemFn: FlagDialogCreateActionFn;
}): Promise<SubmitFlagResult> {
  const flag = await args.createFlagFn({
    locationId: args.locationId,
    flagType: args.flagType,
    reason: args.reason,
  });

  if (!args.createLinkedAction) {
    return { ok: true, flagId: flag.id };
  }

  try {
    await args.createActionItemFn({
      title: `Investigate ${args.locationName} — ${args.flagType} flag`,
      actionType: "investigation",
      locationId: args.locationId,
      sourceType: "flag",
      sourceId: flag.id,
    });
    return { ok: true, flagId: flag.id };
  } catch (err) {
    return {
      ok: false,
      flagId: flag.id,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
