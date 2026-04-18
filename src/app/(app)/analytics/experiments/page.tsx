"use client";

import { useEffect, useState, useCallback } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, FlaskConical, CalendarClock } from "lucide-react";
import { CohortForm } from "./cohort-form";
import {
  listCohorts,
  listLocationsForPicker,
  createCohort,
  deleteCohort,
  fetchCohortComparison,
  fetchTemporalComparison,
} from "./actions";
import type {
  ExperimentCohort,
  CohortComparison,
  TemporalComparison,
  PeriodMetrics,
} from "@/lib/analytics/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function DeltaValue({ value, format }: { value: number; format: "currency" | "number" }) {
  const isPositive = value > 0;
  const isNeutral = value === 0;
  const color = isNeutral
    ? "text-muted-foreground"
    : isPositive
      ? "text-emerald-600"
      : "text-red-600";
  const prefix = isPositive ? "+" : "";
  const formatted =
    format === "currency"
      ? `${prefix}${formatCurrency(value)}`
      : `${prefix}${value.toLocaleString("en-GB")}`;

  return <span className={`font-semibold ${color}`}>{formatted}</span>;
}

function MetricCard({
  title,
  cohortValue,
  controlValue,
  delta,
  format,
}: {
  title: string;
  cohortValue: number;
  controlValue: number;
  delta: number;
  format: "currency" | "number";
}) {
  const fmt = (v: number) =>
    format === "currency" ? formatCurrency(v) : v.toLocaleString("en-GB");

  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Cohort</p>
            <p className="text-lg font-semibold">{fmt(cohortValue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Control</p>
            <p className="text-lg font-semibold">{fmt(controlValue)}</p>
          </div>
        </div>
        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground">Delta</p>
          <DeltaValue value={delta} format={format} />
        </div>
      </CardContent>
    </Card>
  );
}

function pctChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function TemporalCard({
  period,
  changeFrom,
}: {
  period: PeriodMetrics;
  changeFrom?: PeriodMetrics;
}) {
  const revChange = changeFrom ? pctChange(period.revenue, changeFrom.revenue) : null;
  const txnChange = changeFrom ? pctChange(period.transactions, changeFrom.transactions) : null;

  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {period.periodLabel}
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          {period.dateFrom} to {period.dateTo}
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Revenue</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold">{formatCurrency(period.revenue)}</span>
            {revChange && (
              <span
                className={`text-xs font-medium ${
                  revChange.startsWith("+") ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {revChange}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Transactions</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold">{period.transactions.toLocaleString("en-GB")}</span>
            {txnChange && (
              <span
                className={`text-xs font-medium ${
                  txnChange.startsWith("+") ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {txnChange}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExperimentsPage() {
  const filters = useAnalyticsFilters();
  const filtersJson = JSON.stringify(filters);

  const [cohorts, setCohorts] = useState<ExperimentCohort[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CohortComparison | null>(null);
  const [temporal, setTemporal] = useState<TemporalComparison | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [compLoading, setCompLoading] = useState(false);
  const [temporalLoading, setTemporalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCohort = cohorts.find((c) => c.id === selectedId) ?? null;

  // Load cohorts + locations on mount
  const loadData = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const [cohortList, locationList] = await Promise.all([
        listCohorts(),
        listLocationsForPicker(),
      ]);
      setCohorts(cohortList);
      setLocations(locationList);
      if (cohortList.length > 0 && !selectedId) {
        setSelectedId(cohortList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setListLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load comparison when cohort or filters change
  const loadComparison = useCallback(async () => {
    if (!selectedId) {
      setComparison(null);
      return;
    }
    setCompLoading(true);
    try {
      const parsed = JSON.parse(filtersJson);
      const result = await fetchCohortComparison(selectedId, parsed);
      setComparison(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load comparison",
      );
    } finally {
      setCompLoading(false);
    }
  }, [selectedId, filtersJson]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  // Load temporal comparison when cohort changes (only if it has interventionDate)
  const loadTemporal = useCallback(async () => {
    if (!selectedId || !selectedCohort?.interventionDate) {
      setTemporal(null);
      return;
    }
    setTemporalLoading(true);
    try {
      const result = await fetchTemporalComparison(selectedId);
      setTemporal(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load temporal comparison",
      );
    } finally {
      setTemporalLoading(false);
    }
  }, [selectedId, selectedCohort?.interventionDate]);

  useEffect(() => {
    loadTemporal();
  }, [loadTemporal]);

  async function handleCreate(data: Parameters<typeof createCohort>[0]) {
    const newCohort = await createCohort(data);
    setCohorts((prev) => [...prev, newCohort]);
    setSelectedId(newCohort.id);
  }

  async function handleDelete(id: string) {
    await deleteCohort(id);
    setCohorts((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) {
      setSelectedId(cohorts.find((c) => c.id !== id)?.id ?? null);
      setComparison(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="size-6 text-wk-azure" />
        <h1 className="text-2xl font-bold tracking-tight">Experiments</h1>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left panel: cohort list */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Saved Cohorts
            </h2>
            <CohortForm locations={locations} onSubmit={handleCreate} />
          </div>

          {listLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : cohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No cohorts yet. Create one to get started.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {cohorts.map((cohort) => (
                <button
                  key={cohort.id}
                  onClick={() => setSelectedId(cohort.id)}
                  className={`group flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                    selectedId === cohort.id
                      ? "border-wk-azure/40 bg-wk-azure/5"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{cohort.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {cohort.locationIds.length} location
                      {cohort.locationIds.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(cohort.id);
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: comparison view */}
        <div className="flex flex-col gap-4">
          {!selectedCohort ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FlaskConical className="size-10 mb-3 opacity-40" />
                <p>Select or create a cohort to view comparison</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{selectedCohort.name}</h2>
                {selectedCohort.description && (
                  <span className="text-sm text-muted-foreground">
                    — {selectedCohort.description}
                  </span>
                )}
                {selectedCohort.interventionDate && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                    <CalendarClock className="size-3" />
                    Intervention: {selectedCohort.interventionDate}
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Cohort: {selectedCohort.locationIds.length} locations | Control:{" "}
                {selectedCohort.controlType === "rest_of_portfolio"
                  ? "Rest of portfolio"
                  : `${selectedCohort.controlLocationIds?.length ?? 0} named locations`}
              </p>

              {/* Section A: Temporal Analysis */}
              {selectedCohort.interventionDate && (
                <>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mt-2">
                    Temporal Analysis
                  </h3>
                  {temporalLoading ? (
                    <div className="grid grid-cols-2 gap-4">
                      {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-36 rounded-xl" />
                      ))}
                    </div>
                  ) : temporal ? (
                    <div className="grid grid-cols-2 gap-4">
                      <TemporalCard period={temporal.pre} />
                      <TemporalCard period={temporal.during} changeFrom={temporal.pre} />
                      <TemporalCard period={temporal.yoyPre} />
                      <TemporalCard period={temporal.yoyDuring} changeFrom={temporal.yoyPre} />
                    </div>
                  ) : null}
                </>
              )}

              {/* Section B: Cohort vs Control */}
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mt-2">
                Cohort vs Control
              </h3>
              {compLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-40 rounded-xl" />
                  ))}
                </div>
              ) : comparison ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <MetricCard
                    title="Revenue"
                    cohortValue={comparison.cohortMetrics.revenue}
                    controlValue={comparison.controlMetrics.revenue}
                    delta={comparison.delta.revenue}
                    format="currency"
                  />
                  <MetricCard
                    title="Transactions"
                    cohortValue={comparison.cohortMetrics.transactions}
                    controlValue={comparison.controlMetrics.transactions}
                    delta={comparison.delta.transactions}
                    format="number"
                  />
                  <MetricCard
                    title="Avg Revenue / Txn"
                    cohortValue={comparison.cohortMetrics.avgRevenue}
                    controlValue={comparison.controlMetrics.avgRevenue}
                    delta={comparison.delta.avgRevenue}
                    format="currency"
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
