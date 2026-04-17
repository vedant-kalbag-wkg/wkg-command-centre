import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatNumber,
  formatCompactNumber,
  formatPercentChange,
  formatChangeIndicator,
  toLocalISODate,
  formatDate,
  autoGranularity,
  dateToBucket,
  formatNullValue,
} from "./formatters";

describe("formatCurrency", () => {
  it("formats GBP with 2 decimal places", () => {
    expect(formatCurrency(12345.67)).toBe("£12,345.67");
  });
  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("£0.00");
  });
  it("handles negative", () => {
    expect(formatCurrency(-500)).toBe("-£500.00");
  });
});

describe("formatNumber", () => {
  it("formats integers without decimals", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });
  it("formats with specified decimals", () => {
    expect(formatNumber(12345.678, 2)).toBe("12,345.68");
  });
});

describe("formatCompactNumber", () => {
  it("formats thousands as k", () => {
    expect(formatCompactNumber(1200)).toBe("1.2k");
  });
  it("formats millions as M", () => {
    expect(formatCompactNumber(45300000)).toBe("45.3M");
  });
  it("formats billions as B", () => {
    expect(formatCompactNumber(1200000000)).toBe("1.2B");
  });
  it("returns raw number below 1000", () => {
    expect(formatCompactNumber(999)).toBe("999");
  });
});

describe("formatPercentChange", () => {
  it("positive change has + prefix", () => {
    expect(formatPercentChange(12000, 10000)).toBe("+20.0%");
  });
  it("negative change has - prefix", () => {
    expect(formatPercentChange(9500, 10000)).toBe("-5.0%");
  });
  it("zero to zero is +0.0%", () => {
    expect(formatPercentChange(0, 0)).toBe("+0.0%");
  });
  it("from zero is +100.0%", () => {
    expect(formatPercentChange(100, 0)).toBe("+100.0%");
  });
});

describe("formatChangeIndicator", () => {
  it("null returns neutral dash", () => {
    const result = formatChangeIndicator(null);
    expect(result.direction).toBe("neutral");
  });
  it("positive >= 0.1 returns up", () => {
    const result = formatChangeIndicator(5.3);
    expect(result.direction).toBe("up");
    expect(result.color).toBe("#166534");
  });
  it("negative <= -0.1 returns down", () => {
    const result = formatChangeIndicator(-3.2);
    expect(result.direction).toBe("down");
    expect(result.color).toBe("#991B1B");
  });
  it("tiny change returns neutral", () => {
    const result = formatChangeIndicator(0.05);
    expect(result.direction).toBe("neutral");
  });
});

describe("toLocalISODate", () => {
  it("formats date as YYYY-MM-DD local", () => {
    const d = new Date(2025, 5, 15); // June 15
    expect(toLocalISODate(d)).toBe("2025-06-15");
  });
});

describe("autoGranularity", () => {
  it("<=31 days -> daily", () => {
    const from = new Date("2025-06-01");
    const to = new Date("2025-06-30");
    expect(autoGranularity(from, to)).toBe("daily");
  });
  it("<=90 days -> weekly", () => {
    const from = new Date("2025-04-01");
    const to = new Date("2025-06-15");
    expect(autoGranularity(from, to)).toBe("weekly");
  });
  it(">90 days -> monthly", () => {
    const from = new Date("2025-01-01");
    const to = new Date("2025-12-31");
    expect(autoGranularity(from, to)).toBe("monthly");
  });
});

describe("formatNullValue", () => {
  it("null returns em dash", () => {
    expect(formatNullValue(null)).toBe("\u2014");
  });
  it("value passes through formatter", () => {
    expect(formatNullValue(100, (v) => `${v}%`)).toBe("100%");
  });
});
