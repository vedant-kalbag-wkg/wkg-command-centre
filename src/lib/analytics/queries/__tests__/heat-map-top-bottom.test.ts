import { describe, it, expect } from "vitest";
import { pickTopAndBottom } from "../heat-map";

// Phase 4.9 — Top-N / Bottom-N selector regression. Pre-fix `slice(-N)`
// overlapped `slice(0, N)` for any list of length N+1..2N (e.g. with N=20 and
// 30 outlets, the bottom slice silently included 10 of the top entries).
describe("pickTopAndBottom", () => {
  const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("empty input → empty top + bottom", () => {
    expect(pickTopAndBottom(seq(0), 20)).toEqual({ top: [], bottom: [] });
  });

  it("size ≤ N → all in top, bottom empty (avoid duplicate display)", () => {
    expect(pickTopAndBottom(seq(20), 20)).toEqual({ top: seq(20), bottom: [] });
    expect(pickTopAndBottom(seq(7), 20)).toEqual({ top: seq(7), bottom: [] });
  });

  it("21..39 elements → top is 0..N-1, bottom is N..size-1 reversed (no overlap)", () => {
    for (const size of [21, 25, 30, 39]) {
      const { top, bottom } = pickTopAndBottom(seq(size), 20);
      expect(top).toEqual(seq(20));
      expect(bottom).toEqual(
        Array.from({ length: size - 20 }, (_, i) => size - 1 - i),
      );
      const overlap = top.filter((x) => bottom.includes(x));
      expect(overlap).toEqual([]);
    }
  });

  it("≥ 2N elements → top first N, bottom last N reversed", () => {
    const size = 100;
    const { top, bottom } = pickTopAndBottom(seq(size), 20);
    expect(top).toEqual(seq(20));
    expect(bottom).toEqual(
      Array.from({ length: 20 }, (_, i) => size - 1 - i),
    );
    expect(top.filter((x) => bottom.includes(x))).toEqual([]);
  });

  it("preserves input order in each slice (no in-place mutation of source)", () => {
    const ranked = ["a", "b", "c", "d", "e"];
    const snapshot = [...ranked];
    pickTopAndBottom(ranked, 2);
    expect(ranked).toEqual(snapshot);
  });
});
