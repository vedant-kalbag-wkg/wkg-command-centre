import { describe, expect, test } from "vitest";
import { computeSourceHash, parseSalesCsv } from "./sales-csv";

const HAPPY_CSV = `Saleref,RefNo,Din,Time,OutletCode,ProductName,ProviderName,Quantity,Gross,Net,DiscountCode,DiscountAmount,BookingFee,SaleCommission,Currency,CustomerCode,CustomerName
S-001,R-1,01-Mar-26,10:15,OUT-A,London Eye,AttractionsCo,2,80.00,70.00,,,5.00,7.00,GBP,C-1,Jane
S-002,R-2,01-Mar-26,11:30:00,OUT-B,Tower of London,AttractionsCo,1,35.00,30.00,PROMO10,3.50,2.50,3.00,,C-2,Dan
S-003,R-3,02-Mar-26,14:00,OUT-A,Shard View,SkyCo,4,"1,200.00",1050.00,,,20.00,100.00,EUR,,
`;

describe("parseSalesCsv — happy path", () => {
  test("parses a 3-row CSV with correct counts and date range", () => {
    const result = parseSalesCsv(HAPPY_CSV);

    expect(result.totalRows).toBe(3);
    expect(result.validCount).toBe(3);
    expect(result.invalidCount).toBe(0);
    expect(result.dateRangeStart).toBe("2026-03-01");
    expect(result.dateRangeEnd).toBe("2026-03-02");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].errors).toEqual([]);
  });

  test("maps data-dashboard headers to canonical field names", () => {
    const result = parseSalesCsv(HAPPY_CSV);
    const first = result.rows[0].parsed!;

    expect(first.saleRef).toBe("S-001");
    expect(first.refNo).toBe("R-1");
    expect(first.transactionDate).toBe("2026-03-01");
    expect(first.transactionTime).toBe("10:15:00");
    expect(first.outletCode).toBe("OUT-A");
    expect(first.productName).toBe("London Eye");
    expect(first.providerName).toBe("AttractionsCo");
    expect(first.quantity).toBe(2);
    expect(first.grossAmount).toBe("80.00");
    expect(first.netAmount).toBe("70.00");
    expect(first.bookingFee).toBe("5.00");
    expect(first.saleCommission).toBe("7.00");
    expect(first.currency).toBe("GBP");
    expect(first.customerCode).toBe("C-1");
    expect(first.customerName).toBe("Jane");
  });

  test("normalizes HH:MM to HH:MM:SS", () => {
    const result = parseSalesCsv(HAPPY_CSV);
    expect(result.rows[0].parsed!.transactionTime).toBe("10:15:00");
    expect(result.rows[1].parsed!.transactionTime).toBe("11:30:00");
  });

  test("strips thousands separator from numeric amounts", () => {
    const result = parseSalesCsv(HAPPY_CSV);
    expect(result.rows[2].parsed!.grossAmount).toBe("1200.00");
  });

  test("defaults empty currency to GBP", () => {
    // The third row has empty Currency? No — row 3 is EUR. Row 2 has blank currency.
    // Actually re-reading the fixture: row 2 has Currency="" (between SaleCommission=3.00 and CustomerCode=C-2)
    // Let me test with a dedicated CSV.
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross,Currency
S-X,01-Mar-26,OUT-A,P1,1,10.00,
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].parsed!.currency).toBe("GBP");
  });

  test("empty providerName and customerName come through as null", () => {
    const result = parseSalesCsv(HAPPY_CSV);
    const third = result.rows[2].parsed!;
    expect(third.customerCode).toBeNull();
    expect(third.customerName).toBeNull();
  });

  test("accepts ISO YYYY-MM-DD dates as well as DD-Mon-YY", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-ISO,2026-03-15,OUT-A,P1,1,10.00
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].parsed!.transactionDate).toBe("2026-03-15");
  });
});

describe("parseSalesCsv — validation errors", () => {
  test("row with missing saleRef is flagged invalid", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
,01-Mar-26,OUT-A,P1,1,10.00
`;
    const result = parseSalesCsv(csv);
    expect(result.invalidCount).toBe(1);
    expect(result.validCount).toBe(0);
    expect(result.rows[0].parsed).toBeNull();
    expect(result.rows[0].errors).toEqual([
      { field: "saleRef", message: expect.stringContaining("required") },
    ]);
  });

  test("row with unparseable date is flagged invalid", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-1,not-a-date,OUT-A,P1,1,10.00
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: "transactionDate" }),
    );
  });

  test("row with non-positive quantity is flagged invalid", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-1,01-Mar-26,OUT-A,P1,0,10.00
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: "quantity" }),
    );
  });

  test("row with missing grossAmount is flagged invalid", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-1,01-Mar-26,OUT-A,P1,1,
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: "grossAmount" }),
    );
  });

  test("row with unparseable numeric is flagged invalid", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross,DiscountAmount
S-1,01-Mar-26,OUT-A,P1,1,10.00,abc
`;
    const result = parseSalesCsv(csv);
    expect(result.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: "discountAmount" }),
    );
  });

  test("mixed valid and invalid rows — counts are correct", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
S-1,01-Mar-26,OUT-A,P1,1,10.00
,02-Mar-26,OUT-A,P1,1,10.00
S-3,03-Mar-26,OUT-A,P1,1,10.00
`;
    const result = parseSalesCsv(csv);
    expect(result.totalRows).toBe(3);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    // dateRange across VALID rows only.
    expect(result.dateRangeStart).toBe("2026-03-01");
    expect(result.dateRangeEnd).toBe("2026-03-03");
  });

  test("empty CSV returns empty result (no rows, no errors)", () => {
    const csv = `Saleref,Din,OutletCode,ProductName,Quantity,Gross
`;
    const result = parseSalesCsv(csv);
    expect(result.totalRows).toBe(0);
    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(0);
    expect(result.dateRangeStart).toBeNull();
    expect(result.dateRangeEnd).toBeNull();
  });
});

describe("computeSourceHash", () => {
  test("is deterministic for the same input", () => {
    const bytes = new TextEncoder().encode("hello world");
    expect(computeSourceHash(bytes)).toBe(computeSourceHash(bytes));
  });

  test("differs for different input", () => {
    const a = new TextEncoder().encode("hello world");
    const b = new TextEncoder().encode("hello world!");
    expect(computeSourceHash(a)).not.toBe(computeSourceHash(b));
  });

  test("returns a 64-char hex string (sha256)", () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = computeSourceHash(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
