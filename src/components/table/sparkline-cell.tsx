"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface SparklineCellProps {
  data: number[];
  color?: "primary" | "success" | "destructive" | "muted";
  className?: string;
}

const colorClasses: Record<NonNullable<SparklineCellProps["color"]>, string> = {
  primary: "text-primary",
  success: "text-[--color-wk-success]",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export function SparklineCell({
  data,
  color = "primary",
  className,
}: SparklineCellProps) {
  if (data.length < 2) return null;
  const plotData = data.map((v, i) => ({ i, v }));

  return (
    <div
      className={cn("h-5 w-20 shrink-0", colorClasses[color], className)}
      aria-hidden
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={plotData}>
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
  );
}
