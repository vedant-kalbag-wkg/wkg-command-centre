"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  LogOut,
  Settings,
  Shield,
  Upload,
  ScrollText,
  Users,
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
import { signOut } from "@/lib/auth-client";

// ============================================================
// Types
// ============================================================

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ============================================================
// System admin nav items (visible when user.role === "admin")
// ============================================================

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

// ============================================================
// Role badge
// ============================================================

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  const styles: Record<string, string> = {
    admin: "bg-foreground text-white",
    member: "bg-muted text-foreground",
    viewer: "bg-primary/10 text-muted-foreground",
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

export function UserMenu({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  const router = useRouter();
  const pathname = usePathname();

  const isAdmin = user.role === "admin";

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <M3DropdownMenu>
      <M3DropdownMenuTrigger className="h-9 w-9">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-white text-xs font-medium bg-primary">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
      </M3DropdownMenuTrigger>
      <M3DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-4 py-3 m3-item-enter">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="text-white text-sm font-medium bg-primary">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <RoleBadge role={user.role} />
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
                  className={cn(active && "text-primary")}
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
