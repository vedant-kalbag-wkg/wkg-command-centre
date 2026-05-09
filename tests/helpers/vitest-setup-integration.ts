/**
 * Vitest global setup for integration tests.
 *
 * Mocks `next/cache` so that `unstable_cache` is a transparent pass-through.
 * This prevents the "Invariant: incrementalCache missing in unstable_cache"
 * error thrown by Next.js when `unstable_cache` is called outside a Next.js
 * request context (i.e. in a Testcontainers/node vitest environment).
 *
 * Must be registered as `setupFiles` in the integration project config.
 */

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  // Make unstable_cache a transparent pass-through: returns the fn directly
  // so callers get the bare async function without any caching layer.
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
