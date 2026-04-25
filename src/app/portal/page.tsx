import { redirect } from "next/navigation";

export default function PortalIndexPage() {
  // Portal feature-paused 2026-04-25 (see archive/portal-lockdown-2026-04-25);
  // direct redirect to coming-soon avoids a double-hop through the analytics
  // layout's redirect.
  redirect("/portal/coming-soon");
}
