"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SeriesConfig, TrendMetric } from "@/lib/analytics/types";

const METRIC_OPTIONS: { value: TrendMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "transactions", label: "Transactions" },
  { value: "avg_basket_value", label: "Avg Basket Value" },
  { value: "booking_fee", label: "Booking Fee" },
];

interface SeriesRowProps {
  series: SeriesConfig;
  onUpdate: (id: string, patch: Partial<SeriesConfig>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

export function SeriesRow({
  series,
  onUpdate,
  onRemove,
  canRemove,
}: SeriesRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      {/* Color swatch */}
      <div
        className="size-4 shrink-0 rounded-full"
        style={{ backgroundColor: series.color }}
        title={series.color}
      />

      {/* Metric select */}
      <Select
        value={series.metric}
        onValueChange={(v) =>
          onUpdate(series.id, { metric: v as TrendMetric })
        }
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {METRIC_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Label input */}
      <Input
        className="h-8 flex-1 text-xs"
        value={series.label}
        onChange={(e) =>
          onUpdate(series.id, { label: e.target.value, labelEdited: true })
        }
        placeholder="Series label"
      />

      {/* Remove button */}
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={() => onRemove(series.id)}
        >
          <X className="size-3.5" />
          <span className="sr-only">Remove series</span>
        </Button>
      )}
    </div>
  );
}
