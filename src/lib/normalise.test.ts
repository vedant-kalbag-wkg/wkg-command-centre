import { describe, expect, it } from "vitest";

import { normaliseName } from "./normalise";

describe("normaliseName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normaliseName("The Grand Hotel & Spa")).toBe("the grand hotel spa");
  });

  it("collapses interior whitespace runs to a single space", () => {
    expect(normaliseName("Hilton    London   Bridge")).toBe("hilton london bridge");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normaliseName("  Marriott  ")).toBe("marriott");
  });

  it("preserves Unicode letters and digits", () => {
    expect(normaliseName("Café 123 — München!")).toBe("café 123 münchen");
  });
});
