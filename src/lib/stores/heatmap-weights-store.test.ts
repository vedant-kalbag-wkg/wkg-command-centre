import { describe, it, expect, beforeEach } from "vitest";
import {
  useHeatmapWeightsStore,
  DEFAULT_WEIGHTS,
  toScoreWeights,
  type HeatmapWeights,
} from "./heatmap-weights-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useHeatmapWeightsStore.setState({
    weights: { ...DEFAULT_WEIGHTS },
    pending: { ...DEFAULT_WEIGHTS },
    isDirty: false,
  });
}

function getState() {
  return useHeatmapWeightsStore.getState();
}

describe("heatmap-weights-store — defaults", () => {
  beforeEach(resetStore);

  it("initial weights match the 30/20/25/15/10 preset", () => {
    const { weights } = getState();
    expect(weights).toEqual({
      revenue: 30,
      transactions: 20,
      revenuePerRoom: 25,
      txnPerKiosk: 15,
      basketValue: 10,
    });
  });

  it("initial pending equals weights and isDirty is false", () => {
    const { weights, pending, isDirty } = getState();
    expect(pending).toEqual(weights);
    expect(isDirty).toBe(false);
  });

  it("DEFAULT_WEIGHTS sums to 100", () => {
    const total =
      DEFAULT_WEIGHTS.revenue +
      DEFAULT_WEIGHTS.transactions +
      DEFAULT_WEIGHTS.revenuePerRoom +
      DEFAULT_WEIGHTS.txnPerKiosk +
      DEFAULT_WEIGHTS.basketValue;
    expect(total).toBe(100);
  });
});

describe("heatmap-weights-store — sum()", () => {
  beforeEach(resetStore);

  it("computes the sum of pending weights", () => {
    expect(getState().sum()).toBe(100);

    getState().setPending("revenue", 50);
    // 50 + 20 + 25 + 15 + 10 = 120
    expect(getState().sum()).toBe(120);

    getState().setPending("basketValue", 0);
    // 50 + 20 + 25 + 15 + 0 = 110
    expect(getState().sum()).toBe(110);
  });
});

describe("heatmap-weights-store — setPending()", () => {
  beforeEach(resetStore);

  it("updates only the given key", () => {
    getState().setPending("revenue", 40);
    const { pending } = getState();
    expect(pending.revenue).toBe(40);
    expect(pending.transactions).toBe(20);
    expect(pending.revenuePerRoom).toBe(25);
  });

  it("marks the store dirty when pending differs from weights", () => {
    expect(getState().isDirty).toBe(false);
    getState().setPending("revenue", 40);
    expect(getState().isDirty).toBe(true);
  });

  it("becomes clean again when pending is restored to weights", () => {
    getState().setPending("revenue", 40);
    expect(getState().isDirty).toBe(true);
    getState().setPending("revenue", 30);
    expect(getState().isDirty).toBe(false);
  });

  it("clamps negative values to 0", () => {
    getState().setPending("revenue", -10);
    expect(getState().pending.revenue).toBe(0);
  });

  it("clamps values above 100 to 100", () => {
    getState().setPending("revenue", 250);
    expect(getState().pending.revenue).toBe(100);
  });

  it("rounds fractional inputs to integers", () => {
    getState().setPending("revenue", 30.7);
    expect(getState().pending.revenue).toBe(31);
  });

  it("coerces NaN/Infinity to 0", () => {
    getState().setPending("revenue", NaN);
    expect(getState().pending.revenue).toBe(0);
    getState().setPending("revenue", Infinity);
    expect(getState().pending.revenue).toBe(0);
  });
});

describe("heatmap-weights-store — apply()", () => {
  beforeEach(resetStore);

  it("returns true and copies pending → weights when sum === 100", () => {
    // Redistribute: 50/10/20/10/10 = 100
    const next: HeatmapWeights = {
      revenue: 50,
      transactions: 10,
      revenuePerRoom: 20,
      txnPerKiosk: 10,
      basketValue: 10,
    };
    (Object.keys(next) as (keyof HeatmapWeights)[]).forEach((k) =>
      getState().setPending(k, next[k]),
    );
    expect(getState().sum()).toBe(100);

    const ok = getState().apply();
    expect(ok).toBe(true);
    expect(getState().weights).toEqual(next);
    expect(getState().isDirty).toBe(false);
  });

  it("returns false and does NOT copy when sum !== 100", () => {
    getState().setPending("revenue", 90); // total = 160
    expect(getState().sum()).toBe(160);

    const ok = getState().apply();
    expect(ok).toBe(false);
    // Weights still match original default
    expect(getState().weights).toEqual(DEFAULT_WEIGHTS);
    // Pending retained its dirty value
    expect(getState().pending.revenue).toBe(90);
    expect(getState().isDirty).toBe(true);
  });

  it("returns false when sum is under 100", () => {
    getState().setPending("revenue", 0); // total = 70
    expect(getState().apply()).toBe(false);
    expect(getState().weights).toEqual(DEFAULT_WEIGHTS);
  });
});

describe("heatmap-weights-store — reset()", () => {
  beforeEach(resetStore);

  it("restores both weights and pending to DEFAULT_WEIGHTS", () => {
    // Drift pending and apply a different set of weights.
    getState().setPending("revenue", 50);
    getState().setPending("transactions", 10);
    getState().setPending("revenuePerRoom", 20);
    getState().setPending("txnPerKiosk", 10);
    getState().setPending("basketValue", 10);
    getState().apply();
    expect(getState().weights.revenue).toBe(50);

    getState().reset();
    expect(getState().weights).toEqual(DEFAULT_WEIGHTS);
    expect(getState().pending).toEqual(DEFAULT_WEIGHTS);
    expect(getState().isDirty).toBe(false);
  });

  it("clears dirty pending edits", () => {
    getState().setPending("revenue", 99);
    expect(getState().isDirty).toBe(true);
    getState().reset();
    expect(getState().isDirty).toBe(false);
    expect(getState().pending).toEqual(DEFAULT_WEIGHTS);
  });
});

describe("toScoreWeights()", () => {
  it("converts percent integers to 0–1 fractions", () => {
    expect(toScoreWeights(DEFAULT_WEIGHTS)).toEqual({
      revenue: 0.3,
      transactions: 0.2,
      revenuePerRoom: 0.25,
      txnPerKiosk: 0.15,
      basketValue: 0.1,
    });
  });

  it("output sums to 1 when input sums to 100", () => {
    const out = toScoreWeights({
      revenue: 40,
      transactions: 20,
      revenuePerRoom: 20,
      txnPerKiosk: 10,
      basketValue: 10,
    });
    const total =
      out.revenue + out.transactions + out.revenuePerRoom + out.txnPerKiosk + out.basketValue;
    expect(total).toBeCloseTo(1.0, 10);
  });
});
