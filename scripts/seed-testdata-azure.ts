/**
 * Synthetic NetSuite-shape sales CSV seeder for the Azure ETL smoke test.
 *
 * Uploads 4 days of CSVs to azure://wkgsalesdata/<container>/GB/YYYY/MM/DD/sales.csv.
 * Default container is `testdata` — a sibling to `clientdata` that's reserved
 * for smoke runs and never collides with real NetSuite drops.
 *
 * Deterministic across re-runs (LCG-seeded) so a smoke against a throwaway
 * Neon branch yields identical row counts each invocation. Each upload uses
 * `overwrite: true`, so re-running produces byte-identical blobs.
 *
 * Run via:
 *   set -a; source .env.local; set +a
 *   npm run seed:azure-testdata
 *
 * Override the container with AZURE_BLOB_CONTAINER (e.g. for a one-off
 * isolated smoke). The 22-column header MUST match REQUIRED_COLUMNS in
 * src/lib/csv/sales-csv.ts.
 */
import { BlobServiceClient } from "@azure/storage-blob";

// Header order matches the parser's HEADER_MAP keys exactly. The parser is
// case-insensitive and strips spaces/underscores, but we use the canonical
// human-readable form here so the CSVs are readable too.
const CSV_HEADERS = [
  "SaleRef",
  "RefNo",
  "Code",
  "Product Name",
  "Category Code",
  "Category Name",
  "Agent",
  "Outlet Code",
  "Outlet Name",
  "Date",
  "Time",
  "Customer Code",
  "Customer Name",
  "SuppNam",
  "API Product Name",
  "City",
  "Country",
  "Business Division",
  "VAT Rate",
  "Net Amt",
  "VAT Amt",
  "Currency",
] as const;

// 5 real UK outlet codes pulled from dev's `locations` table.
// The ETL resolver looks these up by (primary_region_id=UK, outlet_code).
const UK_OUTLETS: Array<{ code: string; name: string }> = [
  { code: "0E", name: "Ibis Northampton Centre" },
  { code: "0F", name: "Clayton Hotel Birmingham" },
  { code: "0J", name: "Riu Plaza London The Westminster" },
  { code: "0K", name: "New Road Hotel" },
  { code: "0L", name: "Point A Canary Wharf" },
];

// Product catalogue. Booking Fee + Cash Handling Fee map via product_code_fallbacks
// (9991, 9992). The rest are normal NetSuite-coded products.
const PRODUCTS: Array<{
  name: string;
  code: string | null; // null → triggers the fallback path
  category: { code: string; name: string } | null;
  vatRate: number; // 0.20 standard, 0 for fees
  apiName: string | null;
  provider: string | null;
}> = [
  {
    name: "Theatre",
    code: "10001",
    category: { code: "THEAT", name: "Theatre" },
    vatRate: 0.20,
    apiName: "Theatre Tickets",
    provider: "ATG Tickets",
  },
  {
    name: "Transfers",
    code: "10002",
    category: { code: "TRANSF", name: "Transfers" },
    vatRate: 0.20,
    apiName: "Airport Transfer",
    provider: "Suntransfers",
  },
  {
    name: "Tours & Activities",
    code: "10003",
    category: { code: "TOUR", name: "Tours" },
    vatRate: 0.20,
    apiName: "City Tour",
    provider: "GetYourGuide",
  },
  {
    name: "Sightseeing Pass",
    code: "10004",
    category: { code: "PASS", name: "Passes" },
    vatRate: 0.20,
    apiName: "London Pass",
    provider: "The Sightseeing Pass",
  },
  {
    name: "Hop-on Hop-off Bus Tour",
    code: "10005",
    category: { code: "BUS", name: "Bus Tours" },
    vatRate: 0.20,
    apiName: "HoHo Bus 24h",
    provider: "Big Bus Tours",
  },
  {
    name: "Booking Fee",
    code: null, // fallback to 9991
    category: null,
    vatRate: 0,
    apiName: null,
    provider: null,
  },
  {
    name: "Cash Handling Fee",
    code: null, // fallback to 9992
    category: null,
    vatRate: 0,
    apiName: null,
    provider: null,
  },
];

// Linear congruential generator — same params as Numerical Recipes' "ranqd1".
// Deterministic, fast, sufficient for picking rows out of a small array.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function fmtMoney(n: number): string {
  // 2dp, no thousands separator — the parser strips commas anyway but this
  // keeps the CSV unambiguous.
  return n.toFixed(2);
}

type Row = Record<(typeof CSV_HEADERS)[number], string>;

