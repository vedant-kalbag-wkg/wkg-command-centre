import { describe, it, expect, beforeEach } from "vitest";
import {
  usePerformerThresholdStore,
  isValidCutoffPair,
  DEFAULT_GREEN_CUTOFF,
  DEFAULT_RED_CUTOFF,
} from "./performer-threshold-store";

describe("performer-threshold-store", () => {
  beforeEach(() => {
    // Reset the store to defaults before each test
    usePerformerThresholdStore.getState().reset();
  });

  describe("defaults", () => {
    it("starts with green=30 and red=30", () => {
      const { greenCutoff, redCutoff } = usePerformerThresholdStore.getState();
      expect(greenCutoff).toBe(30);
      expect(redCutoff).toBe(30);
    });

    it("exports default constants equal to 30", () => {
      expect(DEFAULT_GREEN_CUTOFF).toBe(30);
      expect(DEFAULT_RED_CUTOFF).toBe(30);
    });
  });

  describe("sum validation", () => {
    it("30/30 is valid", () => {
      expect(isValidCutoffPair(30, 30)).toBe(true);
    });

    it("allows exactly 100", () => {
      expect(isValidCutoffPair(50, 50)).toBe(true);
      expect(isValidCutoffPair(100, 0)).toBe(true);
    });

    it("rejects when sum exceeds 100", () => {
      expect(isValidCutoffPair(60, 50)).toBe(false);
      expect(isValidCutoffPair(80, 30)).toBe(false);
    });

    it("rejects negative inputs", () => {
      expect(isValidCutoffPair(-1, 30)).toBe(false);
      expect(isValidCutoffPair(30, -5)).toBe(false);
    });
  });

  describe("set(key, value) clamps 0-100", () => {
    it("clamps values above 100 to 100", () => {
      const { set } = usePerformerThresholdStore.getState();
      set("greenCutoff", 150);
      expect(usePerformerThresholdStore.getState().greenCutoff).toBe(100);
    });

    it("clamps negative values to 0", () => {
      const { set } = usePerformerThresholdStore.getState();
      set("redCutoff", -20);
      expect(usePerformerThresholdStore.getState().redCutoff).toBe(0);
    });

    it("rounds non-integer input", () => {
      const { set } = usePerformerThresholdStore.getState();
      set("greenCutoff", 42.7);
      expect(usePerformerThresholdStore.getState().greenCutoff).toBe(43);
    });

    it("accepts an in-range value", () => {
      const { set } = usePerformerThresholdStore.getState();
      set("greenCutoff", 20);
      set("redCutoff", 25);
      const state = usePerformerThresholdStore.getState();
      expect(state.greenCutoff).toBe(20);
      expect(state.redCutoff).toBe(25);
    });

    it("handles NaN by clamping to 0", () => {
      const { set } = usePerformerThresholdStore.getState();
      set("greenCutoff", Number.NaN);
      expect(usePerformerThresholdStore.getState().greenCutoff).toBe(0);
    });
  });

  describe("reset", () => {
    it("returns to defaults", () => {
      const { set, reset } = usePerformerThresholdStore.getState();
      set("greenCutoff", 55);
      set("redCutoff", 22);
      reset();
      const state = usePerformerThresholdStore.getState();
      expect(state.greenCutoff).toBe(30);
      expect(state.redCutoff).toBe(30);
    });
  });
});
