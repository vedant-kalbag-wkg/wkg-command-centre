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

  const impersonationBanner =
    impersonatingUserId && impersonatingUserName ? (
      <ImpersonationBanner userName={impersonatingUserName} />
    ) : null;

  return (
    <div className="flex flex-col">
      {impersonationBanner}
      <AnalyticsFilterBar />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {children}
      </div>
    </div>
  );
}
