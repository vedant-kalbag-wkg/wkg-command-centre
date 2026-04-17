/**
 * RFC 4180 compliant CSV builder.
 */

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export function buildCsvString(
  headers: string[],
  rows: (string | number | null)[][],
): string {
  const headerLine = headers.map((h) => escapeCsvField(String(h))).join(",");
  const dataLines = rows.map((row) =>
    row.map((cell) => escapeCsvField(String(cell ?? ""))).join(","),
  );
  return [headerLine, ...dataLines].join("\r\n") + "\r\n";
}
