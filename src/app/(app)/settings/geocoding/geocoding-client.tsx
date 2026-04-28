"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, MapPin, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  dryRunGeocoding,
  applyGeocoding,
  cancelGeocoding,
} from "./actions";
import type {
  GeocodeStageSummary,
  GeocodeStagedRow,
} from "@/lib/geocoding/pipeline";

/**
 * Six-state machine — mirrors the Sales-import / duplicates patterns:
 *   idle      → start screen with checkbox + "Run Dry-Run" button
 *   staging   → spinner while the dry-run runs (~40s for 392 rows)
 *   preview   → preview table + Apply / Cancel buttons
 *   applying  → spinner during commit
 *   complete  → success panel with row counts
 *   error     → error panel with retry
 */
type State =
  | { kind: "idle" }
  | { kind: "staging" }
  | { kind: "preview"; summary: GeocodeStageSummary }
  | { kind: "applying"; summary: GeocodeStageSummary }
  | {
      kind: "complete";
      summary: GeocodeStageSummary;
      result: { rowsUpdated: number; auditLogsWritten: number };
    }
  | { kind: "error"; message: string };

export function GeocodingClient() {
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const [forceRerun, setForceRerun] = React.useState(false);

  async function handleDryRun() {
    setState({ kind: "staging" });
    const res = await dryRunGeocoding({ forceRerun });
    if ("error" in res) {
      setState({ kind: "error", message: res.error });
      return;
    }
    if (res.summary.totalCandidates === 0) {
      toast.info("No candidates — every active location already has lat/lng.");
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "preview", summary: res.summary });
  }

  async function handleApply(summary: GeocodeStageSummary) {
    setState({ kind: "applying", summary });
    const res = await applyGeocoding(summary.stagingId, summary.rows);
    if ("error" in res) {
      setState({ kind: "error", message: res.error });
      return;
    }
    setState({ kind: "complete", summary, result: res.result });
  }

  async function handleCancel(summary: GeocodeStageSummary) {
    await cancelGeocoding(summary.stagingId);
    setState({ kind: "idle" });
    toast.info("Dry-run discarded");
  }

  function handleReset() {
    setForceRerun(false);
    setState({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl">
      {state.kind === "idle" && (
        <IdlePanel
          forceRerun={forceRerun}
          onForceRerunChange={setForceRerun}
          onRun={handleDryRun}
        />
      )}

      {state.kind === "staging" && (
        <SpinnerPanel
          title="Running dry-run…"
          description="Calling Google Maps for each candidate location with a 100ms politeness delay. ~40 seconds for ~400 rows."
        />
      )}

      {state.kind === "preview" && (
        <PreviewPanel
          summary={state.summary}
          onApply={() => handleApply(state.summary)}
          onCancel={() => handleCancel(state.summary)}
        />
      )}

      {state.kind === "applying" && (
        <SpinnerPanel
          title="Applying…"
          description={`Writing latitude/longitude on ${state.summary.okCount} location(s) and one audit-log row each.`}
        />
      )}

      {state.kind === "complete" && (
        <CompletePanel
          summary={state.summary}
          result={state.result}
          onReset={handleReset}
        />
      )}

      {state.kind === "error" && (
        <ErrorPanel message={state.message} onReset={handleReset} />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function IdlePanel({
  forceRerun,
  onForceRerunChange,
  onRun,
}: {
  forceRerun: boolean;
  onForceRerunChange: (v: boolean) => void;
  onRun: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Dry-Run</CardTitle>
        <CardDescription>
          Default behaviour skips locations that already have
          latitude/longitude. Tick &quot;Re-geocode all&quot; to overwrite
          every active location regardless of current coordinates.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={forceRerun}
            onCheckedChange={(v) => onForceRerunChange(Boolean(v))}
          />
          <span className="text-sm">
            Re-geocode all (force-rerun, including rows that already have
            lat/lng)
          </span>
        </label>

        <div>
          <Button onClick={onRun} aria-label="Run Dry-Run">
            <MapPin className="size-4 mr-1.5" />
            Run Dry-Run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SpinnerPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-12 justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewPanel({
  summary,
  onApply,
  onCancel,
}: {
  summary: GeocodeStageSummary;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Preview ({summary.totalCandidates} candidates)</CardTitle>
          <CardDescription>
            <span className="font-mono">{summary.okCount}</span> ok ·{" "}
            <span className="font-mono">{summary.noResultsCount}</span>{" "}
            no-results · <span className="font-mono">{summary.errorCount}</span>{" "}
            error. Apply will write lat/lng on the ok rows only and create one
            audit-log row per populated location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[600px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Current lat/lng</TableHead>
                  <TableHead>Proposed lat/lng</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((r) => (
                  <PreviewRow key={r.locationId} row={r} />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 sticky bottom-0 bg-background py-3 border-t">
        <Button onClick={onApply} aria-label="Apply Geocoding">
          <CheckCircle2 className="size-4 mr-1.5" />
          Apply ({summary.okCount} row{summary.okCount === 1 ? "" : "s"})
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <X className="size-4 mr-1.5" />
          Cancel
        </Button>
      </div>
    </>
  );
}

function PreviewRow({ row }: { row: GeocodeStagedRow }) {
  const proposed =
    row.result.status === "ok"
      ? `${row.result.latitude.toFixed(6)}, ${row.result.longitude.toFixed(6)}`
      : "—";
  const confidence =
    row.result.status === "ok" ? row.result.locationType : "—";
  const status =
    row.result.status === "ok" ? (
      <span className="text-green-600 dark:text-green-400">ok</span>
    ) : row.result.status === "no_results" ? (
      <span className="text-amber-600 dark:text-amber-400">no_results</span>
    ) : (
      <span className="text-red-600 dark:text-red-400" title={row.result.errorMessage}>
        error
      </span>
    );
  const current =
    row.currentLat !== null && row.currentLng !== null
      ? `${row.currentLat.toFixed(4)}, ${row.currentLng.toFixed(4)}`
      : "—";
  return (
    <TableRow>
      <TableCell className="font-medium">{row.locationName}</TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
        {row.address ?? "—"}
      </TableCell>
      <TableCell className="font-mono text-xs">{current}</TableCell>
      <TableCell className="font-mono text-xs">{proposed}</TableCell>
      <TableCell className="text-xs">{confidence}</TableCell>
      <TableCell>{status}</TableCell>
    </TableRow>
  );
}

function CompletePanel({
  summary,
  result,
  onReset,
}: {
  summary: GeocodeStageSummary;
  result: { rowsUpdated: number; auditLogsWritten: number };
  onReset: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CheckCircle2 className="inline-block size-5 text-green-600 dark:text-green-400 mr-1.5 align-text-bottom" />
          Geocoding applied
        </CardTitle>
        <CardDescription>
          Wrote {result.rowsUpdated} location row(s); created{" "}
          {result.auditLogsWritten} audit-log entr
          {result.auditLogsWritten === 1 ? "y" : "ies"}.
          {summary.errorCount + summary.noResultsCount > 0 && (
            <>
              {" "}
              {summary.errorCount + summary.noResultsCount} candidate(s) were
              skipped because the geocoder returned an error or no result —
              their lat/lng is unchanged.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onReset}>Run another</Button>
      </CardContent>
    </Card>
  );
}

function ErrorPanel({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <AlertTriangle className="inline-block size-5 text-red-600 dark:text-red-400 mr-1.5 align-text-bottom" />
          Could not run geocoding
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onReset} variant="outline">
          Back
        </Button>
      </CardContent>
    </Card>
  );
}
