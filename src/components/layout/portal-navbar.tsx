"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Menu,
  LogOut,
  BarChart3,
  Grid3X3,
  TrendingUp,
  Building2,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

// ============================================================
// Types
// ============================================================

interface PortalNavbarProps {
  user?: {
    name: string;
    email: string;
    role: string;
  };
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ============================================================
// Navigation data
// ============================================================

const analyticsItems: NavItem[] = [
  { label: "Portfolio", href: "/portal/analytics/portfolio", icon: BarChart3 },
  { label: "Heat Map", href: "/portal/analytics/heat-map", icon: Grid3X3 },
  { label: "Trend Builder", href: "/portal/analytics/trend-builder", icon: TrendingUp },
  { label: "Hotel Groups", href: "/portal/analytics/hotel-groups", icon: Building2 },
  { label: "Regions", href: "/portal/analytics/regions", icon: Globe },
];

// ============================================================
// Helpers
// ============================================================

function getInitials(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function isItemActive(href: string, pathname: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(href + "/");
}

function isGroupActive(items: NavItem[], pathname: string): boolean {
  return items.some((item) => isItemActive(item.href, pathname));
}

// ============================================================
// Desktop dropdown
// ============================================================

function NavDropdown({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  const active = isGroupActive(items, pathname);

  return (
    <div className="relative group">
      <button
        className={cn(
          "flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "text-primary border-b-2 border-primary"
            : "text-foreground/70 hover:text-foreground",
        )}
      >
        {label}
        <ChevronDown className="size-3" />
      </button>
      <div className="absolute left-0 top-full pt-1 hidden group-hover:block z-50">
        <div className="rounded-lg border bg-popover shadow-md p-1 min-w-[200px]">
          {items.map((item) => {
            const Icon = item.icon;
            const itemActive = isItemActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors",
                  itemActive && "bg-accent text-primary font-medium",
                )}
              >
                <Icon className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Role badge
// ============================================================

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  const styles: Record<string, string> = {
    admin: "bg-secondary text-secondary-foreground",
    member: "bg-muted text-muted-foreground",
    viewer: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[role] || styles.member}`}
    >
      {label}
    </span>
  );
}

// ============================================================
// PortalNavbar component
// ============================================================

export function PortalNavbar({ user }: PortalNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const handleMobileSignOut = async () => {
    setMobileOpen(false);
    await signOut();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-40 bg-background border-b">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        {/* Left: Logo + nav */}
        <div className="flex items-center gap-1">
          <Link href="/portal" className="flex items-center gap-2 mr-4">
            <span className="text-lg font-bold text-primary tracking-[-0.01em]">
              WK
            </span>
            <span className="hidden sm:inline-block text-sm text-foreground/70">
              Portal
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-0.5">
            <NavDropdown
              label="Analytics"
              items={analyticsItems}
              pathname={pathname}
            />
          </nav>
        </div>

        {/* Right: User + Mobile hamburger */}
        <div className="flex items-center gap-1">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="rounded-full" />
                }
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-white text-xs font-medium bg-primary">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                    <RoleBadge role={user.role} />
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-red-600 focus:text-red-600 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden text-muted-foreground"
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="top" showCloseButton={true}>
              <SheetHeader>
                <SheetTitle>
                  <span className="text-lg font-bold text-primary">WK</span>
                  <span className="ml-2 text-sm text-foreground/70">Portal</span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-4 overflow-y-auto max-h-[70vh]">
                <div className="space-y-1">
                  <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Analytics
                  </p>
                  {analyticsItems.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(item.href, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors",
                          active && "bg-accent text-primary font-medium",
                        )}
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>

                {user && (
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2 px-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-white text-xs font-medium bg-primary">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {user.name}
                        </span>
                        <RoleBadge role={user.role} />
                      </div>
                    </div>
                    <button
                      onClick={handleMobileSignOut}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-accent rounded-md transition-colors w-full"
                    >
                      <LogOut className="size-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
