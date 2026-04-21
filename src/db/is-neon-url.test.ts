import { describe, it, expect } from "vitest";
import { isNeonUrl } from "./is-neon-url";

describe("isNeonUrl", () => {
  it("returns true for neon.tech hostnames", () => {
    expect(isNeonUrl("postgres://user:pass@ep-foo.us-east-1.aws.neon.tech/db?sslmode=require")).toBe(true);
  });

  it("returns true for neon pooler hostnames", () => {
    expect(isNeonUrl("postgres://user:pass@ep-foo-pooler.us-east-1.aws.neon.tech:6543/db")).toBe(true);
  });

  it("returns false for localhost", () => {
    expect(isNeonUrl("postgres://postgres:postgres@localhost:5432/wkg_kiosk_dev")).toBe(false);
  });

  it("returns false for a bare IP", () => {
    expect(isNeonUrl("postgres://user:pass@10.0.0.5:5432/db")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isNeonUrl("")).toBe(false);
  });

  it("returns false for a malformed URL", () => {
    expect(isNeonUrl("not-a-url")).toBe(false);
  });
});
