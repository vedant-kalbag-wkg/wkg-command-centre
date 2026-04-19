import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopBar } from "@/components/layout/app-top-bar";

export function AppShellV2({
  user,
  children,
}: {
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const isAdmin = user.role === "admin";
  return (
    <SidebarProvider>
      <AppSidebar isAdmin={isAdmin} />
      <SidebarInset className="min-w-0">
        <AppTopBar user={user} />
        <main className="flex-1 min-w-0 overflow-x-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
