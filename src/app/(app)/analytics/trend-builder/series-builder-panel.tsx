"use client";

import { Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrendStore, TREND_PRESETS } from "@/lib/stores/trend-store";
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

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Series Builder</h3>
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
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
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
          <Button size="sm" onClick={applyChanges}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
