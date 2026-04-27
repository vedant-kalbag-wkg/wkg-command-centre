/**
 * PR-30 / Task 4.12 — FlagDialog paired-action wiring.
 *
 * The dialog used to show two XOR buttons ("Create Flag" vs "Create Action
 * Instead"). It now shows one submit button + an "Also create a linked
 * action item" checkbox. When the checkbox is ticked, the submit handler
 * MUST:
 *   1. Call `createFlag` first (the flag is the canonical record).
 *   2. Then call `createActionItem` with `sourceType="flag"` and
 *      `sourceId = flag.id` so the linked-actions count on the Flag
 *      Review page is accurate.
 *
 * If the action call fails after the flag succeeded, the helper returns
 * `{ ok: false }` and the flag is intentionally NOT rolled back —
 * operators can retry creating the action manually from Flag Review.
 *
 * The helper is extracted into its own file to avoid pulling the server-
 * action import chain (db, auth, audit) into the test boundary.
 */
import { describe, it, expect, vi } from "vitest";
import { submitFlagWithOptionalAction } from "../flag-dialog-submit";
import type { LocationFlag, ActionItem } from "@/lib/analytics/types";

const fakeFlag: LocationFlag = {
  id: "flag-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  locationId: "loc-1",
  flagType: "monitor",
  reason: null,
  actorName: "Tester",
  createdAt: "2026-04-27T00:00:00.000Z",
  resolvedAt: null,
  resolutionNote: null,
};

const fakeAction: ActionItem = {
  id: "action-1",
  sourceType: "flag",
  sourceId: fakeFlag.id,
  locationId: "loc-1",
  locationName: "Test Hotel",
  actionType: "investigation",
  title: "Investigate Test Hotel — monitor flag",
  description: null,
  ownerName: null,
  ownerId: null,
  dueDate: null,
  status: "open",
  outcomeNotes: null,
  resolvedAt: null,
  createdAt: "2026-04-27T00:00:00.000Z",
};

describe("submitFlagWithOptionalAction (Task 4.12)", () => {
  it("createLinkedAction=false: only createFlag is called", async () => {
    const createFlagFn = vi.fn().mockResolvedValue(fakeFlag);
    const createActionItemFn = vi.fn().mockResolvedValue(fakeAction);

    const result = await submitFlagWithOptionalAction({
      locationId: "loc-1",
      locationName: "Test Hotel",
      flagType: "monitor",
      reason: "underperforming",
      createLinkedAction: false,
      createFlagFn,
      createActionItemFn,
    });

    expect(createFlagFn).toHaveBeenCalledTimes(1);
    expect(createFlagFn).toHaveBeenCalledWith({
      locationId: "loc-1",
      flagType: "monitor",
      reason: "underperforming",
    });
    expect(createActionItemFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("createLinkedAction=true: both called, action's sourceId === flag.id", async () => {
    const createFlagFn = vi.fn().mockResolvedValue(fakeFlag);
    const createActionItemFn = vi.fn().mockResolvedValue(fakeAction);

    const result = await submitFlagWithOptionalAction({
      locationId: "loc-1",
      locationName: "Test Hotel",
      flagType: "relocate",
      createLinkedAction: true,
      createFlagFn,
      createActionItemFn,
    });

    expect(createFlagFn).toHaveBeenCalledTimes(1);
    expect(createActionItemFn).toHaveBeenCalledTimes(1);

    const actionArgs = createActionItemFn.mock.calls[0]![0];
    expect(actionArgs.sourceType).toBe("flag");
    expect(actionArgs.sourceId).toBe(fakeFlag.id);
    expect(actionArgs.locationId).toBe("loc-1");
    expect(actionArgs.actionType).toBe("investigation");
    expect(actionArgs.title).toBe("Investigate Test Hotel — relocate flag");

    expect(result).toEqual({ ok: true, flagId: fakeFlag.id });
  });

  it("createFlag is awaited before createActionItem (sequential, not parallel)", async () => {
    const callOrder: string[] = [];
    const createFlagFn = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push("flag");
      return fakeFlag;
    });
    const createActionItemFn = vi.fn().mockImplementation(async () => {
      callOrder.push("action");
      return fakeAction;
    });

    await submitFlagWithOptionalAction({
      locationId: "loc-1",
      locationName: "Test Hotel",
      flagType: "monitor",
      createLinkedAction: true,
      createFlagFn,
      createActionItemFn,
    });

    expect(callOrder).toEqual(["flag", "action"]);
  });

  it("paired-action failure: returns ok=false with flagId; flag is NOT rolled back", async () => {
    const createFlagFn = vi.fn().mockResolvedValue(fakeFlag);
    const createActionItemFn = vi
      .fn()
      .mockRejectedValue(new Error("DB constraint violation"));

    const result = await submitFlagWithOptionalAction({
      locationId: "loc-1",
      locationName: "Test Hotel",
      flagType: "monitor",
      createLinkedAction: true,
      createFlagFn,
      createActionItemFn,
    });

    expect(createFlagFn).toHaveBeenCalledTimes(1);
    expect(createActionItemFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      flagId: fakeFlag.id,
      error: "DB constraint violation",
    });
    // Crucially: NO compensating delete on createFlagFn — the flag stays.
  });

  it("flag-creation failure: error bubbles, action is never called", async () => {
    const createFlagFn = vi
      .fn()
      .mockRejectedValue(new Error("flag insert failed"));
    const createActionItemFn = vi.fn();

    await expect(
      submitFlagWithOptionalAction({
        locationId: "loc-1",
        locationName: "Test Hotel",
        flagType: "monitor",
        createLinkedAction: true,
        createFlagFn,
        createActionItemFn,
      }),
    ).rejects.toThrow(/flag insert failed/);

    expect(createActionItemFn).not.toHaveBeenCalled();
  });
});
