import { describe, it, expect } from "vitest";
import { computeKioskConfigGroupsToInsert } from "../../scripts/v2-wipe-and-reseed";

/**
 * Pure-function tests for the auto-seed diff used by the v2 wipe-and-reseed
 * runbook's PRE-PHASE 1 SSM-Group resolution step. The DB I/O around the
 * helper (the INSERT … ON CONFLICT loop, the Monday board iteration) is
 * exercised manually by the operator during a runbook execution; this test
 * just covers the set-difference logic so a regression in "which names get
 * auto-created" is caught at unit-test time.
 */

describe("computeKioskConfigGroupsToInsert", () => {
  it("returns names present on Monday but absent from kiosk_config_groups", () => {
    const result = computeKioskConfigGroupsToInsert(
      ["Existing A", "Existing B"],
      ["Existing A", "New One", "New Two"],
    );
    expect(result).toEqual(["New Two", "New One"].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty list when Monday board is a subset of existing rows (prod steady state)", () => {
    const result = computeKioskConfigGroupsToInsert(
      ["A", "B", "C"],
      ["A", "B"],
    );
    expect(result).toEqual([]);
  });

  it("returns every Monday item name when kiosk_config_groups is empty (fresh DB)", () => {
    const result = computeKioskConfigGroupsToInsert(
      [],
      ["Group Zulu", "Group Alpha", "Group Mike"],
    );
    expect(result).toEqual(["Group Alpha", "Group Mike", "Group Zulu"]);
  });

  it("de-duplicates Monday item names so the same name isn't inserted twice", () => {
    const result = computeKioskConfigGroupsToInsert(
      [],
      ["Dup Name", "Dup Name", "Other"],
    );
    expect(result).toEqual(["Dup Name", "Other"]);
  });

  it("trims whitespace and skips empty / whitespace-only names", () => {
    const result = computeKioskConfigGroupsToInsert(
      ["Existing"],
      ["  New A  ", "", "   ", "Existing", "  Existing  "],
    );
    expect(result).toEqual(["New A"]);
  });

  it("treats existing-name match as case-sensitive (Monday's source-of-truth casing wins on insert)", () => {
    // kiosk_config_groups stores names verbatim; if Monday has a different
    // casing the runbook should auto-create a second row rather than silently
    // collapse. ON CONFLICT (name) at the DB layer would then reject the
    // duplicate-with-different-casing only if a CITEXT/UPPER index existed —
    // and it does not. So this is the conservative behaviour: surface the
    // drift to the operator (who sees the auto-create log line) rather than
    // hide it.
    const result = computeKioskConfigGroupsToInsert(
      ["lower case name"],
      ["Lower Case Name"],
    );
    expect(result).toEqual(["Lower Case Name"]);
  });

  it("returns names in a deterministic alphabetical order so the log line is stable", () => {
    const result = computeKioskConfigGroupsToInsert(
      [],
      ["Charlie", "Alpha", "Bravo"],
    );
    expect(result).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
});
