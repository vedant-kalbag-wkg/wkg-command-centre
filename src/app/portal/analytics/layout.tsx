import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { getScopedDimensionOptions } from "./actions";

export default function PortalAnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilterBar fetchOptions={getScopedDimensionOptions} />
      {children}
    </div>
  );
}
