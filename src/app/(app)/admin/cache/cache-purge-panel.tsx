"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { purgeAnalyticsCache, type AnalyticsPurgeScope } from "./actions";

type PurgeRow = {
  id: string;
  actorName: string | null;
  entityId: string;
  createdAt: Date;
};

interface Props {
  recentPurges: PurgeRow[];
}

const SCOPE_OPTIONS: { value: AnalyticsPurgeScope; label: string }[] = [
  { value: "all", label: "All analytics (global invalidation)" },
  { value: "portfolio", label: "Portfolio" },
  { value: "regions", label: "Regions" },
  { value: "maturity", label: "Maturity" },
  { value: "heat-map", label: "Heat map" },
  { value: "location-groups", label: "Location groups" },
  { value: "hotel-groups", label: "Hotel groups" },
  { value: "compare", label: "Compare" },
  { value: "pivot-table", label: "Pivot table" },
  { value: "trend-builder", label: "Trend builder" },
  { value: "flags", label: "Flags" },
  { value: "thresholds", label: "Thresholds" },
];

export function CachePurgePanel({ recentPurges }: Props) {
  const [scope, setScope] = useState<AnalyticsPurgeScope>("all");
  const [pending, startTransition] = useTransition();

  const handlePurge = () => {
    startTransition(async () => {
      try {
        const result = await purgeAnalyticsCache(scope);
        toast.success(`Purged ${result.tag}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Purge failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invalidate cache</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={scope} onValueChange={(v) => setScope(v as AnalyticsPurgeScope)}>
            <SelectTrigger className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handlePurge} disabled={pending} className="max-w-sm">
            {pending ? "Purging…" : "Purge cache"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent purges</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPurges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purges logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentPurges.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{p.entityId}</span>
                  <span className="text-muted-foreground">
                    {p.actorName ?? "Unknown"} · {new Date(p.createdAt).toLocaleString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
