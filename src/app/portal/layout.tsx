import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PortalSidebar } from "@/components/layout/portal-sidebar";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="h-dvh">
      <SidebarProvider>
        <PortalSidebar
          user={{
            name: session.user.name,
            email: session.user.email,
            role: (session.user.role as string) || "viewer",
          }}
        />
        <main className="flex-1 bg-white">{children}</main>
      </SidebarProvider>
    </div>
  );
}
