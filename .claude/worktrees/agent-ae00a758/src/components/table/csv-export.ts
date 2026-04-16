import Papa from "papaparse";
import type { Table } from "@tanstack/react-table";

export function exportTableToCSV<T>(table: Table<T>, fileName: string) {
  const rows = table.getFilteredRowModel().rows;
  const visibleColumns = table
    .getVisibleFlatColumns()
    .filter((col) => col.id !== "select" && col.id !== "actions");

  const headers = visibleColumns.map((col) =>
    String(col.columnDef.header ?? col.id)
  );

  const data = rows
    .filter((row) => !row.getIsGrouped())
    .map((row) =>
      visibleColumns.map((col) => {
        const val = row.getValue(col.id);
        if (val instanceof Date) return val.toLocaleDateString();
        if (val === null || val === undefined) return "";
        return String(val);
      })
    );

  // Explicit fields array ensures deterministic column order (avoids Papa auto-detection)
  const csv = Papa.unparse({ fields: headers, data });

  // UTF-8 BOM (\uFEFF) for Excel compatibility
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
