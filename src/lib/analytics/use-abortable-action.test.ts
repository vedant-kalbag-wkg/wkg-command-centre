import { describe, it, expect } from "vitest";
import { createAbortableDispatcher } from "./use-abortable-action";

/**
 * The hook itself is a thin React wrapper around `createAbortableDispatcher`.
 * Testing the pure factory verifies the stale-result discard contract without
 * needing a DOM renderer.
 */
describe("createAbortableDispatcher", () => {
  it("returns the result of a single call", async () => {
    const action = async (x: number) => x * 2;
    const { dispatch } = createAbortableDispatcher(action);

    await expect(dispatch(5)).resolves.toBe(10);
  });

  it("discards the first result when a second call is dispatched before it resolves", async () => {
    // Two deferred promises we can resolve in reverse order.
    const resolvers: Array<() => void> = [];
    const action = (value: string) =>
      new Promise<string>((resolve) => {
        resolvers.push(() => resolve(value));
      });

    const { dispatch } = createAbortableDispatcher(action);

    const first = dispatch("first");
    const second = dispatch("second");

    // Resolve in reverse order: second finishes first, then the stale first.
    resolvers[1]!();
    resolvers[0]!();

    // The newer (second) call wins — it returns its own value.
    await expect(second).resolves.toBe("second");
    // The older (first) call is stale and must resolve to null.
    await expect(first).resolves.toBeNull();
  });

  it("returns null when unmounted before the action resolves", async () => {
    let resolveAction: ((value: number) => void) | null = null;
    const action = () =>
      new Promise<number>((resolve) => {
        resolveAction = resolve as (value: number) => void;
      });

    const { dispatch, unmount } = createAbortableDispatcher(action);

    const pending = dispatch();
    unmount();
    (resolveAction as ((value: number) => void) | null)?.(42);

    await expect(pending).resolves.toBeNull();
  });

  it("returns null for every in-flight call after unmount", async () => {
    const resolvers: Array<() => void> = [];
    const action = () =>
      new Promise<number>((resolve) => {
        resolvers.push(() => resolve(1));
      });

    const { dispatch, unmount } = createAbortableDispatcher(action);

    const a = dispatch();
    const b = dispatch();

    unmount();
    resolvers.forEach((r) => r());

    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toBeNull();
  });
});
