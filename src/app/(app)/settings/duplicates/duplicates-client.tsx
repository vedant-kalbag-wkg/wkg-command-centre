"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X, Search, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { EmptyState } from "@/components/ui/empty-state";
import { MergeDialog } from "@/components/table/merge-dialog";
import { mergeLocationsAction } from "@/app/(app)/locations/merge-action";
import {
  scanDuplicateLocations,
  dismissDuplicatePair,
  type DuplicateCandidate,
} from "./actions";

const MERGE_FIELDS = [
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
  { key: "customerCode", label: "Customer Code" },
  { key: "hotelGroup", label: "Hotel Group" },
];

export function DuplicatesClient() {
  const router = useRouter();
  const [candidates, setCandidates] = React.useState<DuplicateCandidate[] | null>(null);
  const [threshold, setThreshold] = React.useState(0.75);
  const [isScanning, setIsScanning] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [activePair, setActivePair] = React.useState<DuplicateCandidate | null>(null);
  const [dismissing, setDismissing] = React.useState<string | null>(null);

  async function handleScan() {
    setIsScanning(true);
    try {
      const result = await scanDuplicateLocations();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setCandidates(result.candidates);
        toast.success(`Found ${result.candidates.length} candidate pair(s)`);
      }
    } finally {
      setIsScanning(false);
    }
  }

  async function handleDismiss(pair: DuplicateCandidate) {
    const key = `${pair.a.id}|${pair.b.id}`;
    setDismissing(key);
    try {
      const result = await dismissDuplicatePair(pair.a.id, pair.b.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setCandidates((prev) =>
          prev ? prev.filter((p) => `${p.a.id}|${p.b.id}` !== key) : prev
        );
        toast.success("Pair dismissed");
      }
    } finally {
      setDismissing(null);
    }
  }

  const visible = React.useMemo(
    () => (candidates ?? []).filter((c) => c.score >= threshold),
    [candidates, threshold]
  );

  const mergeRecords = activePair ? [activePair.a, activePair.b] : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-4">
        <Button onClick={handleScan} disabled={isScanning}>
          {isScanning ? (
            <Loader2 className="size-4 animate-spin mr-1.5" />
          ) : (
            <Search className="size-4 mr-1.5" />
          )}
          Scan for duplicates
        </Button>

        <div className="flex-1 max-w-md">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Confidence threshold
            </label>
            <span className="text-xs font-mono text-foreground">
              {threshold.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[threshold]}
            onValueChange={(v) => {
              const arr = Array.isArray(v) ? v : [v];
              setThreshold(arr[0]);
            }}
            min={0.5}
            max={0.95}
            step={0.05}
          />
        </div>
      </div>

      {candidates === null ? (
        <EmptyState
          icon={Search}
          title="Ready to scan"
          description="Press Scan to find candidate duplicate locations."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Copy}
          title="No pairs above threshold"
          description="Lower the slider to see weaker matches."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((pair) => {
            const key = `${pair.a.id}|${pair.b.id}`;
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-medium text-foreground">{pair.a.name}</div>
                    {pair.a.address && (
                      <div className="text-xs text-muted-foreground">{pair.a.address}</div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{pair.b.name}</div>
                    {pair.b.address && (
                      <div className="text-xs text-muted-foreground">{pair.b.address}</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 min-w-[140px]">
                  <span className="text-xs font-mono text-primary">
                    {(pair.score * 100).toFixed(0)}%
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {pair.reasons.map((r) => (
                      <span
                        key={r}
                        className="px-1.5 py-0.5 rounded bg-primary/10 text-[10px] text-primary"
                      >
                        {r === "geo" && pair.distanceMeters != null
                          ? `~${Math.round(pair.distanceMeters)}m`
                          : r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActivePair(pair);
                      setMergeOpen(true);
                    }}
                    disabled={isScanning || dismissing === key}
                  >
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(pair)}
                    disabled={isScanning || dismissing === key}
                    aria-label="Dismiss pair"
                  >
                    {dismissing === key ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        records={mergeRecords}
        fields={MERGE_FIELDS}
        getFieldValue={(r, k) => String((r as Record<string, unknown>)[k] ?? "")}
        getId={(r) => r.id}
        getName={(r) => r.name}
        onMerge={mergeLocationsAction}
        onSuccess={() => {
          if (activePair) {
            const aId = activePair.a.id;
            const bId = activePair.b.id;
            setCandidates((prev) =>
              prev
                ? prev.filter(
                    (p) =>
                      p.a.id !== aId &&
                      p.a.id !== bId &&
                      p.b.id !== aId &&
                      p.b.id !== bId
                  )
                : prev
            );
          }
          setActivePair(null);
          router.refresh();
        }}
        entityLabel="location"
      />
    </div>
  );
}
