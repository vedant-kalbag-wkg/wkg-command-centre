import { describe, expect, it, vi } from 'vitest';
import { withStats } from '../cache-stats';

describe('withStats', () => {
  it('returns the wrapped function result unchanged', async () => {
    const wrapped = withStats('q1', async (n: number) => n * 2);
    expect(await wrapped(21)).toBe(42);
  });

  it('logs hit/miss/duration when LOG_CACHE_STATS is set', async () => {
    process.env.LOG_CACHE_STATS = '1';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const wrapped = withStats('q2', async () => 'ok');
      await wrapped();
      expect(spy).toHaveBeenCalledOnce();
      const arg = JSON.parse((spy.mock.calls[0][0] as string));
      expect(arg).toMatchObject({ q: 'q2' });
      expect(typeof arg.dt).toBe('number');
      expect(typeof arg.hit).toBe('boolean');
    } finally {
      spy.mockRestore();
      delete process.env.LOG_CACHE_STATS;
    }
  });

  it('does not log when LOG_CACHE_STATS is unset', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const wrapped = withStats('q3', async () => 'ok');
      await wrapped();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