function buildRowsForDate(dateIso: string, rng: () => number): Row[] {
  const rows: Row[] = [];
  // 12-15 rows: 2-3 booking fees + 1 reversal + the rest are normal products.
  const totalRows = 12 + Math.floor(rng() * 4); // 12, 13, 14, 15
  const feeCount = 2 + Math.floor(rng() * 2); // 2 or 3
  const reversalIdx = Math.floor(rng() * (totalRows - feeCount - 1)) + feeCount;

  // Counter for unique sale refs within the day. Combine with date to be
  // globally unique across the seed.
  const dayStamp = dateIso.replace(/-/g, "");
  let serial = 0;

  for (let i = 0; i < totalRows; i++) {
    const isFee = i < feeCount;
    const isReversal = i === reversalIdx;

    const product: typeof PRODUCTS[number] = isFee
      ? PRODUCTS.find((p) => p.name === "Booking Fee")!
      : PRODUCTS.filter((p) => p.code !== null && p.name !== "Booking Fee" && p.name !== "Cash Handling Fee")[
          Math.floor(rng() * 5)
        ];
    const outlet = pick(rng, UK_OUTLETS);

    serial++;
    const saleRef = `TST-${dayStamp}-${String(serial).padStart(4, "0")}`;
    const refNo = `R${dayStamp}${String(serial).padStart(4, "0")}`;

    // Net amount: 5.00–250.00 for products, 1.00–4.50 for fees. Reversal flips sign.
    const baseNet = isFee
      ? 1 + rng() * 3.5
      : 5 + rng() * 245;
    const signedNet = isReversal ? -baseNet : baseNet;
    const vat = signedNet * product.vatRate;

    // Hour 09:00–21:00, deterministic from rng.
    const hour = 9 + Math.floor(rng() * 12);
    const minute = Math.floor(rng() * 60);
    const second = Math.floor(rng() * 60);
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

    const row: Row = {
      "SaleRef": saleRef,
      "RefNo": refNo,
      "Code": product.code ?? "",
      "Product Name": product.name,
      "Category Code": product.category?.code ?? "",
      "Category Name": product.category?.name ?? "",
      "Agent": `Agent${1 + Math.floor(rng() * 5)}`,
      "Outlet Code": outlet.code,
      "Outlet Name": outlet.name,
      "Date": dateIso,
      "Time": time,
      "Customer Code": `C${String(Math.floor(rng() * 99999)).padStart(5, "0")}`,
      "Customer Name": pick(rng, [
        "John Smith",
        "Sarah Patel",
        "Marco Rossi",
        "Aoife O'Brien",
        "Hans Müller",
      ]),
      "SuppNam": product.provider ?? "",
      "API Product Name": product.apiName ?? "",
      "City": pick(rng, ["London", "Manchester", "Birmingham", "Edinburgh"]),
      "Country": "United Kingdom",
      "Business Division": "Retail",
      "VAT Rate": product.vatRate ? product.vatRate.toFixed(2) : "0.00",
      "Net Amt": fmtMoney(signedNet),
      "VAT Amt": fmtMoney(vat),
      "Currency": "GBP",
    };
    rows.push(row);
  }

  return rows;
}

function rowsToCsv(rows: Row[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(r[h])).join(","));
  }
  // Trailing newline keeps POSIX-y tools happy and Papa Parse handles either.
  return lines.join("\r\n") + "\r\n";
}

function dateSeed(dateIso: string): number {
  // Deterministic seed derived from the date — different per day, identical
  // across runs. Hash form: YYYYMMDD * a prime, mod 2^31.
  const n = Number(dateIso.replace(/-/g, ""));
  return (n * 2654435761) >>> 0;
}

async function main() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    throw new Error(
      "AZURE_STORAGE_CONNECTION_STRING is required (load .env.local first)",
    );
  }
  const containerName = process.env.AZURE_BLOB_CONTAINER ?? "testdata";

  const blobService = BlobServiceClient.fromConnectionString(conn);
  const accountName = blobService.accountName;
  console.log(`[seed] Connected to ${accountName}`);
  console.log(`[seed] Container: ${containerName}`);

  const container = blobService.getContainerClient(containerName);
  // Sanity: ensure container exists. We don't auto-create here so a typo
  // in AZURE_BLOB_CONTAINER fails loud rather than silently spawning a
  // stray container.
  const exists = await container.exists();
  if (!exists) {
    throw new Error(
      `Container '${containerName}' does not exist. Create it first.`,
    );
  }

  const dates = ["2026-04-22", "2026-04-23", "2026-04-24", "2026-04-25"];
  let totalRows = 0;
  for (const dateIso of dates) {
    const rng = makeLcg(dateSeed(dateIso));
    const rows = buildRowsForDate(dateIso, rng);
    const csv = rowsToCsv(rows);
    const [yyyy, mm, dd] = dateIso.split("-");
    const blobPath = `GB/${yyyy}/${mm}/${dd}/sales.csv`;
    const block = container.getBlockBlobClient(blobPath);
    const buf = Buffer.from(csv, "utf8");
    await block.uploadData(buf, {
      blobHTTPHeaders: { blobContentType: "text/csv; charset=utf-8" },
    });
    totalRows += rows.length;
    console.log(
      `[seed] Uploaded ${containerName}/${blobPath} — ${rows.length} rows`,
    );
  }
  console.log(`[seed] Done — ${totalRows} rows across ${dates.length} days`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
