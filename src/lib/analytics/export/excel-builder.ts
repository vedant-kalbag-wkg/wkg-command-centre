import ExcelJS from "exceljs";

export type ExportSection = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
};

/**
 * Build a branded Excel workbook with Azure header rows and
 * alternating row fills.
 */
export async function buildExcelWorkbook(
  sections: ExportSection[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WKG Kiosk Tool";
  workbook.created = new Date();

  for (const section of sections) {
    const sheet = workbook.addWorksheet(section.name);

    // Azure header row
    const headerRow = sheet.addRow(section.headers);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF00A6D3" },
      };
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
        name: "Calibri",
      };
      cell.alignment = { vertical: "middle" };
    });

    // Data rows with alternating fills
    section.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow(
        row.map((cell) => (cell === null ? "" : cell)),
      );
      if (idx % 2 === 1) {
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F5F5" },
          };
        });
      }
    });

    // Auto-fit columns (approximate: use max of header length and 15)
    sheet.columns.forEach((col, colIdx) => {
      const headerLen = section.headers[colIdx]?.length ?? 10;
      col.width = Math.max(headerLen + 2, 15);
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer);
}
