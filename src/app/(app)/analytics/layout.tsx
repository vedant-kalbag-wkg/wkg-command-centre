import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilterBar />
      {children}
    </div>
  );
}
