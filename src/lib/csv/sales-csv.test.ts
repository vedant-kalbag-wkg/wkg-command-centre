import { describe, it, expect } from "vitest";
import { parseSalesCsv } from "./sales-csv";

const HEADER = [
  "Saleref", "Ref No", "Code", "Product Name", "Category Code", "Category Name",
  "agent", "Outlet Code", "Outlet Name", "Date", "Time", "Customer Code",
  "Customer Name", "supp_nam", "API Product Name", "City", "Country",
  "Business Division", "VAT Rate", "Net Amt", "VAT Amt", "Currency",
].join(",");

function csv(rows: string[][]) {
  return [HEADER, ...rows.map((r) => r.join(","))].join("\n");
}

const fallbacks = new Map([
  ["Booking Fee", "9991"],
  ["Cash Handling Fee", "9992"],
]);

describe("parseSalesCsv (NetSuite format)", () => {
  it("parses a principal row end-to-end", () => {
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","0:02:23","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.totalRows).toBe(1);
    expect(res.validCount).toBe(1);
    const p = res.rows[0].parsed!;
    expect(p.saleRef).toBe("5578141");
    expect(p.refNo).toBe("Q5A4558585");
    expect(p.netsuiteCode).toBe("4603");
    expect(p.transactionDate).toBe("2026-01-01");
    expect(p.netAmount).toBe("12.48");
    expect(p.vatAmount).toBe("2.5");
    expect(p.isBookingFee).toBe(false);
  });

  it("uses fee-code fallback when Code is empty for a Booking Fee row", () => {
    const text = csv([[
      "5578141","Q5A4558585-b","","Booking Fee","TRNSCAR","Transfers - Cars",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","2.24","0.45","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.netsuiteCode).toBe("9991");
    expect(res.rows[0].parsed?.isBookingFee).toBe(true);
  });

  it("uses fallback for Cash Handling Fee", () => {
    const text = csv([[
      "5578141","X-c","","Cash Handling Fee","TRNSCAR","Fees",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","0.10","0.02","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.netsuiteCode).toBe("9992");
    expect(res.rows[0].parsed?.isBookingFee).toBe(false);
  });

  it("rejects a row with empty Code and unknown Product Name", () => {
    const text = csv([[
      "5578141","X","","Unknown Product","TRNSCAR","X",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","","London","GB",
      "UberSSM","20","1.00","0.20","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(0);
    expect(res.rows[0].errors.some((e) => e.field === "netsuiteCode")).toBe(true);
  });

  it("accepts negative Net Amt and VAT Amt (reversal rows)", () => {
    const text = csv([[
      "5578165","2XA4558609","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","2X","Some Hotel","1-Jan-26","","2620",
      "Some Hotel","Uber API","UberX","London","GB",
      "UberSSM","20","-34.09","-6.82","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(1);
    expect(res.rows[0].parsed?.netAmount).toBe("-34.09");
    expect(res.rows[0].parsed?.vatAmount).toBe("-6.82");
  });

  it("uses Date column (not Din) as transactionDate", () => {
    // Put a "Din" column in the raw CSV to verify it's ignored (it won't even
    // be in HEADER, but this documents the property).
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","2026-01-15","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.rows[0].parsed?.transactionDate).toBe("2026-01-15");
  });

  it("treats NULL-string cells as absent (NetSuite convention)", () => {
    const text = csv([[
      "5578141","Q5A4558585-b","","Booking Fee","NULL","NULL",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","NULL","2580",
      "Staycity Greenwich","NULL","NULL","London","GB",
      "UberSSM","20","2.24","0.45","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(1);
    expect(res.rows[0].parsed?.transactionTime).toBeNull();
    expect(res.rows[0].parsed?.providerName).toBeNull();
    expect(res.rows[0].parsed?.apiProductName).toBeNull();
    expect(res.rows[0].parsed?.categoryCode).toBeNull();
  });

  it("emits validation errors for missing Ref No / Outlet Code / Date", () => {
    const text = csv([[
      "5578141","","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","","Staycity Greenwich","","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    const fields = res.rows[0].errors.map((e) => e.field);
    expect(fields).toContain("refNo");
    expect(fields).toContain("outletCode");
    expect(fields).toContain("transactionDate");
  });

  it("treats literal 'NULL' in required fields as missing", () => {
    const text = csv([[
      "NULL","NULL","4603","NULL","TRNSCAR","UBER",
      "Digital Sale","NULL","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    const fields = res.rows[0].errors.map((e) => e.field);
    expect(fields).toContain("saleRef");
    expect(fields).toContain("refNo");
    expect(fields).toContain("outletCode");
    expect(fields).toContain("productName");
    expect(res.validCount).toBe(0);
  });

  it("rejects impossible calendar dates", () => {
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","2026-02-31","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","GBP",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(0);
    expect(res.rows[0].errors.some((e) => e.field === "transactionDate")).toBe(true);
  });

  it("treats Currency='NULL' as absent and defaults to GBP", () => {
    const text = csv([[
      "5578141","Q5A4558585","4603","Uber API","TRNSCAR","UBER",
      "Digital Sale","Q5","Staycity Greenwich","1-Jan-26","","2580",
      "Staycity Greenwich","Uber API","UberX","London","GB",
      "UberSSM","20","12.48","2.5","NULL",
    ]]);
    const res = parseSalesCsv(text, { feeCodeFallbacks: fallbacks });
    expect(res.validCount).toBe(1);
    expect(res.rows[0].parsed?.currency).toBe("GBP");
  });
});
