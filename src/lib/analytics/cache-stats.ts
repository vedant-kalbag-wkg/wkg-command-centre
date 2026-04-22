type AsyncFn<TArgs extends unknown[], TR> = (...args: TArgs) => Promise<TR>;

/**
 * Wraps an async query function with opt-in hit/miss/duration logging.
 * Enable with LOG_CACHE_STATS=1. The `hit` flag uses a duration heuristic
 * (< 10 ms) to distinguish cache-served calls from origin round-trips; not
 * authoritative but sufficient for rolling up cache-effectiveness from logs.
 */
export function withStats<TArgs extends unknown[], TR>(
  name: string,
  fn: AsyncFn<TArgs, TR>,
): AsyncFn<TArgs, TR> {
  return async (...args: TArgs) => {
    const t0 = performance.now();
    const result = await fn(...args);
    const dt = performance.now() - t0;
    if (process.env.LOG_CACHE_STATS) {
      console.log(JSON.stringify({ q: name, dt: Math.round(dt * 100) / 100, hit: dt < 10 }));
    }
    return result;
  };
}
