import { ChartCard } from "@/components/ui/chart-card";
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

export function ChartCardSkeleton({ title }: { title: string }) {
  return (
    <ChartCard title={title} loading className="gap-0 py-0 lg:col-span-12">
      {null}
    </ChartCard>
  );
}
