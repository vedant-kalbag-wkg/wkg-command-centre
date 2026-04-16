"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, MapPin, Settings, LogOut, CalendarClock, Package, Layers } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth-client";

const navItems = [
  { title: "Kiosks", href: "/kiosks", icon: LayoutGrid },
  { title: "Locations", href: "/locations", icon: MapPin },
  { title: "Installations", href: "/installations", icon: CalendarClock },
  { title: "Products", href: "/products", icon: Package },
  { title: "Kiosk Config Groups", href: "/kiosk-config-groups", icon: Layers },
  { title: "Settings", href: "/settings", icon: Settings },
];

interface AppSidebarProps {
  user?: {
    name: string;
    email: string;
    role: string;
  };
}

function getInitials(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  const styles: Record<string, string> = {
    admin: "bg-wk-graphite text-white",
    member: "bg-wk-light-grey text-wk-graphite",
    viewer: "bg-wk-sky-blue text-wk-night-grey",
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[role] || styles.member}`}
    >
      {label}
    </span>
  );
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-white tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
            WK
          </span>
          <SidebarTrigger className="text-white/70 hover:text-white hover:bg-white/10" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <nav aria-label="Main navigation">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.title}
                        className="h-10 px-2 rounded-lg text-white/70 hover:text-white hover:bg-[rgba(0,166,211,0.20)] data-active:text-white data-active:bg-[rgba(0,166,211,0.20)] data-active:border-l-2 data-active:border-l-[#00A6D3] [&_svg]:size-[18px]"
                        render={
                          <Link
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                          />
                        }
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="px-2 py-4">
        {user ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center">
              <Avatar className="size-8 shrink-0 bg-white/10 text-white">
                <AvatarFallback className="bg-white/10 text-white text-xs">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
                <span className="text-sm text-white truncate">{user.name}</span>
                <RoleBadge role={user.role} />
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors group-data-[collapsible=icon]:justify-center"
            >
              <LogOut className="size-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">
                Sign out
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2 text-white/70 group-data-[collapsible=icon]:justify-center">
            <Avatar className="size-8 shrink-0 bg-white/10">
              <AvatarFallback className="bg-white/10 text-white text-xs">
                ?
              </AvatarFallback>
            </Avatar>
            <span className="text-sm truncate group-data-[collapsible=icon]:hidden">
              User
            </span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
