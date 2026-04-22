import { describe, it, expect } from "vitest";
import { executeRowsFromResult } from "./execute-rows";

describe("executeRowsFromResult", () => {
  it("returns the array unchanged when result is already an array (postgres-js shape)", () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(executeRowsFromResult(arr)).toBe(arr);
  });

  it("returns .rows when result is a QueryResult-shaped object (neon-serverless shape)", () => {
    const qr = { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
    expect(executeRowsFromResult(qr)).toBe(qr.rows);
  });

  it("returns empty array for empty postgres-js result", () => {
    expect(executeRowsFromResult([])).toEqual([]);
  });

  it("returns empty array for empty neon-serverless result", () => {
    expect(executeRowsFromResult({ rows: [], rowCount: 0 })).toEqual([]);
  });
});
