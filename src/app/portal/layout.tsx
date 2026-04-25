import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Portal feature-paused 2026-04-25 (see archive/portal-lockdown-2026-04-25).
 *
 * PortalNavbar is intentionally NOT rendered while the portal is dark — its
 * analytics nav entries all point at /portal/analytics/* routes that
 * redirect to /portal/coming-soon, so rendering them would create a
 * confusing loop on the coming-soon page itself.
 *
 * To revive: revert the lockdown tag and restore the navbar import + render
 * block (preserved verbatim below).
 *
 * Original render:
 *   import { PortalNavbar } from "@/components/layout/portal-navbar";
 *   ...
 *   <div className="flex min-h-dvh flex-col">
 *     <PortalNavbar user={{ name, email, role }} />
 *     <main className="flex-1 p-4 md:p-6">{children}</main>
 *   </div>
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
