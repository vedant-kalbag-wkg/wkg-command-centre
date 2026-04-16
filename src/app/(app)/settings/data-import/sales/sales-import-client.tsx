"use client";

import { useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cancelImport, commitImport, stageImport } from "./actions";
import type { StageSummary } from "./pipeline";

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "preview"; summary: StageSummary }
  | { kind: "committing"; summary: StageSummary };

export function SalesImportClient() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so selecting the same file again re-fires onChange.
    e.target.value = "";

    setState({ kind: "uploading" });
    try {
      const fd = new FormData();
      fd.set("file", file);
      const summary = await stageImport(fd);
      setState({ kind: "preview", summary });
      toast.success(
        `Parsed ${summary.totalRows} rows: ${summary.validCount} valid, ${summary.invalidCount} invalid`,
      );
    } catch (err) {
      setState({ kind: "idle" });
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function onCommit() {
    if (state.kind !== "preview") return;
    const summary = state.summary;
    setState({ kind: "committing", summary });
    try {
      const { committedRows } = await commitImport(summary.importId);
      toast.success(`Committed ${committedRows} sales rows`);
      setState({ kind: "idle" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Commit failed");
      setState({ kind: "preview", summary });
    }
  }

  async function onCancel() {
    if (state.kind !== "preview") return;
    const summary = state.summary;
    try {
      await cancelImport(summary.importId);
      toast.success("Import cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    }
    setState({ kind: "idle" });
  }

  const uploading = state.kind === "uploading";
  const committing = state.kind === "committing";
  const preview = state.kind === "preview" ? state.summary : null;
  const committingSummary = state.kind === "committing" ? state.summary : null;
  const summary = preview ?? committingSummary;
  const canCommit = summary !== null && summary.invalidCount === 0 && !committing;

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Upload sales CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col gap-2 max-w-md">
            <span className="text-sm text-wk-night-grey">
              CSV file with columns: Saleref, Din, OutletCode, ProductName, Quantity, Gross (+optional fields).
            </span>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={onFileChange}
                disabled={uploading || committing || preview !== null}
                aria-label="CSV file"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-wk-mid-grey/40 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-wk-sky-blue/40"
              />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" />}
            </div>
          </label>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <UploadCloud className="h-4 w-4" />
              Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
              <Stat label="Total rows" value={String(summary.totalRows)} />
              <Stat label="Valid" value={String(summary.validCount)} tone="ok" />
              <Stat
                label="Invalid"
                value={String(summary.invalidCount)}
                tone={summary.invalidCount > 0 ? "err" : "ok"}
              />
              <Stat
                label="Date range"
                value={
                  summary.dateRangeStart && summary.dateRangeEnd
                    ? `${summary.dateRangeStart} → ${summary.dateRangeEnd}`
                    : "—"
                }
              />
            </div>

            <div className="border border-wk-mid-grey/40 rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead>Sale ref</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.sampleRows.map((row) => {
                    const invalid = row.parsed === null || row.errors.length > 0;
                    return (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>
                          {invalid ? (
                            <Badge variant="destructive">invalid</Badge>
                          ) : (
                            <Badge>valid</Badge>
                          )}
                        </TableCell>
                        <TableCell>{row.parsed?.saleRef ?? row.errors[0]?.message ?? "—"}</TableCell>
                        <TableCell>{row.parsed?.transactionDate ?? "—"}</TableCell>
                        <TableCell>{row.parsed?.outletCode ?? "—"}</TableCell>
                        <TableCell>{row.parsed?.productName ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {row.errors.length > 0
                            ? row.errors.map((e) => `${e.field}: ${e.message}`).join("; ")
                            : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={onCommit}
                disabled={!canCommit}
                title={
                  summary.invalidCount > 0
                    ? "Fix invalid rows and re-upload before committing"
                    : undefined
                }
              >
                {committing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Commit {summary.validCount} rows
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={committing}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "err";
}) {
  const color = tone === "err" ? "text-red-600" : tone === "ok" ? "text-wk-azure" : "text-wk-night-grey";
  return (
    <div className="flex flex-col">
      <span className="text-xs text-wk-night-grey">{label}</span>
      <span className={`text-xl font-medium ${color}`}>{value}</span>
    </div>
  );
}
