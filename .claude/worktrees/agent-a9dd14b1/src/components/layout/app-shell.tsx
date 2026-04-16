"use client";

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

interface AppShellProps {
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

export function AppShell({ title, action, children }: AppShellProps) {
  const { isMobile } = useSidebar();

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Content header */}
      <header className="flex h-14 items-center gap-3 border-b border-wk-mid-grey px-6 shrink-0">
        {isMobile && (
          <SidebarTrigger className="text-wk-graphite" />
        )}
        <h1 className="text-xl font-bold tracking-[-0.01em] text-wk-graphite">
          {title}
        </h1>
        {action && <div className="ml-auto">{action}</div>}
      </header>

      {/* Content area */}
      <div className="flex-1 p-6 overflow-auto">
        {children}
      </div>
    </div>
  );
}
