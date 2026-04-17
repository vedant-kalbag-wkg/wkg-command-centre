"use client";

import { Button } from "@/components/ui/button";
import type { TrendGranularity } from "@/lib/analytics/types";

const OPTIONS: { value: TrendGranularity; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

interface GranularitySelectorProps {
  value: TrendGranularity;
  onChange: (g: TrendGranularity) => void;
}

export function GranularitySelector({
  value,
  onChange,
}: GranularitySelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border p-1">
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant={value === opt.value ? "default" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
