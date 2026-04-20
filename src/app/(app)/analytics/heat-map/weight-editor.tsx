"use client";

import { useHeatmapWeightsStore, type HeatmapWeights } from "@/lib/stores/heatmap-weights-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Metric metadata ──────────────────────────────────────────────────────────
// Labels + colours match the previous score-legend.tsx ordering.

const METRICS: {
  key: keyof HeatmapWeights;
  label: string;
  color: string;
}[] = [
  { key: "revenue", label: "Revenue", color: "bg-primary text-primary-foreground" },
  { key: "transactions", label: "Transactions", color: "bg-primary/80 text-primary-foreground" },
  { key: "revenuePerRoom", label: "Rev / Room", color: "bg-primary/60 text-primary-foreground" },
  { key: "txnPerKiosk", label: "Txn / Kiosk", color: "bg-primary/40 text-foreground" },
  { key: "basketValue", label: "Avg Basket", color: "bg-primary/20 text-foreground" },
];

interface WeightEditorProps {
  onApplied?: () => void;
}

export function WeightEditor({ onApplied }: WeightEditorProps) {
  const pending = useHeatmapWeightsStore((s) => s.pending);
  const isDirty = useHeatmapWeightsStore((s) => s.isDirty);
  const setPending = useHeatmapWeightsStore((s) => s.setPending);
  const apply = useHeatmapWeightsStore((s) => s.apply);
  const reset = useHeatmapWeightsStore((s) => s.reset);

  const total =
    pending.revenue +
    pending.transactions +
    pending.revenuePerRoom +
    pending.txnPerKiosk +
    pending.basketValue;
  const isValid = total === 100;

  const handleApply = () => {
    if (apply()) onApplied?.();
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">Composite Score Weights</h3>
          <p className="text-xs text-muted-foreground">
            Customise how each metric contributes to the composite score. Weights must sum to 100%.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => reset()}
            data-testid="weights-reset"
          >
            Reset to default
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={!isValid || !isDirty}
            data-testid="weights-apply"
          >
            Apply
          </Button>
        </div>
      </div>

      {/* Stacked-bar visualisation */}
      <div
        className="flex h-8 w-full overflow-hidden rounded-md border"
        data-testid="weights-bar"
        role="img"
        aria-label={`Composite score weight distribution, total ${total}%`}
      >
        {METRICS.map(({ key, color }) => {
          const value = pending[key];
          if (value <= 0) return null;
          return (
            <div
              key={key}
              style={{ flexBasis: `${value}%` }}
              className={cn(
                "flex items-center justify-center overflow-hidden text-xs font-medium transition-[flex-basis] duration-150",
                color,
              )}
              data-testid={`weights-bar-segment-${key}`}
              data-weight={value}
            >
              {value > 8 ? `${value}%` : ""}
            </div>
          );
        })}
      </div>

      {/* Inline legend (small screens / sub-8% segments fall back here) */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {METRICS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={cn("h-3 w-3 rounded-sm", color.split(" ")[0])} />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{pending[key]}%</span>
          </div>
        ))}
      </div>

      {/* Integer inputs — one per metric */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {METRICS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`weight-${key}`} className="text-xs text-muted-foreground">
              {label}
            </Label>
            <div className="relative">
              <Input
                id={`weight-${key}`}
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={pending[key]}
                onChange={(e) => {
                  const raw = e.target.value === "" ? 0 : Number(e.target.value);
                  setPending(key, raw);
                }}
                className="pr-7"
                data-testid={`weights-input-${key}`}
                aria-label={`${label} weight, percent`}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Validation banner */}
      {!isValid ? (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="weights-error-banner"
        >
          Weights must sum to 100%. Current total:{" "}
          <span className="font-semibold">{total}%</span>
          {total > 100 ? ` (${total - 100}% over)` : ` (${100 - total}% under)`}.
        </div>
      ) : (
        <div className="text-xs text-muted-foreground" data-testid="weights-total">
          Total: <span className="font-semibold text-foreground">{total}%</span>
          {isDirty ? " — click Apply to recompute scores." : " — weights applied."}
        </div>
      )}
    </div>
  );
}
