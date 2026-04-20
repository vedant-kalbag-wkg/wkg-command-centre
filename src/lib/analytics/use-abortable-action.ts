/**
 * Discard stale server-action results when the component unmounts or a newer
 * call has been dispatched.
 *
 * Server actions in Next.js 16 don't natively honour an AbortSignal from the
 * client — the promise always resolves. To avoid a late result flashing into
 * the UI (or setting state on an unmounted component) we guard with a
 * monotonic request id captured at dispatch time: if the ref has moved on,
 * the result is discarded and callers receive `null`.
 */
import { useCallback, useEffect, useRef } from "react";

/**
 * Pure factory used by the hook. Exported so it can be exercised in a plain
 * Node test environment without a DOM.
 */
export function createAbortableDispatcher<
  TArgs extends unknown[],
  TResult,
>(action: (...args: TArgs) => Promise<TResult>) {
  let reqId = 0;
  let mounted = true;

  const dispatch = async (...args: TArgs): Promise<TResult | null> => {
    const id = ++reqId;
    const result = await action(...args);
    if (!mounted || id !== reqId) return null;
    return result;
  };

  const unmount = () => {
    mounted = false;
  };

  return { dispatch, unmount };
}

export function useAbortableAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      const id = ++reqIdRef.current;
      const result = await action(...args);
      if (!mountedRef.current || id !== reqIdRef.current) return null;
      return result;
    },
    [action],
  );
}
