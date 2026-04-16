import { createHash } from "node:crypto";
import Papa from "papaparse";

export type ParsedSalesRow = {
  saleRef: string;
  refNo: string | null;
  transactionDate: string;
  transactionTime: string | null;
  outletCode: string;
  productName: string;
  providerName: string | null;
  quantity: number;
  grossAmount: string;
  netAmount: string | null;
  discountCode: string | null;
  discountAmount: string | null;
  bookingFee: string | null;
  saleCommission: string | null;
  currency: string;
  customerCode: string | null;
  customerName: string | null;
};

export type RowValidationError = { field: string; message: string };

export type ParseResult = {
  rows: Array<{
    rowNumber: number;
    raw: Record<string, string>;
    parsed: ParsedSalesRow | null;
    errors: RowValidationError[];
  }>;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  totalRows: number;
  validCount: number;
  invalidCount: number;
};

const HEADER_MAP: Record<string, keyof ParsedSalesRow | "ignore"> = {
  saleref: "saleRef",
  refno: "refNo",
  din: "transactionDate",
  time: "transactionTime",
  outletcode: "outletCode",
  productname: "productName",
  providername: "providerName",
  quantity: "quantity",
  gross: "grossAmount",
  net: "netAmount",
  discountcode: "discountCode",
  discountamount: "discountAmount",
  bookingfee: "bookingFee",
  salecommission: "saleCommission",
  currency: "currency",
  customercode: "customerCode",
  customername: "customerName",
};

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ISO YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
  }
  // DD-Mon-YY (data-dashboard convention)
  const ddMonYy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
  if (ddMonYy) {
    const [, d, monRaw, yy] = ddMonYy;
    const mm = MONTH_ABBR[monRaw.toLowerCase()];
    if (!mm) return null;
    const year = 2000 + Number(yy);
    const dd = d.padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  return null;
}

function parseTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!m) return null;
  const [, h, mm, ss] = m;
  const H = h.padStart(2, "0");
  if (+H > 23 || +mm > 59 || (ss !== undefined && +ss > 59)) return null;
  return `${H}:${mm}:${ss ?? "00"}`;
}

function parseNumeric(raw: string): { ok: true; value: string } | { ok: false } | { ok: "empty" } {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return { ok: "empty" };
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function canonicalizeHeader(h: string): keyof ParsedSalesRow | "ignore" | undefined {
  const key = h.trim().toLowerCase().replace(/[_\s]/g, "");
  return HEADER_MAP[key];
}

export function parseSalesCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const rows: ParseResult["rows"] = [];
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    const errors: RowValidationError[] = [];
    const canonical: Partial<Record<keyof ParsedSalesRow, string>> = {};

    for (const [k, v] of Object.entries(raw)) {
      const field = canonicalizeHeader(k);
      if (field && field !== "ignore") {
        canonical[field] = (v ?? "").toString();
      }
    }

    const saleRef = (canonical.saleRef ?? "").trim();
    if (!saleRef) errors.push({ field: "saleRef", message: "saleRef is required" });

    const transactionDate = parseDate(canonical.transactionDate ?? "");
    if (!transactionDate) errors.push({ field: "transactionDate", message: "transactionDate is missing or unparseable" });

    const qtyRaw = (canonical.quantity ?? "").trim();
    let quantity = 0;
    if (!qtyRaw) {
      errors.push({ field: "quantity", message: "quantity is required" });
    } else if (!/^\d+$/.test(qtyRaw) || Number(qtyRaw) <= 0) {
      errors.push({ field: "quantity", message: "quantity must be a positive integer" });
    } else {
      quantity = Number(qtyRaw);
    }

    const grossRes = parseNumeric(canonical.grossAmount ?? "");
    let grossAmount = "";
    if (grossRes.ok === "empty") {
      errors.push({ field: "grossAmount", message: "grossAmount is required" });
    } else if (grossRes.ok === false) {
      errors.push({ field: "grossAmount", message: "grossAmount is not a valid number" });
    } else {
      grossAmount = grossRes.value;
    }

    const optionalNumeric = (field: keyof ParsedSalesRow, raw: string | undefined): string | null => {
      const res = parseNumeric(raw ?? "");
      if (res.ok === "empty") return null;
      if (res.ok === false) {
        errors.push({ field, message: `${field} is not a valid number` });
        return null;
      }
      return res.value;
    };

    const netAmount = optionalNumeric("netAmount", canonical.netAmount);
    const discountAmount = optionalNumeric("discountAmount", canonical.discountAmount);
    const bookingFee = optionalNumeric("bookingFee", canonical.bookingFee);
    const saleCommission = optionalNumeric("saleCommission", canonical.saleCommission);

    const transactionTime = parseTime(canonical.transactionTime ?? "");
    // transactionTime is optional — only flag if non-empty but unparseable
    if (canonical.transactionTime && canonical.transactionTime.trim() && !transactionTime) {
      errors.push({ field: "transactionTime", message: "transactionTime is not a valid HH:MM[:SS]" });
    }

    const outletCode = (canonical.outletCode ?? "").trim();
    if (!outletCode) errors.push({ field: "outletCode", message: "outletCode is required" });
    const productName = (canonical.productName ?? "").trim();
    if (!productName) errors.push({ field: "productName", message: "productName is required" });

    const providerName = (canonical.providerName ?? "").trim() || null;
    const refNo = (canonical.refNo ?? "").trim() || null;
    const discountCode = (canonical.discountCode ?? "").trim() || null;
    const customerCode = (canonical.customerCode ?? "").trim() || null;
    const customerName = (canonical.customerName ?? "").trim() || null;
    const currency = ((canonical.currency ?? "").trim() || "GBP").toUpperCase();

    const row: ParseResult["rows"][number] = {
      rowNumber: i + 1,
      raw,
      parsed: null,
      errors,
    };

    if (errors.length === 0 && transactionDate) {
      row.parsed = {
        saleRef,
        refNo,
        transactionDate,
        transactionTime,
        outletCode,
        productName,
        providerName,
        quantity,
        grossAmount,
        netAmount,
        discountCode,
        discountAmount,
        bookingFee,
        saleCommission,
        currency,
        customerCode,
        customerName,
      };
      validCount++;
      if (minDate === null || transactionDate < minDate) minDate = transactionDate;
      if (maxDate === null || transactionDate > maxDate) maxDate = transactionDate;
    } else {
      invalidCount++;
    }

    rows.push(row);
  }

  return {
    rows,
    dateRangeStart: minDate,
    dateRangeEnd: maxDate,
    totalRows: rows.length,
    validCount,
    invalidCount,
  };
}

export function computeSourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
