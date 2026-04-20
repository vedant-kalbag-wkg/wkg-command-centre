"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftRight, Inbox, X, Loader2 } from "lucide-react";
import { fetchComparisonData, fetchEntityOptions } from "./actions";
import { ComparisonCards } from "./comparison-cards";
import type { ComparisonEntity, ComparisonEntityType } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const ENTITY_TYPE_LABELS: Record<ComparisonEntityType, string> = {
  location: "Locations",
  hotel_group: "Hotel Groups",
  region: "Regions",
};

const ENTITY_TYPES: ComparisonEntityType[] = ["location", "hotel_group", "region"];

export default function ComparePage() {
  const filters = useAnalyticsFilters();
  const filtersJson = JSON.stringify(filters);

  // Controls state
  const [entityType, setEntityType] = useState<ComparisonEntityType>("location");
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Results state
  const [results, setResults] = useState<ComparisonEntity[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompared, setHasCompared] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Load entity options when type changes
  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setSelectedIds([]);
    setResults([]);
    setHasCompared(false);
    setError(null);

    fetchEntityOptions(entityType)
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load options");
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityType]);

  // Run comparison
  const runComparison = useCallback(async () => {
    if (selectedIds.length < 2) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResultsLoading(true);
    setError(null);
    setHasCompared(true);

    try {
      const parsed = JSON.parse(filtersJson);
      const data = await fetchComparisonData(entityType, selectedIds, parsed);
      if (!controller.signal.aborted) {
        setResults(data);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Comparison failed");
      }
    } finally {
      if (!controller.signal.aborted) {
        setResultsLoading(false);
      }
    }
  }, [entityType, selectedIds, filtersJson]);

  const toggleEntity = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const removeEntity = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Compare"
        description="Side-by-side comparison of locations, hotel groups, or regions"
      />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="space-y-4 rounded-lg border p-4">
        {/* Entity type selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Entity type
          </label>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {ENTITY_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setEntityType(type)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  entityType === type
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ENTITY_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Entity picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Select entities to compare (2+)
          </label>

          {/* Selected badges */}
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedIds.map((id) => {
                const option = options.find((o) => o.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    {option?.name ?? id}
                    <button
                      onClick={() => removeEntity(id)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Options list */}
          {optionsLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {options.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No {ENTITY_TYPE_LABELS[entityType].toLowerCase()} found
                </p>
              ) : (
                options.map((option) => {
                  const isSelected = selectedIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      onClick={() => toggleEntity(option.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        isSelected && "bg-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {isSelected && (
                          <svg
                            className="size-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{option.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Compare button */}
        <Button
          onClick={runComparison}
          disabled={selectedIds.length < 2 || resultsLoading}
          className="w-full sm:w-auto"
        >
          {resultsLoading ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : (
            <ArrowLeftRight className="size-4" data-icon="inline-start" />
          )}
          Compare {selectedIds.length > 0 && `(${selectedIds.length})`}
        </Button>
      </div>

      {/* Results */}
      {resultsLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: selectedIds.length }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}

      {!resultsLoading && hasCompared && results.length > 0 && (
        <ComparisonCards entities={results} />
      )}

      {!resultsLoading && hasCompared && results.length === 0 && (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={Inbox}
            title="No data found for the selected entities"
            description="Try widening the date range or selecting different entities."
          />
        </div>
      )}
    </div>
  );
}
