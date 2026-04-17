import { cookies } from "next/headers";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { ImpersonationBanner } from "@/components/analytics/impersonation-banner";

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const impersonatingUserId = cookieStore.get("impersonating_user_id")?.value;
  const impersonatingUserName = cookieStore.get("impersonating_user_name")?.value;

  return (
    <div className="flex flex-col gap-6">
      {impersonatingUserId && impersonatingUserName && (
        <ImpersonationBanner userName={impersonatingUserName} />
      )}
      <AnalyticsFilterBar />
      {children}
    </div>
  );
}
