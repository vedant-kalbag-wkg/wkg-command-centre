"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  CalendarRange,
  Filter,
  Ban,
  Gauge,
  Tag,
  RefreshCw,
  Cloud,
  ScrollText,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

// ============================================================
// Types
// ============================================================

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

// ============================================================
// Navigation data
// ============================================================

const kioskManagement: NavItem[] = [
  { label: "Kiosks", href: "/kiosks", icon: LayoutGrid },
  { label: "Locations", href: "/locations", icon: MapPin },
  { label: "Installations", href: "/installations", icon: CalendarClock },
  { label: "Products", href: "/products", icon: Package },
  { label: "Kiosk Config Groups", href: "/kiosk-config-groups", icon: Layers },
];

const analytics: NavItem[] = [
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

const configure: NavItem[] = [
  { label: "Business Events", href: "/settings/business-events", icon: CalendarRange },
  { label: "Analytics Presets", href: "/settings/analytics-presets", icon: Filter },
  { label: "Outlet Exclusions", href: "/settings/outlet-exclusions", icon: Ban },
  { label: "Outlet Types", href: "/settings/outlet-types", icon: Tag },
  { label: "Monday Import", href: "/settings/data-import/monday", icon: RefreshCw },
  { label: "Azure ETL Runs", href: "/settings/data-import/azure", icon: Cloud },
  { label: "Audit Log", href: "/settings/audit-log", icon: ScrollText },
  { label: "Thresholds", href: "/settings/thresholds", icon: Gauge },
];

// ============================================================
// Helpers
// ============================================================

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// ============================================================
// Nav group
// ============================================================

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.href, pathname);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  render={
                    <Link href={item.href}>
                      <Icon />
                      <span>{item.label}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ============================================================
// AppSidebar
// ============================================================

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/kiosks" className="flex items-center gap-2 px-2 py-1">
          <span className="text-lg font-bold text-primary tracking-[-0.01em]">WK</span>
          <span className="text-sm text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
            Command Centre
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Kiosk Management" items={kioskManagement} pathname={pathname} />
        <NavGroup label="Analytics" items={analytics} pathname={pathname} />
        {isAdmin && <NavGroup label="Configure" items={configure} pathname={pathname} />}
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
