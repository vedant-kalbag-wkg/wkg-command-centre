import { describe, it, expect } from "vitest";
import { formatRevenueForKiosk } from "./format-currency";

describe("formatRevenueForKiosk", () => {
  it("formats GBP with £ symbol", () => {
    expect(formatRevenueForKiosk(1420.5, "GBP")).toBe("£1,420.50");
  });

  it("formats EUR with € symbol", () => {
    // Intl in en-GB renders EUR as €1,234.56 (en-GB convention)
    expect(formatRevenueForKiosk(1234.56, "EUR")).toBe("€1,234.56");
  });

  it("formats USD with $ symbol (US$ in en-GB locale)", () => {
    // en-GB spells USD as US$ to disambiguate from GBP
    expect(formatRevenueForKiosk(99, "USD")).toBe("US$99.00");
  });

  it("falls back to '<CODE> <amount>' on invalid currency code", () => {
    // RangeError-throwing input should not abort the caller
    expect(formatRevenueForKiosk(42, "BOGUS")).toBe("BOGUS 42.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatRevenueForKiosk(10.005, "GBP")).toBe("£10.01");
  });
});
