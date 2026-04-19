"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";

export function AppTopBar({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger />
      <div className="flex-1" />
      <ThemeToggle />
      <UserMenu user={user} />
    </header>
  );
}
