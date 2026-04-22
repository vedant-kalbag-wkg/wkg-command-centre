import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/analytics/stat-card";

export function KpiStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <StatCard key={i} label="" value="" loading />
      ))}
    </div>
  );
}

interface ChartCardSkeletonProps {
  title: string;
  /**
   * Tailwind height class for the inner skeleton — should approximate the
   * rendered chart height to avoid CLS when the real island hydrates.
   * Defaults to `h-64` to match the old behaviour.
   */
  approxHeight?: string;
}

/**
 * Matches the visual shell of `ChartCard` (header + body) but lets callers
 * size the inner Skeleton per-island so the fallback doesn't resize on
 * hydration. We render the shell directly rather than using ChartCard's
 * `loading` prop because that prop unconditionally renders `h-64`.
 */
export function ChartCardSkeleton({
  title,
  approxHeight = "h-64",
}: ChartCardSkeletonProps) {
  return (
    <Card className="gap-0 py-0 lg:col-span-12 flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      </div>
      <div className="flex-1 p-4">
        <Skeleton className={`${approxHeight} w-full`} />
      </div>
    </Card>
  );
}
