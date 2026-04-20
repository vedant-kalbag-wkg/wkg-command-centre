"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { usePivotFilters } from "@/lib/stores/analytics-filter-store";
import {
  usePivotStore,
  type FieldDefinition,
} from "@/lib/stores/pivot-store";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldList } from "./field-list";
import { DropZones } from "./drop-zones";
import { PivotToolbar } from "./pivot-toolbar";
import { PivotResultTable } from "./pivot-result-table";
import { fetchPivotData } from "./actions";
import type { PivotResponse, PivotConfig } from "@/lib/analytics/types";

export default function PivotTablePage() {
  const [result, setResult] = useState<PivotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<FieldDefinition | null>(null);

  // Pivot config from store
  const rowFields = usePivotStore((s) => s.rowFields);
  const columnFields = usePivotStore((s) => s.columnFields);
  const values = usePivotStore((s) => s.values);
  const periodComparison = usePivotStore((s) => s.periodComparison);
  const addRowField = usePivotStore((s) => s.addRowField);
  const addColumnField = usePivotStore((s) => s.addColumnField);
  const addValue = usePivotStore((s) => s.addValue);

  // Filters from pivot filter store
  const filters = usePivotFilters();

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // ─── DnD Handlers ──────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const field = event.active.data.current?.field as FieldDefinition | undefined;
    setActiveField(field ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveField(null);

    const { over, active } = event;
    if (!over) return;

    const field = active.data.current?.field as FieldDefinition | undefined;
    if (!field) return;

    const zoneId = over.id as string;

    if (zoneId === "rows" && field.type === "dimension") {
      addRowField(field.id);
    } else if (zoneId === "columns" && field.type === "dimension") {
      addColumnField(field.id);
    } else if (zoneId === "values" && field.type === "metric") {
      addValue({ field: field.id, aggregation: "sum" });
    }
  }

  // ─── Run Pivot ─────────────────────────────────────────────────────────

  const runPivot = useCallback(async () => {
    if (values.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const config: PivotConfig = {
        rowFields,
        columnFields,
        values,
        periodComparison,
      };

      const data = await fetchPivotData(config, filters);
      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to run pivot query",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [rowFields, columnFields, values, periodComparison, filters]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pivot Table"
        description="Drag dimensions and metrics to build custom cross-tabulations"
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-6">
          {/* Left panel: field list */}
          <div className="w-1/4 shrink-0">
            <div className="sticky top-4">
              <ChartCard title="Fields" description="Drag fields into rows, columns, or values">
                <FieldList />
              </ChartCard>
            </div>
          </div>

          {/* Right panel: drop zones + results */}
          <div className="flex flex-1 flex-col gap-4">
            <ChartCard
              title="Pivot Builder"
              description="Configure rows, columns, values, and comparisons"
            >
              <DropZones />
              <div className="mt-3 border-t pt-3">
                <PivotToolbar onRunPivot={runPivot} loading={loading} />
              </div>
            </ChartCard>

            {/* Results */}
            {loading ? (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            ) : result ? (
              <PivotResultTable data={result} />
            ) : (
              <EmptyState
                title="No pivot results yet"
                description={
                  'Drag fields into the zones above, then click "Run Analysis" to see results.'
                }
                className="rounded-lg border border-dashed"
              />
            )}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeField ? (
            <div
              className={`rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg ${
                activeField.type === "dimension"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-foreground/20 bg-foreground/5 text-foreground"
              }`}
            >
              {activeField.label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
