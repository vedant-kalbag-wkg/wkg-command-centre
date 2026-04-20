"use client";

import { useDroppable } from "@dnd-kit/core";
import { usePivotStore, AVAILABLE_FIELDS } from "@/lib/stores/pivot-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { PivotAggregation } from "@/lib/analytics/types";

// ─── Drop Zone ──────────────────────────────────────────────────────────────

function DropZone({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[56px] rounded-lg border-2 border-dashed p-2 transition-colors ${
        isOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/20 bg-background"
      }`}
    >
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// ─── Field Chip (placed in zone) ────────────────────────────────────────────

function PlacedChip({
  fieldId,
  onRemove,
}: {
  fieldId: string;
  onRemove: () => void;
}) {
  const def = AVAILABLE_FIELDS.find((f) => f.id === fieldId);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
        def?.type === "metric"
          ? "bg-foreground/5 text-foreground"
          : "bg-primary/10 text-primary"
      }`}
    >
      {def?.label ?? fieldId}
      <button
        onClick={onRemove}
        className="rounded-sm p-0.5 hover:bg-black/10"
        aria-label={`Remove ${def?.label ?? fieldId}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Value Chip (with aggregation selector) ─────────────────────────────────

function ValueChip({
  index,
  field,
  aggregation,
  onRemove,
  onChangeAggregation,
}: {
  index: number;
  field: string;
  aggregation: PivotAggregation;
  onRemove: () => void;
  onChangeAggregation: (agg: PivotAggregation) => void;
}) {
  const def = AVAILABLE_FIELDS.find((f) => f.id === field);
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-foreground/5 px-1.5 py-0.5 text-xs font-medium text-foreground">
      <Select
        value={aggregation}
        onValueChange={(v) => onChangeAggregation(v as PivotAggregation)}
      >
        <SelectTrigger className="h-5 w-[60px] border-0 bg-transparent px-1 text-[10px] shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sum">SUM</SelectItem>
          <SelectItem value="avg">AVG</SelectItem>
          <SelectItem value="count">COUNT</SelectItem>
          <SelectItem value="min">MIN</SelectItem>
          <SelectItem value="max">MAX</SelectItem>
        </SelectContent>
      </Select>
      <span>{def?.label ?? field}</span>
      <button
        onClick={onRemove}
        className="rounded-sm p-0.5 hover:bg-black/10"
        aria-label={`Remove ${def?.label ?? field}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Drop Zones Panel ───────────────────────────────────────────────────────

export function DropZones() {
  const rowFields = usePivotStore((s) => s.rowFields);
  const columnFields = usePivotStore((s) => s.columnFields);
  const values = usePivotStore((s) => s.values);
  const removeRowField = usePivotStore((s) => s.removeRowField);
  const removeColumnField = usePivotStore((s) => s.removeColumnField);
  const removeValue = usePivotStore((s) => s.removeValue);
  const updateValueAggregation = usePivotStore(
    (s) => s.updateValueAggregation,
  );

  return (
    <div className="flex flex-col gap-3">
      <DropZone id="rows" label="Rows">
        {rowFields.length === 0 && (
          <span className="text-[10px] text-muted-foreground/50">
            Drop dimensions here
          </span>
        )}
        {rowFields.map((f) => (
          <PlacedChip key={f} fieldId={f} onRemove={() => removeRowField(f)} />
        ))}
      </DropZone>

      <DropZone id="columns" label="Columns">
        {columnFields.length === 0 && (
          <span className="text-[10px] text-muted-foreground/50">
            Drop dimensions here
          </span>
        )}
        {columnFields.map((f) => (
          <PlacedChip
            key={f}
            fieldId={f}
            onRemove={() => removeColumnField(f)}
          />
        ))}
      </DropZone>

      <DropZone id="values" label="Values">
        {values.length === 0 && (
          <span className="text-[10px] text-muted-foreground/50">
            Drop metrics here
          </span>
        )}
        {values.map((v, i) => (
          <ValueChip
            key={`${v.field}-${v.aggregation}-${i}`}
            index={i}
            field={v.field}
            aggregation={v.aggregation}
            onRemove={() => removeValue(i)}
            onChangeAggregation={(agg) => updateValueAggregation(i, agg)}
          />
        ))}
      </DropZone>
    </div>
  );
}
