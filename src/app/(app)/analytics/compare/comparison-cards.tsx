"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { ComparisonEntity } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

type MetricKey = "revenue" | "transactions" | "avgBasket";

function getBestValues(entities: ComparisonEntity[]): Record<MetricKey, number> {
  return {
    revenue: Math.max(...entities.map((e) => e.revenue)),
    transactions: Math.max(...entities.map((e) => e.transactions)),
    avgBasket: Math.max(...entities.map((e) => e.avgBasket)),
  };
}

function MetricRow({
  label,
  value,
  formatted,
  isBest,
}: {
  label: string;
  value: number;
  formatted: string;
  isBest: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          isBest && value > 0 && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {formatted}
      </span>
    </div>
  );
}

// ─── Side-by-Side Cards ─────────────────────────────────────────────────────

export function ComparisonCards({
  entities,
}: {
  entities: ComparisonEntity[];
}) {
  const metricLabel = useMetricLabel();
  if (entities.length === 0) return null;

  const best = getBestValues(entities);

  return (
    <div className="space-y-6">
      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entities.map((entity) => (
          <Card key={entity.entityId} size="sm">
            <CardHeader>
              <CardTitle className="truncate">{entity.entityName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <MetricRow
                label={metricLabel}
                value={entity.revenue}
                formatted={formatCurrency(entity.revenue)}
                isBest={entity.revenue === best.revenue}
              />
              <MetricRow
                label="Transactions"
                value={entity.transactions}
                formatted={formatNumber(entity.transactions)}
                isBest={entity.transactions === best.transactions}
              />
              <MetricRow
                label="Avg Basket"
                value={entity.avgBasket}
                formatted={formatCurrency(entity.avgBasket)}
                isBest={entity.avgBasket === best.avgBasket}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Metric
              </th>
              {entities.map((entity) => (
                <th
                  key={entity.entityId}
                  className="px-4 py-3 text-right font-medium"
                >
                  {entity.entityName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="px-4 py-3 text-muted-foreground">{metricLabel}</td>
              {entities.map((entity) => (
                <td
                  key={entity.entityId}
                  className={cn(
                    "px-4 py-3 text-right tabular-nums",
                    entity.revenue === best.revenue &&
                      entity.revenue > 0 &&
                      "text-emerald-600 font-medium dark:text-emerald-400",
                  )}
                >
                  {formatCurrency(entity.revenue)}
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="px-4 py-3 text-muted-foreground">Transactions</td>
              {entities.map((entity) => (
                <td
                  key={entity.entityId}
                  className={cn(
                    "px-4 py-3 text-right tabular-nums",
                    entity.transactions === best.transactions &&
                      entity.transactions > 0 &&
                      "text-emerald-600 font-medium dark:text-emerald-400",
                  )}
                >
                  {formatNumber(entity.transactions)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-4 py-3 text-muted-foreground">Avg Basket</td>
              {entities.map((entity) => (
                <td
                  key={entity.entityId}
                  className={cn(
                    "px-4 py-3 text-right tabular-nums",
                    entity.avgBasket === best.avgBasket &&
                      entity.avgBasket > 0 &&
                      "text-emerald-600 font-medium dark:text-emerald-400",
                  )}
                >
                  {formatCurrency(entity.avgBasket)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
