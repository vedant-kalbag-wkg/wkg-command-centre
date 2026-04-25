import { redirect } from "next/navigation";

/**
 * External portal feature-paused 2026-04-25.
 *
 * The /portal/analytics/* pages are 1-line re-exports of the internal
 * analytics surfaces — they serve internal data with no external-user
 * scoping wired. Until the portal is properly built, every nested route
 * under /portal/analytics/ bounces here to /portal/coming-soon.
 *
 * To revive: `git revert archive/portal-lockdown-2026-04-25` (the lockdown
 * commit was tagged before the squash-merge so it's still revivable as a
 * single revert). The original layout body is preserved verbatim below
 * for in-place restoration.
 *
 * Original body (commented out):
 * import { cookies } from "next/headers";
 * import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
 * import { ImpersonationBanner } from "@/components/analytics/impersonation-banner";
 * import { getScopedDimensionOptions } from "./actions";
 *
 * export default async function PortalAnalyticsLayout({
 *   children,
 * }: {
 *   children: React.ReactNode;
 * }) {
 *   const cookieStore = await cookies();
 *   const impersonatingUserId = cookieStore.get("impersonating_user_id")?.value;
 *   const impersonatingUserName = cookieStore.get("impersonating_user_name")?.value;
 *
 *   return (
 *     <div className="flex flex-col gap-6">
 *       {impersonatingUserId && impersonatingUserName && (
 *         <ImpersonationBanner userName={impersonatingUserName} />
 *       )}
 *       <AnalyticsFilterBar fetchOptions={getScopedDimensionOptions} />
 *       {children}
 *     </div>
 *   );
 * }
 */
export default function PortalAnalyticsLayout() {
  redirect("/portal/coming-soon");
}
