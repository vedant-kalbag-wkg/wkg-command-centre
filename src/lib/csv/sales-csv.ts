import { createHash } from "node:crypto";
import Papa from "papaparse";

export type ParsedSalesRow = {
  saleRef: string;
  refNo: string;
  netsuiteCode: string;
  productName: string;
  categoryCode: string | null;
  categoryName: string | null;
  agent: string | null;
  outletCode: string;
  outletName: string | null;
  transactionDate: string;
  transactionTime: string | null;
  customerCode: string | null;
  customerName: string | null;
  providerName: string | null;
  apiProductName: string | null;
  city: string | null;
  country: string | null;
  businessDivision: string | null;
  vatRate: string | null;
  netAmount: string;
  vatAmount: string;
  currency: string;
  isBookingFee: boolean;
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

export type ParseOptions = { feeCodeFallbacks: Map<string, string> };

const HEADER_MAP: Record<string, keyof ParsedSalesRow | "ignore"> = {
  saleref: "saleRef",
  refno: "refNo",
  code: "netsuiteCode",
  productname: "productName",
  categorycode: "categoryCode",
  categoryname: "categoryName",
  agent: "agent",
  outletcode: "outletCode",
  outletname: "outletName",
  date: "transactionDate",
  time: "transactionTime",
  customercode: "customerCode",
  customername: "customerName",
  suppnam: "providerName",
  apiproductname: "apiProductName",
  city: "city",
  country: "country",
  businessdivision: "businessDivision",
  vatrate: "vatRate",
  netamt: "netAmount",
  vatamt: "vatAmount",
  currency: "currency",
};

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function canonicalizeHeader(h: string): keyof ParsedSalesRow | "ignore" | undefined {
  const key = h.trim().toLowerCase().replace(/[_\s]/g, "");
  return HEADER_MAP[key];
}

function isAbsent(s: string | undefined): boolean {
  if (s === undefined) return true;
  const t = s.trim();
  return t === "" || t.toUpperCase() === "NULL";
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "NULL") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
  }
  const ddMonYy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
  if (ddMonYy) {
    const [, d, monRaw, yy] = ddMonYy;
    const mm = MONTH_ABBR[monRaw.toLowerCase()];
    if (!mm) return null;
    return `${2000 + Number(yy)}-${mm}-${d.padStart(2, "0")}`;
  }
  return null;
}

function parseTime(raw: string): string | null {
  if (isAbsent(raw)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [, h, mm, ss] = m;
  const H = h.padStart(2, "0");
  if (+H > 23 || +mm > 59 || (ss !== undefined && +ss > 59)) return null;
  return `${H}:${mm}:${ss ?? "00"}`;
}

function parseSignedDecimal(raw: string): { ok: true; value: string } | { ok: false } | { ok: "empty" } {
  if (isAbsent(raw)) return { ok: "empty" };
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function optText(v: string | undefined): string | null {
  return isAbsent(v) ? null : (v as string).trim();
}

export function parseSalesCsv(text: string, opts: ParseOptions): ParseResult {
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

    // Required strings
    const saleRef = (canonical.saleRef ?? "").trim();
    if (!saleRef) errors.push({ field: "saleRef", message: "saleRef is required" });
    const refNo = (canonical.refNo ?? "").trim();
    if (!refNo) errors.push({ field: "refNo", message: "refNo is required" });
    const outletCode = (canonical.outletCode ?? "").trim();
    if (!outletCode) errors.push({ field: "outletCode", message: "outletCode is required" });
    const productName = (canonical.productName ?? "").trim();
    if (!productName) errors.push({ field: "productName", message: "productName is required" });

    // netsuiteCode with fallback
    let netsuiteCode = (canonical.netsuiteCode ?? "").trim();
    if (isAbsent(netsuiteCode)) {
      const fallback = opts.feeCodeFallbacks.get(productName);
      if (fallback) netsuiteCode = fallback;
      else errors.push({ field: "netsuiteCode", message: `Code is required and no fallback configured for Product Name '${productName}'` });
    }

    const isBookingFee = productName === "Booking Fee";

    const transactionDate = parseDate(canonical.transactionDate ?? "");
    if (!transactionDate) errors.push({ field: "transactionDate", message: "transactionDate (Date column) is missing or unparseable" });

    const rawTime = canonical.transactionTime ?? "";
    const transactionTime = parseTime(rawTime);
    if (!isAbsent(rawTime) && !transactionTime) {
      errors.push({ field: "transactionTime", message: "transactionTime is not a valid HH:MM[:SS]" });
    }

    // Required signed decimals
    const netRes = parseSignedDecimal(canonical.netAmount ?? "");
    let netAmount = "";
    if (netRes.ok === "empty") errors.push({ field: "netAmount", message: "netAmount is required" });
    else if (netRes.ok === false) errors.push({ field: "netAmount", message: "netAmount is not a valid number" });
    else netAmount = netRes.value;

    const vatRes = parseSignedDecimal(canonical.vatAmount ?? "");
    let vatAmount = "";
    if (vatRes.ok === "empty") errors.push({ field: "vatAmount", message: "vatAmount is required" });
    else if (vatRes.ok === false) errors.push({ field: "vatAmount", message: "vatAmount is not a valid number" });
    else vatAmount = vatRes.value;

    // Optional signed decimal
    const vatRateRes = parseSignedDecimal(canonical.vatRate ?? "");
    const vatRate = vatRateRes.ok === true ? vatRateRes.value : null;
    if (vatRateRes.ok === false) errors.push({ field: "vatRate", message: "vatRate is not a valid number" });

    const currency = ((canonical.currency ?? "").trim() || "GBP").toUpperCase();

    const row: ParseResult["rows"][number] = { rowNumber: i + 1, raw, parsed: null, errors };

    if (errors.length === 0 && transactionDate) {
      row.parsed = {
        saleRef,
        refNo,
        netsuiteCode,
        productName,
        categoryCode: optText(canonical.categoryCode),
        categoryName: optText(canonical.categoryName),
        agent: optText(canonical.agent),
        outletCode,
        outletName: optText(canonical.outletName),
        transactionDate,
        transactionTime,
        customerCode: optText(canonical.customerCode),
        customerName: optText(canonical.customerName),
        providerName: optText(canonical.providerName),
        apiProductName: optText(canonical.apiProductName),
        city: optText(canonical.city),
        country: optText(canonical.country),
        businessDivision: optText(canonical.businessDivision),
        vatRate,
        netAmount,
        vatAmount,
        currency,
        isBookingFee,
      };
      validCount++;
      if (minDate === null || transactionDate < minDate) minDate = transactionDate;
      if (maxDate === null || transactionDate > maxDate) maxDate = transactionDate;
    } else {
      invalidCount++;
    }

    rows.push(row);
  }

  return { rows, dateRangeStart: minDate, dateRangeEnd: maxDate, totalRows: rows.length, validCount, invalidCount };
}

export function computeSourceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
