import { describe, expect, test } from "vitest";
import { CsvFileSource } from "./csv-file-source";
import { computeSourceHash } from "@/lib/csv/sales-csv";

describe("CsvFileSource", () => {
  test("pull() exposes bytes + label + hash that match the wrapped file", async () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-1,01-Mar-26,OUT-A,Prod1,1,10.00
`;
    const bytes = new TextEncoder().encode(csv);
    const source = new CsvFileSource({
      name: "q1.csv",
      arrayBuffer: async () => bytes.buffer,
    });

    const pulled = await source.pull();

    expect(pulled.sourceLabel).toBe("csv:q1.csv");
    expect(pulled.filename).toBe("q1.csv");
    expect(pulled.sourceHash).toBe(computeSourceHash(bytes));
    expect(new TextDecoder().decode(pulled.bytes)).toBe(csv);
  });

  test("sourceHash is deterministic across repeated pull() calls", async () => {
    const csv = "Saleref,Din,OutletCode,ProductName,Quantity,Gross\nS-1,01-Mar-26,OUT-A,P,1,10\n";
    const bytes = new TextEncoder().encode(csv);
    const source = new CsvFileSource({
      name: "a.csv",
      arrayBuffer: async () => bytes.buffer,
    });

    const a = await source.pull();
    const b = await source.pull();
    expect(a.sourceHash).toBe(b.sourceHash);
  });
});
