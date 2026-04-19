"use client";

import { Button } from "@/components/ui/button";
import { usePivotStore } from "@/lib/stores/pivot-store";

type PivotToolbarProps = {
  onRunPivot: () => void;
  loading: boolean;
};

export function PivotToolbar({ onRunPivot, loading }: PivotToolbarProps) {
  const values = usePivotStore((s) => s.values);
  const periodComparison = usePivotStore((s) => s.periodComparison);
  const setPeriodComparison = usePivotStore((s) => s.setPeriodComparison);
  const clearAll = usePivotStore((s) => s.clearAll);

  const canRun = values.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={onRunPivot}
        disabled={!canRun || loading}
        size="sm"
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {loading ? "Running..." : "Run Analysis"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={clearAll}
        className="h-7 px-2 text-xs"
      >
        Clear All
      </Button>

      {/* Period comparison toggles — right-aligned */}
      <div className="flex items-center gap-1 rounded-md border p-0.5 ml-auto">
        <Button
          variant={periodComparison === "mom" ? "default" : "ghost"}
          size="sm"
          className={`h-7 px-2 text-xs ${
            periodComparison === "mom"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : ""
          }`}
          onClick={() =>
            setPeriodComparison(periodComparison === "mom" ? null : "mom")
          }
        >
          MoM
        </Button>
        <Button
          variant={periodComparison === "yoy" ? "default" : "ghost"}
          size="sm"
          className={`h-7 px-2 text-xs ${
            periodComparison === "yoy"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : ""
          }`}
          onClick={() =>
            setPeriodComparison(periodComparison === "yoy" ? null : "yoy")
          }
        >
          YoY
        </Button>
      </div>
    </div>
  );
}
