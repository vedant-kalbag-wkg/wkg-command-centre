"use client";

import type { ScoreWeights } from "@/lib/analytics/types";

interface ScoreLegendProps {
  weights: ScoreWeights;
}

const WEIGHT_CONFIG: { key: keyof ScoreWeights; label: string; color: string }[] = [
  { key: "revenue", label: "Revenue", color: "bg-[#00A6D3]" },
  { key: "transactions", label: "Transactions", color: "bg-[#00A6D3]/80" },
  { key: "revenuePerRoom", label: "Rev / Room", color: "bg-[#00A6D3]/60" },
  { key: "txnPerKiosk", label: "Txn / Kiosk", color: "bg-[#00A6D3]/40" },
  { key: "basketValue", label: "Avg Basket", color: "bg-[#00A6D3]/20" },
];

export function ScoreLegend({ weights }: ScoreLegendProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Composite Score Weights
      </h3>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {WEIGHT_CONFIG.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <div className={`h-3 w-8 rounded-sm ${color}`} />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{(weights[key] * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
