"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Menu,
  LogOut,
  LayoutGrid,
  MapPin,
  CalendarClock,
  Package,
  Layers,
  BarChart3,
  Grid3X3,
  TrendingUp,
  Building2,
  Globe,
  Timer,
  Table2,
  FlaskConical,
  ArrowLeftRight,
  Percent,
  ClipboardList,
  Settings,
  Filter,
  Ban,
  CalendarRange,
  Shield,
  Upload,
  ScrollText,
  Users,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  M3DropdownMenu,
  M3DropdownMenuContent,
  M3DropdownMenuItem,
  M3DropdownMenuLabel,
  M3DropdownMenuSeparator,
  M3DropdownMenuTrigger,
} from "@/components/ui/material-dropdown-menu";
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

interface AppNavbarProps {
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

const kioskManagementItems: NavItem[] = [
  { label: "Kiosks", href: "/kiosks", icon: LayoutGrid },
  { label: "Locations", href: "/locations", icon: MapPin },
  { label: "Installations", href: "/installations", icon: CalendarClock },
  { label: "Products", href: "/products", icon: Package },
  { label: "Kiosk Config Groups", href: "/kiosk-config-groups", icon: Layers },
];

const analyticsItems: NavItem[] = [
  { label: "Portfolio", href: "/analytics/portfolio", icon: BarChart3 },
  { label: "Heat Map", href: "/analytics/heat-map", icon: Grid3X3 },
  { label: "Trend Builder", href: "/analytics/trend-builder", icon: TrendingUp },
  { label: "Hotel Groups", href: "/analytics/hotel-groups", icon: Building2 },
  { label: "Regions", href: "/analytics/regions", icon: Globe },
  { label: "Location Groups", href: "/analytics/location-groups", icon: MapPin },
  { label: "Maturity", href: "/analytics/maturity", icon: Timer },
  { label: "Pivot Table", href: "/analytics/pivot-table", icon: Table2 },
  { label: "Experiments", href: "/analytics/experiments", icon: FlaskConical },
  { label: "Compare", href: "/analytics/compare", icon: ArrowLeftRight },
  { label: "Commission", href: "/analytics/commission", icon: Percent },
  { label: "Actions", href: "/analytics/actions-dashboard", icon: ClipboardList },
];

const analyticsAdminItems: NavItem[] = [
  { label: "Business Events", href: "/settings/business-events", icon: CalendarRange },
  { label: "Analytics Presets", href: "/settings/analytics-presets", icon: Filter },
  { label: "Outlet Exclusions", href: "/settings/outlet-exclusions", icon: Ban },
  { label: "Thresholds", href: "/settings/thresholds", icon: Gauge },
];

const systemAdminItems: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Users", href: "/settings/users", icon: Users },
  { label: "Data Import", href: "/settings/data-import/sales", icon: Upload },
  { label: "Data Quality", href: "/settings/data-quality", icon: Shield },
  { label: "Audit Log", href: "/settings/audit-log", icon: ScrollText },
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
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function isGroupActive(items: NavItem[], pathname: string): boolean {
  return items.some((item) => isItemActive(item.href, pathname));
}

// ============================================================
// Desktop dropdown section
// ============================================================

function NavDropdown({
  label,
  items,
  extraItems,
  extraLabel,
  pathname,
}: {
  label: string;
  items: NavItem[];
  extraItems?: NavItem[];
  extraLabel?: string;
  pathname: string;
}) {
  const allItems = extraItems ? [...items, ...extraItems] : items;
  const active = isGroupActive(allItems, pathname);

  return (
    <div className="relative group">
      <button
        className={cn(
          "flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "text-[#00A6D3] border-b-2 border-[#00A6D3]"
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
                  itemActive && "bg-accent text-[#00A6D3] font-medium",
                )}
              >
                <Icon className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            );
          })}
          {extraItems && extraItems.length > 0 && (
            <>
              <div className="my-1 border-t" />
              {extraLabel && (
                <p className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {extraLabel}
                </p>
              )}
              {extraItems.map((item) => {
                const Icon = item.icon;
                const itemActive = isItemActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors",
                      itemActive && "bg-accent text-[#00A6D3] font-medium",
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
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

// ============================================================
// User menu
// ============================================================

function UserMenu({
  userName,
  userEmail,
  userRole,
  isAdmin,
}: {
  userName: string;
  userEmail: string;
  userRole: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <M3DropdownMenu>
      <M3DropdownMenuTrigger className="h-9 w-9">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-white text-xs font-medium bg-[#00A6D3]">
            {getInitials(userName)}
          </AvatarFallback>
        </Avatar>
      </M3DropdownMenuTrigger>
      <M3DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-4 py-3 m3-item-enter">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="text-white text-sm font-medium bg-[#00A6D3]">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{userName}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            <RoleBadge role={userRole} />
          </div>
        </div>
        {isAdmin && (
          <>
            <M3DropdownMenuSeparator />
            <M3DropdownMenuLabel>Admin</M3DropdownMenuLabel>
            {systemAdminItems.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item.href, pathname);
              return (
                <M3DropdownMenuItem
                  key={item.href}
                  onSelect={() => router.push(item.href)}
                  className={cn(active && "text-[#00A6D3]")}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  {item.label}
                </M3DropdownMenuItem>
              );
            })}
          </>
        )}
        <M3DropdownMenuSeparator />
        <M3DropdownMenuItem
          onSelect={handleSignOut}
          className="text-red-600"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </M3DropdownMenuItem>
      </M3DropdownMenuContent>
    </M3DropdownMenu>
  );
}

// ============================================================
// Mobile nav section
// ============================================================

function MobileNavSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </p>
      {items.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors",
              active && "bg-accent text-[#00A6D3] font-medium",
            )}
          >
            <Icon className="size-4 text-muted-foreground" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

// ============================================================
// AppNavbar component
// ============================================================

export function AppNavbar({ user }: AppNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === "admin";

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
          {/* Logo */}
          <Link href="/kiosks" className="flex items-center gap-2 mr-4">
            <span className="text-lg font-bold text-[#00A6D3] tracking-[-0.01em]">
              WK
            </span>
            <span className="hidden sm:inline-block text-sm text-foreground/70">
              Command Centre
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-0.5">
            <NavDropdown
              label="Kiosk Management"
              items={kioskManagementItems}
              pathname={pathname}
            />
            <NavDropdown
              label="Analytics"
              items={analyticsItems}
              extraItems={isAdmin ? analyticsAdminItems : undefined}
              extraLabel="Configure"
              pathname={pathname}
            />
          </nav>
        </div>

        {/* Right: User + Mobile hamburger */}
        <div className="flex items-center gap-1">
          {user && (
            <UserMenu
              userName={user.name}
              userEmail={user.email}
              userRole={user.role}
              isAdmin={isAdmin}
            />
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
                  <span className="text-lg font-bold text-[#00A6D3]">WK</span>
                  <span className="ml-2 text-sm text-foreground/70">
                    Command Centre
                  </span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-4 overflow-y-auto max-h-[70vh]">
                <MobileNavSection
                  title="Kiosk Management"
                  items={kioskManagementItems}
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
                <MobileNavSection
                  title="Analytics"
                  items={analyticsItems}
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
                {isAdmin && (
                  <MobileNavSection
                    title="Configure"
                    items={analyticsAdminItems}
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                )}

                {/* Mobile user section */}
                {user && (
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2 px-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-white text-xs font-medium bg-[#00A6D3]">
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
                    {isAdmin && (
                      <MobileNavSection
                        title="Admin"
                        items={systemAdminItems}
                        pathname={pathname}
                        onNavigate={() => setMobileOpen(false)}
                      />
                    )}
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
