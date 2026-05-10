/**
 * Phase 9.1 Plan 11 (NEW CR-02) — EmailTemplate closed-union compile assertion.
 *
 * This test file exists solely to provide a compile-time regression guard for
 * the EmailTemplate type. The two FX alert call-sites
 * (fx-rates-fetch-daily.ts + azure-etl.ts) emit `template: "plain-text"`.
 * Before Plan 11, "plain-text" was absent from the union and the call-sites
 * worked around this via loose `inngest.send` typing. Adding it here creates a
 * typed assertion that `tsc --noEmit` (and `vitest run`) will catch if the
 * union is accidentally narrowed again.
 *
 * Pattern: assignability probe — assign each expected member to a variable typed
 * as `EmailTemplate`. TypeScript's structural type system rejects unknown string
 * literals at the assignment boundary, making the assignment the assertion.
 */

import type { EmailTemplate } from "@/inngest/events";
import { describe, expect, it } from "vitest";

describe("EmailTemplate closed union — compile-time assertions", () => {
  it('contains "password-changed"', () => {
    const t: EmailTemplate = "password-changed";
    expect(t).toBe("password-changed");
  });

  it('contains "poc-underperformance"', () => {
    const t: EmailTemplate = "poc-underperformance";
    expect(t).toBe("poc-underperformance");
  });

  it('contains "plain-text" (NEW CR-02 — required by FX alert call-sites)', () => {
    // If this line produces a TS2322 ("Type '\"plain-text\"' is not assignable
    // to type 'EmailTemplate'"), it means the union has been accidentally
    // narrowed and both FX call-sites are silently bypassing type-checking.
    const t: EmailTemplate = "plain-text";
    expect(t).toBe("plain-text");
  });

  it("exhaustive guard — all known members assignable (update if union grows)", () => {
    // Exhaustive list of valid EmailTemplate values. If a new template is added
    // to events.ts, add it here too — this line acts as a changelog reminder.
    const validTemplates: EmailTemplate[] = [
      "password-changed",
      "poc-underperformance",
      "plain-text",
    ];
    expect(validTemplates).toHaveLength(3);
  });
});
