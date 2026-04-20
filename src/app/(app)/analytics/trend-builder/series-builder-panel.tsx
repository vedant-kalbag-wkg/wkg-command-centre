"use client";

import { useEffect, useState } from "react";
import { Plus, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrendStore, TREND_PRESETS } from "@/lib/stores/trend-store";
import { getDimensionOptions } from "@/app/(app)/analytics/actions";
import type { DimensionOptions } from "@/lib/analytics/types";
import { SeriesRow } from "./series-row";

const MAX_SERIES = 6;

export function SeriesBuilderPanel() {
  const pendingSeries = useTrendStore((s) => s.pendingSeries);
  const addSeries = useTrendStore((s) => s.addSeries);
  const removeSeries = useTrendStore((s) => s.removeSeries);
  const updateSeries = useTrendStore((s) => s.updateSeries);
  const applyChanges = useTrendStore((s) => s.applyChanges);
  const loadPreset = useTrendStore((s) => s.loadPreset);
  const resetAll = useTrendStore((s) => s.resetAll);
  const builderPanelOpen = useTrendStore((s) => s.builderPanelOpen);
  const toggleBuilderPanel = useTrendStore((s) => s.toggleBuilderPanel);

  const [dimensionOptions, setDimensionOptions] =
    useState<DimensionOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDimensionOptions().then((opts) => {
      if (!cancelled) setDimensionOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Panel header with Azure left border */}
      <div className="border-l-4 border-primary bg-muted/30 px-4 py-3 flex items-center justify-between">
        <h3 className="text-base font-bold tracking-tight">Builder Panel</h3>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={toggleBuilderPanel}
          aria-label={builderPanelOpen ? "Collapse builder" : "Expand builder"}
        >
          {builderPanelOpen ? (
            <>
              <span>Collapse builder</span>
              <ChevronUp className="size-4" />
            </>
          ) : (
            <>
              <span>Expand builder</span>
              <ChevronDown className="size-4" />
            </>
          )}
        </button>
      </div>

      {/* Collapsible panel body — CSS grid-template-rows transition */}
      <div
        className="overflow-hidden transition-[grid-template-rows] duration-200"
        style={{
          display: "grid",
          gridTemplateRows: builderPanelOpen ? "1fr" : "0fr",
        }}
      >
        <div className="min-h-0">
          <div className="px-4 py-3 space-y-3">
            {/* Preset buttons */}
            <div className="flex items-center gap-1">
              {TREND_PRESETS.map((preset, idx) => (
                <Button
                  key={preset.name}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => loadPreset(idx)}
                >
                  {preset.name}
                </Button>
              ))}
            </div>

            {/* Series rows */}
            <div className="flex flex-col gap-2">
              {pendingSeries.map((series) => (
                <SeriesRow
                  key={series.id}
                  series={series}
                  onUpdate={updateSeries}
                  onRemove={removeSeries}
                  canRemove={pendingSeries.length > 1}
                  dimensionOptions={dimensionOptions}
                />
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addSeries}
                disabled={pendingSeries.length >= MAX_SERIES}
              >
                <Plus className="mr-1 size-3.5" />
                Add Series
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={resetAll}>
                  <RotateCcw className="mr-1 size-3.5" />
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={applyChanges}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
