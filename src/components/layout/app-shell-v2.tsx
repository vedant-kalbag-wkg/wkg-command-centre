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
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <AppTopBar user={user} />
        {/* <SidebarInset> already renders <main> — keep this wrapper a <div>
            to avoid nested <main> (invalid HTML; trips strict-mode on
            page.getByRole("main") in tests/access-control/edit-tier.spec.ts:87). */}
        <div className="flex-1 min-w-0 overflow-x-clip">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
