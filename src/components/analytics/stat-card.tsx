"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: {
    value: number;
    direction: "up" | "down" | "flat";
    label?: string;
  };
  sparkline?: number[];
  loading?: boolean;
  className?: string;
}

const deltaStyles: Record<
  NonNullable<StatCardProps["delta"]>["direction"],
  string
> = {
  up: "bg-[--color-wk-success]/10 text-[--color-wk-success]",
  down: "bg-destructive/10 text-destructive",
  flat: "bg-muted text-muted-foreground",
};

const deltaIcons = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

export function StatCard({
  label,
  value,
  delta,
  sparkline,
  loading,
  className,
}: StatCardProps) {
  const sparklineData = sparkline?.map((v, i) => ({ i, v })) ?? [];
  const DeltaIcon = delta ? deltaIcons[delta.direction] : null;

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs tracking-wider uppercase text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums text-foreground truncate">
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
          )}
          {!loading && delta && DeltaIcon && (
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
                  deltaStyles[delta.direction],
                )}
              >
                <DeltaIcon className="size-3" />
                {delta.value > 0 ? "+" : ""}
                {delta.value}%
              </span>
              {delta.label && (
                <span className="text-xs text-muted-foreground">
                  {delta.label}
                </span>
              )}
            </div>
          )}
          {loading && <Skeleton className="mt-1 h-4 w-20" />}
        </div>
        {sparkline && sparkline.length > 1 && !loading && (
          <div className="h-6 w-20 shrink-0 text-primary">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}
