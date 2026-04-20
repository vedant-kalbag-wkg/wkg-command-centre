# UI Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize the UI of the unified kiosk operations + analytics platform. Left-sidebar + top-bar shell, full light/dark theming, hybrid flat+elevated surface treatment, two reference pages (`/kiosks` + `/analytics/portfolio`), then sweep remaining pages.

**Architecture:** shadcn primitives for single-purpose components (button/card/table/input), Magic MCP (21st.dev) for composite KPI/analytics widgets. WeKnow brand tokens preserved as the source layer; all component code consumes only semantic shadcn roles (`bg-background`, `text-foreground`, etc.) so dark mode works automatically. Theme switching via `next-themes` with localStorage persistence.

**Tech Stack:** Next.js 16 · React 19 · Tailwind v4 · shadcn (`base-nova` style) · next-themes · Magic MCP 21st.dev · TanStack Table · recharts · Playwright.

**Design doc:** `docs/plans/2026-04-19-ui-modernization-design.md`

**Branch:** `ui/modernize-shadcn-magic`

**Conventions for this plan:**
- Every task ends with `npm run lint && npx tsc --noEmit` passing.
- Every task that touches a page ends with a dev-server visual check at `http://localhost:3003` (light mode after phase 1, both modes after phase 1 dark-token task).
- Commit messages use conventional style (`feat:`, `fix:`, `refactor:`, `style:`, `test:`, `chore:`).
- Tests run via `npx playwright test <spec>`.

---

## Phase 1 — Foundation

### Task 1.1: Install `next-themes`

**Files:**
- Modify: `package.json`

**Step 1: Install**

```bash
npm install next-themes
```

**Step 2: Verify**

```bash
npm ls next-themes
```
Expected: a version ≥0.4.0 listed.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install next-themes for dark mode support"
```

---

### Task 1.2: Add `<ThemeProvider>` to root layout

**Files:**
- Create: `src/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Create the provider wrapper**

```tsx
// src/components/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

**Step 2: Wire into root layout**

Edit `src/app/layout.tsx`:
- Add `suppressHydrationWarning` to the `<html>` tag.
- Wrap `{children}` with `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>`.

**Step 3: Verify**

```bash
npm run dev
```
Visit `http://localhost:3003`. Page should render with no hydration warnings in the browser console. Theme is still light (no toggle yet).

**Step 4: Type check**

```bash
npx tsc --noEmit
```
Expected: clean.

**Step 5: Commit**

```bash
git add src/components/theme-provider.tsx src/app/layout.tsx
git commit -m "feat(theme): wire next-themes provider into root layout"
```

---

### Task 1.3: Add dark-mode semantic tokens

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Add the `.dark` block**

After the existing `:root { ... }` block in `src/app/globals.css`, add:

```css
.dark {
  --background: #0A0A0A;
  --foreground: var(--color-wk-white);
  --card: #141414;
  --card-foreground: var(--color-wk-white);
  --popover: #161616;
  --popover-foreground: var(--color-wk-white);
  --primary: var(--color-wk-azure);
  --primary-foreground: var(--color-wk-white);
  --secondary: #1F1F1F;
  --secondary-foreground: var(--color-wk-white);
  --muted: #1A1A1A;
  --muted-foreground: var(--color-wk-mid-grey);
  --accent: #1F1F1F;
  --accent-foreground: var(--color-wk-white);
  --destructive: var(--color-wk-destructive);
  --border: #262626;
  --input: #262626;
  --ring: var(--color-wk-azure);
  --chart-1: #00A6D3;
  --chart-2: #33B8DB;
  --chart-3: #66CAE3;
  --chart-4: #ADADAD;
  --chart-5: #575A5C;

  --sidebar: #0A0A0A;
  --sidebar-foreground: var(--color-wk-white);
  --sidebar-primary: var(--color-wk-azure);
  --sidebar-primary-foreground: var(--color-wk-white);
  --sidebar-accent: rgba(0, 166, 211, 0.15);
  --sidebar-accent-foreground: var(--color-wk-white);
  --sidebar-border: #1F1F1F;
  --sidebar-ring: var(--color-wk-azure);
  --sidebar-background: #0A0A0A;
}
```

**Step 2: Add `--surface-elevated` token to both modes**

In `:root`, add: `--surface-elevated: var(--color-wk-white);`
In `.dark`, add: `--surface-elevated: #1A1A1A;`

In `@theme inline`, add:
```css
--color-surface-elevated: var(--surface-elevated);
```

**Step 3: Verify tokens parse**

```bash
npm run dev
```
Visit `http://localhost:3003`. Page should render identically to before (still light mode, no toggle wired).

**Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): add dark-mode semantic tokens and --surface-elevated"
```

---

### Task 1.4: Build theme toggle component

**Files:**
- Create: `src/components/theme-toggle.tsx`

**Step 1: Create the toggle**

```tsx
// src/components/theme-toggle.tsx
"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

**Step 2: Temporarily mount in the existing `app-navbar.tsx`** (so we can test before we rewrite the navbar in Task 1.6)

In `src/components/layout/app-navbar.tsx`, inside the right-side div (around line 415-423 where `<UserMenu>` is rendered), render `<ThemeToggle />` immediately before `<UserMenu>`.

**Step 3: Visual verify**

```bash
npm run dev
```
Visit `http://localhost:3003`. Click the moon icon. Page should flip to dark mode. Click the sun icon. Page should flip back. Reload — theme should persist.

**Step 4: Commit**

```bash
git add src/components/theme-toggle.tsx src/components/layout/app-navbar.tsx
git commit -m "feat(theme): add theme toggle button in top nav"
```

---

### Task 1.5: Sweep `wk-*` class usage to semantic tokens

**Files:** 71 files across `src/` — see the mapping below.

**Context:** 586 occurrences of `wk-*` utility classes across 71 files. All must be replaced with semantic shadcn roles so dark mode works automatically. The light-mode output must be visually identical after this sweep.

**Class mapping:**

| `wk-*` utility | Semantic replacement | Notes |
|---|---|---|
| `bg-wk-azure` | `bg-primary` | |
| `bg-wk-azure/90` | `bg-primary/90` | tint preserved |
| `bg-wk-azure/40` | `bg-primary/40` | |
| `bg-wk-azure/10` | `bg-primary/10` | |
| `bg-wk-azure/5` | `bg-primary/5` | |
| `bg-wk-graphite` | `bg-foreground` | |
| `bg-wk-light-grey` | `bg-muted` | |
| `bg-wk-light-grey/50` | `bg-muted/50` | |
| `bg-wk-light-grey/40` | `bg-muted/40` | |
| `bg-wk-light-grey/30` | `bg-muted/30` | |
| `bg-wk-mid-grey` | `bg-border` | |
| `bg-wk-mid-grey/20` | `bg-border/20` | |
| `bg-wk-sky-blue` | `bg-primary/10` | approximation; manually verify |
| `bg-wk-sky-blue/40` | `bg-primary/5` | |
| `bg-wk-sea-blue` | `bg-primary` + darken in hover | manually verify |
| `bg-wk-success` | keep as `bg-[--color-wk-success]` | no semantic success token yet |
| `bg-wk-success/10` | `bg-[--color-wk-success]/10` | |
| `text-wk-azure` | `text-primary` | |
| `text-wk-azure/80` | `text-primary/80` | |
| `text-wk-graphite` | `text-foreground` | |
| `text-wk-graphite/70` | `text-foreground/70` | |
| `text-wk-graphite/60` | `text-foreground/60` | |
| `text-wk-mid-grey` | `text-muted-foreground` | |
| `text-wk-night-grey` | `text-muted-foreground` | |
| `text-wk-night-grey/50` | `text-muted-foreground/50` | |
| `text-wk-destructive` | `text-destructive` | |
| `text-wk-success` | `text-[--color-wk-success]` | |
| `text-wk-sea-blue` | `text-primary` | |
| `text-wk-gold` | `text-amber-600` | `wk-gold` is not a real token — this is a dead utility |
| `border-wk-azure` | `border-primary` | |
| `border-wk-azure/40` | `border-primary/40` | |
| `border-wk-mid-grey` | `border-border` | |
| `border-wk-mid-grey/60` | `border-border/60` | |
| `border-wk-mid-grey/40` | `border-border/40` | |
| `border-wk-mid-grey/30` | `border-border/30` | |
| `border-wk-light-grey` | `border-border` | |
| `border-wk-success` | `border-[--color-wk-success]` | |
| `border-wk-success/20` | `border-[--color-wk-success]/20` | |
| `ring-wk-azure` | `ring-ring` | |

**Hex literals to convert:** also look for any inline hex colors (`#00A6D3`, `#121212`, etc.) in component code (not CSS) and replace with semantic classes or `var(--color-*)` — these hex literals slip past a class-based sweep. `app-navbar.tsx` has several.

**Step 1: Dry-run list per file**

```bash
grep -rhE "(bg|text|border|ring|fill|stroke)-wk-[a-z-]+(/[0-9]+)?" src --include="*.tsx" --include="*.ts" -o | sort | uniq -c | sort -rn
```
Expected: produces a count of every class used. Use this as the checklist.

**Step 2: Sweep the `src/app/(auth)` directory**

Files: `login/page.tsx`, `set-password/page.tsx`, `reset-password/page.tsx`, `login-form.tsx`, `set-password-form.tsx`, `reset-password-form.tsx`.

Apply mapping table. Leave no `wk-*` utility classes in these files.

Verify: `grep -r "wk-" src/app/(auth) src/components/auth` returns no matches for utility classes.

**Step 3: Sweep `src/components/layout`**

Files: `app-navbar.tsx`, `portal-navbar.tsx`, `app-shell.tsx`. Also replace inline `#00A6D3`, `#121212` hex literals with semantic classes or token refs.

**Step 4: Sweep `src/components/ui`**

File: `inline-edit-field.tsx`.

**Step 5: Sweep `src/components/table`**

Files: `view-toolbar.tsx`, `editable-cell.tsx`, `bulk-toolbar.tsx`, `draggable-header.tsx`, `column-header-filter.tsx`, `saved-views-bar.tsx`.

**Step 6: Sweep `src/components/kiosks`**

Files: all with matches (kiosk-detail-form, kiosk-detail-sheet, kiosk-card, kiosk-kanban, kiosk-table, kiosk-columns, assignment-history).

**Step 7: Sweep `src/components/calendar`, `src/components/gantt`, `src/components/pipeline`**

**Step 8: Sweep `src/components/installations`, `src/components/locations`, `src/components/products`, `src/components/kiosk-config-groups`, `src/components/audit`, `src/components/admin`, `src/components/analytics`**

**Step 9: Sweep `src/app/(app)` pages**

All page files and their co-located clients under `src/app/(app)`.

**Step 10: Verify complete sweep**

```bash
grep -rE "(bg|text|border|ring|fill|stroke)-wk-[a-z-]+" src --include="*.tsx" --include="*.ts" | wc -l
```
Expected: `0`.

**Step 11: Type check and lint**

```bash
npm run lint && npx tsc --noEmit
```
Expected: clean.

**Step 12: Light-mode regression check**

Start dev server, navigate through every top-level route in light mode. Visual output should be byte-identical to pre-sweep. Take a screenshot of `/kiosks` and `/analytics/portfolio` to eyeball.

```bash
npm run dev
```

**Step 13: Dark-mode spot check**

Toggle to dark mode via the theme toggle. Pages should render in dark mode without white-on-white or invisible text. Imperfections expected in places that still use inline hex or hardcoded light-only colors — list these as follow-ups but do not fix in this task.

**Step 14: Commit in chunks**

Commit after each directory sweep (steps 2, 3, 4, 5, 6, 7, 8, 9) rather than one giant commit. Example:

```bash
git add src/components/layout
git commit -m "refactor(layout): replace wk-* classes with semantic tokens"
```

**Step 15: Final squash optional**

If the chunked history is noisy, at end of phase 1 you may squash the wk-* sweep commits into one with `git rebase -i` — up to executor.

---

### Task 1.6: Build the new `<AppShell>` (sidebar + top bar)

**Files:**
- Create: `src/components/layout/app-shell-v2.tsx`
- Create: `src/components/layout/app-sidebar.tsx`
- Create: `src/components/layout/app-top-bar.tsx`

**Step 1: Audit shadcn `Sidebar` primitive**

Read `src/components/ui/sidebar.tsx`. Note: `<Sidebar>`, `<SidebarProvider>`, `<SidebarContent>`, `<SidebarGroup>`, `<SidebarMenu>`, `<SidebarMenuItem>`, `<SidebarMenuButton>`, `<SidebarTrigger>`, `<SidebarInset>`. Use these as primitives — do not rebuild.

**Step 2: Build `app-sidebar.tsx`**

```tsx
// src/components/layout/app-sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  LayoutGrid, MapPin, CalendarClock, Package, Layers,
  BarChart3, Grid3X3, TrendingUp, Building2, Globe, Timer,
  Table2, FlaskConical, ArrowLeftRight, Percent, ClipboardList,
  CalendarRange, Filter, Ban, Gauge,
} from "lucide-react";

type NavItem = { label: string; href: string; icon: React.ComponentType<{ className?: string }> };

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
  { label: "Thresholds", href: "/settings/thresholds", icon: Gauge },
];

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavGroup({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
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
                <SidebarMenuButton asChild isActive={active}>
                  <Link href={item.href}>
                    <Icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

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
```

**Step 3: Build `app-top-bar.tsx`**

```tsx
// src/components/layout/app-top-bar.tsx
"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
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
      <Separator orientation="vertical" className="mx-2 h-6" />
      {/* Page title / breadcrumb slot — wired per-page via PageHeader */}
      <div className="flex-1" />
      <ThemeToggle />
      <UserMenu user={user} />
    </header>
  );
}
```

**Step 4: Extract `UserMenu` from old navbar**

- Create: `src/components/layout/user-menu.tsx`
- Copy the `UserMenu` component (currently local in `app-navbar.tsx`, lines 249-321) into this new file.
- Export as `UserMenu`. Accept a `user` prop. Preserve admin section + sign-out behavior exactly.

**Step 5: Build `app-shell-v2.tsx`**

```tsx
// src/components/layout/app-shell-v2.tsx
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
      <SidebarInset>
        <AppTopBar user={user} />
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

**Step 6: Type check**

```bash
npx tsc --noEmit
```
Expected: clean.

**Step 7: Commit**

```bash
git add src/components/layout/app-shell-v2.tsx src/components/layout/app-sidebar.tsx \
        src/components/layout/app-top-bar.tsx src/components/layout/user-menu.tsx
git commit -m "feat(shell): add sidebar + top bar app shell built on shadcn Sidebar"
```

---

### Task 1.7: Wire new shell into `(app)` layout

**Files:**
- Modify: `src/app/(app)/layout.tsx`

**Step 1: Replace AppNavbar with AppShellV2**

```tsx
// src/app/(app)/layout.tsx
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellV2 } from "@/components/layout/app-shell-v2";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <AppShellV2
      user={{
        name: session.user.name,
        email: session.user.email,
        role: (session.user.role as string) || "member",
      }}
    >
      {children}
    </AppShellV2>
  );
}
```

**Step 2: Visual verify**

```bash
npm run dev
```
Visit `http://localhost:3003/kiosks`, `/analytics/portfolio`, `/settings` (if admin). Sidebar should render on the left, top bar with theme toggle + user menu on top, content area flex-fills the rest. Clicking sidebar trigger collapses sidebar to icon-only rail. Theme toggle should still work.

**Step 3: Navigate every section briefly**

Click through Kiosks, Locations, Installations, Products, Kiosk Config Groups. Click through each Analytics item. Confirm active-state highlight follows the current route.

**Step 4: Playwright smoke test**

```bash
npx playwright test tests/smoke.spec.ts
```
Expected: pass. If it asserts on the old navbar structure (e.g., specific `role="navigation"` hierarchy), update the selectors in the test as a sub-step.

**Step 5: Commit**

```bash
git add src/app/(app)/layout.tsx
git commit -m "feat(shell): adopt sidebar+top-bar shell in (app) layout"
```

---

### Task 1.8: Retire the old `app-navbar.tsx` and `app-shell.tsx`

**Files:**
- Delete: `src/components/layout/app-navbar.tsx`
- Keep for now: `src/components/layout/app-shell.tsx` (still used by pages like `/kiosks/page.tsx` — will be retired in phase 2 when `<PageHeader>` replaces it).

**Step 1: Confirm `app-navbar.tsx` has no remaining importers**

```bash
grep -r "from \"@/components/layout/app-navbar\"" src
```
Expected: no results (only `(app)/layout.tsx` used to import it, now gone).

**Step 2: Delete**

```bash
rm src/components/layout/app-navbar.tsx
```

**Step 3: Type check**

```bash
npx tsc --noEmit
```
Expected: clean.

**Step 4: Commit**

```bash
git add src/components/layout/app-navbar.tsx
git commit -m "refactor(shell): remove obsolete top-only app-navbar"
```

---

### Task 1.9: Dark-mode overrides for `@svar-ui/react-gantt`

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Add a `.dark .gantt-wk` block**

After the existing `.gantt-wk { ... }` block, add:

```css
.dark .gantt-wk {
  --wx-gantt-task-color: #00A6D3;
  --wx-gantt-task-fill-color: #00A6D3;
  --wx-gantt-milestone-color: #00A6D3;

  --wx-grid-header-font-color: var(--color-wk-white);
  --wx-grid-body-font-color: var(--color-wk-white);

  --wx-timescale-font-color: var(--color-wk-mid-grey);
  --wx-gantt-border: 1px solid #262626;
}
```

**Step 2: Visual verify**

Navigate to `/kiosks?view=gantt` (or any page with gantt). Flip dark mode. Gantt should render readably in dark mode — grid text white/light, borders dark, task bars azure.

**Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(gantt): add dark-mode overrides for svar-ui gantt"
```

---

### Task 1.10: Dark-mode overrides for `react-big-calendar`

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Add dark overrides**

After the existing `.rbc-calendar-wk` blocks, add:

```css
.dark .rbc-calendar-wk .rbc-calendar {
  color: var(--color-wk-white);
}
.dark .rbc-calendar-wk .rbc-header {
  color: var(--color-wk-mid-grey);
  border-bottom: 1px solid #262626;
}
.dark .rbc-calendar-wk .rbc-today {
  background-color: rgba(0, 166, 211, 0.12);
}
.dark .rbc-calendar-wk .rbc-off-range-bg {
  background-color: #141414;
}
.dark .rbc-calendar-wk .rbc-day-bg + .rbc-day-bg,
.dark .rbc-calendar-wk .rbc-month-row + .rbc-month-row,
.dark .rbc-calendar-wk .rbc-time-content > * + * > *,
.dark .rbc-calendar-wk .rbc-time-header-content {
  border-color: #262626;
}
```

**Step 2: Visual verify**

Navigate to `/kiosks?view=calendar` (or wherever react-big-calendar is used). Flip dark mode. Calendar should render readably.

**Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style(calendar): add dark-mode overrides for react-big-calendar"
```

---

### Task 1.11: Phase 1 verification gate

**Files:** none (verification only).

**Step 1: Type check**

```bash
npx tsc --noEmit
```
Expected: clean.

**Step 2: Lint**

```bash
npm run lint
```
Expected: clean.

**Step 3: Existing Playwright suite**

```bash
npx playwright test
```
Expected: all tests pass. If tests fail due to selector changes (old navbar gone), update selectors — these are not regressions, they're test-maintenance.

**Step 4: Manual light-mode walk**

Start dev server. Visit each top-level route: `/kiosks`, `/locations`, `/installations`, `/products`, `/kiosk-config-groups`, `/analytics/portfolio`, `/analytics/heat-map`, `/analytics/trend-builder`, `/analytics/hotel-groups`, `/analytics/regions`, `/analytics/location-groups`, `/analytics/maturity`, `/analytics/pivot-table`, `/analytics/experiments`, `/analytics/compare`, `/analytics/commission`, `/analytics/actions-dashboard`, `/settings` (admin). Every page renders without error.

**Step 5: Manual dark-mode walk**

Flip dark mode. Revisit the same routes. Log any pages that have visibly broken colors (white-on-white text, invisible borders, etc.). Fix only the critical unreadable ones; defer aesthetic polish to later tasks.

**Step 6: Summary commit (optional)**

If anything was tweaked during steps 4–5, commit those fixes as one "polish: phase 1 dark-mode touch-ups" commit.

**Step 7: Create phase-1 summary commit**

```bash
git commit --allow-empty -m "chore: phase 1 foundation complete

- next-themes wired, sidebar + top bar shell
- full dark-mode tokens
- wk-* classes replaced with semantic roles
- gantt and react-big-calendar dark-mode overrides
"
```

---

## Phase 2 — Component kit + reference pages

### Task 2.1: Update `button` primitive

**Files:**
- Modify: `src/components/ui/button.tsx`

**Step 1: Read current file**

Read `src/components/ui/button.tsx` — note the `cva` config.

**Step 2: Add `sm` size variant**

In the `size` object of `buttonVariants`, add:

```ts
sm: "h-7 rounded-md px-2.5 text-xs gap-1.5 has-[>svg]:px-2",
```

Keep the existing `default` (h-9), `lg` (h-10), `icon` (size-9) untouched.

**Step 3: Type check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(ui/button): add sm size variant for dense toolbars"
```

---

### Task 2.2: Update `card` primitive — flat by default, `elevated` variant

**Files:**
- Modify: `src/components/ui/card.tsx`

**Step 1: Read current file**

**Step 2: Change `<Card>` baseline to flat**

- Remove any `shadow-*` from the default `<Card>` className.
- Ensure `border` stays.
- Add a `variant` prop typed as `"default" | "elevated"`, default `"default"`.
- When `variant="elevated"`: apply `shadow-sm bg-surface-elevated`.
- When `variant="default"`: apply `bg-card`.

**Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat(ui/card): flat by default, add elevated variant"
```

---

### Task 2.3: Update `input`, `select`, `textarea` heights

**Files:**
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/textarea.tsx`

**Step 1: Normalize heights**

- `input`: ensure `h-9` (36px).
- `select` trigger: ensure `h-9`.
- `textarea`: min-height stays flexible, but ensure padding matches input.

**Step 2: Ensure focus ring uses `--ring`**

Classes use `focus-visible:ring-2 focus-visible:ring-ring` (already standard in shadcn base-nova — verify, don't break).

**Step 3: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/select.tsx src/components/ui/textarea.tsx
git commit -m "feat(ui/forms): normalize input/select/textarea to 36px height"
```

---

### Task 2.4: Update `badge` primitive — add `subtle` variant

**Files:**
- Modify: `src/components/ui/badge.tsx`

**Step 1: Add `subtle` variant**

In `badgeVariants` cva, add variants for `subtle-primary`, `subtle-success`, `subtle-destructive`, `subtle-muted` with tinted backgrounds and colored text:

```ts
"subtle-primary": "bg-primary/10 text-primary border-primary/20",
"subtle-success": "bg-[--color-wk-success]/10 text-[--color-wk-success] border-[--color-wk-success]/20",
"subtle-destructive": "bg-destructive/10 text-destructive border-destructive/20",
"subtle-muted": "bg-muted text-muted-foreground border-border",
```

**Step 2: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "feat(ui/badge): add subtle variants for status chips"
```

---

### Task 2.5: Update `table` primitive — dense styles

**Files:**
- Modify: `src/components/ui/table.tsx`

**Step 1: Update row / cell styles**

- `<TableRow>`: `h-9` (36px) by default, remove any hover background transition beyond `hover:bg-muted/50`.
- `<TableHead>`: sticky top option, `h-9`, uppercase tracking, text-xs font-medium text-muted-foreground.
- `<TableCell>`: `px-3 py-2` (tightens from default).
- Add an optional `dense` prop on `<Table>` that tightens further to `h-8` rows — but default is already the new baseline.

**Step 2: Commit**

```bash
git add src/components/ui/table.tsx
git commit -m "feat(ui/table): dense row heights, sticky header support"
```

---

### Task 2.6: Add `breadcrumb` via shadcn registry

**Files:**
- Create: `src/components/ui/breadcrumb.tsx`

**Step 1: Add via shadcn CLI**

```bash
npx shadcn@latest add breadcrumb
```
Expected: writes `src/components/ui/breadcrumb.tsx`.

**Step 2: Visually check**

Render a test breadcrumb temporarily on `/kiosks` via the top bar. Light and dark mode readable. Remove test render before committing.

**Step 3: Commit**

```bash
git add src/components/ui/breadcrumb.tsx components.json
git commit -m "feat(ui/breadcrumb): add shadcn breadcrumb primitive"
```

---

### Task 2.7: Build `<PageHeader>` component

**Files:**
- Create: `src/components/layout/page-header.tsx`

**Step 1: Component**

```tsx
// src/components/layout/page-header.tsx
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  count,
  breadcrumb,
  actions,
  toolbar,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("border-b bg-background", className)}>
      <div className="flex flex-col gap-1 px-6 py-4">
        {breadcrumb}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h1>
              {count !== undefined && (
                <span className="text-sm text-muted-foreground">· {count.toLocaleString()}</span>
              )}
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      </div>
      {toolbar && (
        <div className="flex items-center gap-2 px-6 py-2 border-t bg-muted/30">
          {toolbar}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/layout/page-header.tsx
git commit -m "feat(layout): add PageHeader component"
```

---

### Task 2.8: Build `<EmptyState>` component

**Files:**
- Create: `src/components/ui/empty-state.tsx`

**Step 1: Component**

```tsx
// src/components/ui/empty-state.tsx
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {Icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState component"
```

---

### Task 2.9: Build `<DataTable>` wrapper

**Files:**
- Create: `src/components/ui/data-table.tsx`

**Step 1: Audit existing patterns**

Read the current uses of TanStack Table: `src/components/kiosks/kiosk-table.tsx`, `src/components/products/products-table.tsx`, `src/components/locations/location-table.tsx`, `src/components/installations/installation-table.tsx`, `src/components/audit/audit-table.tsx`, `src/components/admin/user-table.tsx`. Identify the common shape: columns, data, sort, filter, pagination, row selection, empty state.

**Step 2: Write the wrapper**

```tsx
// src/components/ui/data-table.tsx
"use client";

import {
  ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, useReactTable,
  SortingState, ColumnFiltersState, RowSelectionState,
} from "@tanstack/react-table";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  onRowClick?: (row: TData) => void;
}

export function DataTable<TData, TValue>({
  columns, data, emptyTitle = "No results", emptyDescription,
  className, onRowClick,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useReactTable({
    data, columns,
    state: { sorting, columnFilters, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className={cn("rounded-md border", className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/ui/data-table.tsx
git commit -m "feat(ui): add DataTable TanStack wrapper"
```

---

### Task 2.10: Build `<ChartCard>` wrapper

**Files:**
- Create: `src/components/ui/chart-card.tsx`

**Step 1: Component**

```tsx
// src/components/ui/chart-card.tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface ChartCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({
  title, description, action, loading, empty,
  emptyMessage = "No data", collapsible, defaultCollapsed,
  className, children,
}: ChartCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const showContent = !collapsed;

  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {collapsible && (
            <Button variant="ghost" size="icon" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </Button>
          )}
        </div>
      </div>
      {showContent && (
        <div className="flex-1 p-4">
          {loading ? <Skeleton className="h-64 w-full" /> : empty ? <EmptyState title={emptyMessage} /> : children}
        </div>
      )}
    </Card>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ui/chart-card.tsx
git commit -m "feat(ui): add ChartCard wrapper with loading/empty states"
```

---

### Task 2.11: Build `<StatCard>` via Magic MCP

**Files:**
- Create: `src/components/analytics/stat-card.tsx`

**Step 1: Prompt Magic MCP**

Use `mcp__magic__21st_magic_component_builder` with this brief:

> Build a KPI stat card component. Props: `label: string`, `value: string | number`, `delta?: { value: number; direction: "up" | "down" | "flat"; label?: string }`, `sparkline?: number[]`, `loading?: boolean`. Visual: compact, flat card with 1px border, 12-16px padding. Label in muted-foreground small uppercase, value in large semibold (tabular-nums), delta chip with colored background (primary subtle for up, destructive subtle for down, muted for flat). Optional tiny sparkline rendered via recharts LineChart (80-100px wide, 24px tall). Use shadcn Card primitive as base, honor light/dark via semantic tokens (bg-card, text-foreground, text-muted-foreground, border-border, text-primary, text-destructive). No animation beyond hover state. Loading shows a Skeleton in place of value/delta/sparkline.

**Step 2: Review and adjust**

Magic MCP's output goes into `src/components/analytics/stat-card.tsx`. Review for:
- Uses semantic tokens (no hex literals, no `wk-*` classes).
- Uses `recharts` (already installed) for sparkline, not a new lib.
- Matches props contract.
- Light + dark mode both render cleanly.

If quality is insufficient: discard and hand-build with shadcn Card + recharts Sparkline. Do not ship lower quality for the sake of using Magic MCP.

**Step 3: Mount a test render temporarily in `/analytics/portfolio` to eyeball**

**Step 4: Commit**

```bash
git add src/components/analytics/stat-card.tsx
git commit -m "feat(analytics): add StatCard via Magic MCP"
```

---

### Task 2.12: Build `<SparklineCell>` via Magic MCP

**Files:**
- Create: `src/components/table/sparkline-cell.tsx`

**Step 1: Prompt Magic MCP**

> Build a compact sparkline cell for use inside a dense table. Props: `data: number[]`, `color?: "primary" | "success" | "destructive" | "muted"` (default `"primary"`). Renders a 80x20 px recharts LineChart with no axes, no tooltips, stroke width 1.5. Honors light/dark via semantic tokens.

**Step 2: Review, same criteria as 2.11**

**Step 3: Commit**

```bash
git add src/components/table/sparkline-cell.tsx
git commit -m "feat(table): add SparklineCell via Magic MCP"
```

---

### Task 2.13: Rebuild `/kiosks` on the new kit

**Files:**
- Modify: `src/app/(app)/kiosks/page.tsx`
- Modify: `src/app/(app)/kiosks/view-tabs-client.tsx`
- Modify: `src/components/kiosks/kiosk-table.tsx`

**Step 1: Replace `AppShell` with `PageHeader`**

```tsx
// src/app/(app)/kiosks/page.tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listKiosks, listPipelineStages } from "@/app/(app)/kiosks/actions";
import { ViewTabsClient } from "./view-tabs-client";

export default async function KiosksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "kanban", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  const [kiosks, stages] = await Promise.all([listKiosks(), listPipelineStages()]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Kiosks"
        description="Manage, track, and configure deployed kiosks"
        count={kiosks.length}
        actions={
          <Link href="/kiosks/new">
            <Button size="sm">
              <Plus className="size-4" />
              Add kiosk
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto">
        <ViewTabsClient activeView={activeView} kiosks={kiosks} stages={stages} />
      </div>
    </div>
  );
}
```

**Step 2: Update view switcher to segmented control**

In `view-tabs-client.tsx`, change the tabs to a segmented control surfacing all four views (table, kanban, gantt, calendar) at once. Use shadcn `Tabs` primitive or a simple 4-button row if cleaner.

**Step 3: Migrate the kiosk table to `<DataTable>`**

In `kiosk-table.tsx`, strip the hand-rolled TanStack boilerplate (if present) and swap to the new `<DataTable columns={...} data={...} emptyTitle="No kiosks yet" emptyDescription="Add your first kiosk to get started" />` wrapper. If the existing table has custom features (bulk selection toolbar, saved views bar), keep those around the wrapper — the wrapper owns only the core grid.

**Step 4: Replace inline empty-state with `<EmptyState>`**

**Step 5: Type check + lint**

```bash
npx tsc --noEmit && npm run lint
```

**Step 6: Visual verify**

```bash
npm run dev
```
Light + dark mode walkthrough of `/kiosks` with all 4 views.

**Step 7: Playwright E2E — happy path**

Create/edit `tests/kiosks/list.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("kiosks list renders with header, table view, and add button", async ({ page }) => {
  await page.goto("/kiosks");
  await expect(page.getByRole("heading", { name: "Kiosks" })).toBeVisible();
  await expect(page.getByRole("link", { name: /add kiosk/i })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});
```

**Step 8: Playwright E2E — edge case**

```ts
test("kiosks list shows empty state when no kiosks", async ({ page }) => {
  // If your seed data has kiosks, skip or mock — comment explaining either way.
  // Alternative: assert the empty-state component exists as a valid rendering target by
  // navigating with a filter that produces zero rows.
  await page.goto("/kiosks?view=table&search=__nonexistent_xyz__");
  await expect(page.getByText(/no kiosks|no results/i)).toBeVisible();
});
```

Run:
```bash
npx playwright test tests/kiosks/list.spec.ts
```
Expected: pass.

**Step 9: Commit**

```bash
git add src/app/(app)/kiosks src/components/kiosks/kiosk-table.tsx tests/kiosks/list.spec.ts
git commit -m "feat(kiosks): rebuild list page on new PageHeader + DataTable kit"
```

---

### Task 2.14: Rebuild `/analytics/portfolio` on the new kit

**Files:**
- Modify: `src/app/(app)/analytics/portfolio/page.tsx`
- Possibly modify: section components (`analytics-summary.tsx`, `category-performance.tsx`, `top-products.tsx`, `daily-trends.tsx`, `hourly-distribution.tsx`, `outlet-tiers.tsx`, `high-performer-patterns.tsx`) to wrap each in `<ChartCard>`.

**Step 1: Replace accordion with 12-col grid**

In `page.tsx`, stop rendering `<SectionAccordion>`. Instead:

```tsx
<div className="flex flex-col min-h-0 flex-1">
  <PageHeader
    title="Portfolio"
    description="Cross-portfolio performance overview"
    actions={<>{/* comparison mode toggle, date range picker, export menu */}</>}
    toolbar={<>{/* filter bar — market, region, outlet group */}</>}
  />
  <div className="flex-1 overflow-auto p-6 space-y-4">
    {/* KPI strip */}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard label="Revenue" value={data?.summary.revenue ?? 0} delta={...} />
      <StatCard label="Orders" ... />
      <StatCard label="AOV" ... />
      <StatCard label="Unique Outlets" ... />
      <StatCard label="MoM Delta" ... />
    </div>
    {/* Charts grid */}
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <ChartCard title="Daily Trends" className="lg:col-span-12"><DailyTrends {...} /></ChartCard>
      <ChartCard title="Category Performance" className="lg:col-span-6"><CategoryPerformance {...} /></ChartCard>
      <ChartCard title="Top Products" className="lg:col-span-6"><TopProducts {...} /></ChartCard>
      <ChartCard title="Hourly Distribution" className="lg:col-span-6"><HourlyDistribution {...} /></ChartCard>
      <ChartCard title="Outlet Tiers" className="lg:col-span-6"><OutletTiers {...} /></ChartCard>
      <ChartCard title="High Performer Patterns" className="lg:col-span-12"><HighPerformerPatterns {...} /></ChartCard>
    </div>
  </div>
</div>
```

**Step 2: Strip section-level chrome** from each section component since `<ChartCard>` now owns title + padding. Each section should return only its chart body.

**Step 3: Move flags drawer into a right-side `<Sheet>`**

Add a button in the top of the filter bar `Active flags (N)` that opens a `<Sheet side="right">` showing the flags list.

**Step 4: Type check + lint**

**Step 5: Visual verify**

Light + dark mode.

**Step 6: Playwright E2E — happy path**

```ts
// tests/analytics/portfolio.spec.ts
test("portfolio page renders header, KPI strip, and chart grid", async ({ page }) => {
  await page.goto("/analytics/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText(/revenue/i).first()).toBeVisible();
  await expect(page.getByText(/daily trends/i)).toBeVisible();
});
```

**Step 7: Playwright E2E — edge case**

```ts
test("portfolio renders loading state on initial filter change", async ({ page }) => {
  await page.goto("/analytics/portfolio");
  // trigger a filter change that causes loadData to refire
  // assert at least one ChartCard shows its skeleton state briefly
  // (if loading disappears too fast, change timeout or assert on initial mount)
});
```

**Step 8: Commit**

```bash
git add src/app/(app)/analytics/portfolio tests/analytics/portfolio.spec.ts
git commit -m "feat(analytics): rebuild portfolio on PageHeader + StatCard + ChartCard grid"
```

---

### Task 2.15: Side-by-side consistency review

**Files:** none (review only).

**Step 1: Take screenshots**

```bash
npx playwright test -c '{"use":{"headless":false}}' --reporter=list --grep="@visual"
```
Or manually: open `/kiosks` and `/analytics/portfolio` side by side in two tabs. Take two screenshots each (light + dark).

**Step 2: Compare**

Confirm:
- Same `PageHeader` layout (title, description, actions on right).
- Same vertical rhythm (header height, content padding).
- Primary button is identical in color and size.
- Border colors match.
- Typography scale matches (title size, body size, muted text size).

**Step 3: Log inconsistencies as issues**

If anything feels off, fix now. Do not move to phase 3 with inconsistent reference pages.

**Step 4: Phase-2 summary commit**

```bash
git commit --allow-empty -m "chore: phase 2 component kit + reference pages complete"
```

---

## Phase 3 — Sweep remaining pages

Phase 3 is a repeating pattern applied to each remaining page. Per the design's rule, phase-3 PRs restyle only — no feature changes, no data-flow changes.

### Template: migrating one page

For each page `P`:

**Step 1: Wrap with `<PageHeader>` replacing any `<AppShell>` usage**

Move title, description, count, primary action into `<PageHeader>`. Move filter/search bar into `toolbar` prop.

**Step 2: Replace any ad-hoc table rendering with `<DataTable>`**

If the page is a list. Otherwise skip.

**Step 3: Replace inline empty states with `<EmptyState>`**

**Step 4: Wrap any charts with `<ChartCard>`**

**Step 5: Verify light + dark mode**

**Step 6: Playwright happy-path test**

**Step 7: Commit with message `feat(<section>): migrate <page> to new UI kit`**

### Pages grouped into suggested PR batches

Each bullet group is one PR.

**PR 3.1 — Kiosk Management list pages**
- `/locations`
- `/installations`
- `/products`
- `/kiosk-config-groups`

**PR 3.2 — Kiosk detail + new pages**
- `/kiosks/[id]`
- `/kiosks/new`

**PR 3.3 — Analytics overview family**
- `/analytics/heat-map`
- `/analytics/trend-builder`
- `/analytics/maturity`

**PR 3.4 — Analytics breakdown family**
- `/analytics/hotel-groups`
- `/analytics/regions`
- `/analytics/location-groups`
- `/analytics/pivot-table`

**PR 3.5 — Analytics operational family**
- `/analytics/experiments`
- `/analytics/compare`
- `/analytics/commission`
- `/analytics/actions-dashboard`

**PR 3.6 — Settings pages**
- `/settings` + all admin subpages.

**PR 3.7 — Retire old `<AppShell>` (the internal one)**
- Once all pages are migrated to `<PageHeader>`, delete `src/components/layout/app-shell.tsx`.
- Verify no remaining importers before deleting.
- Commit: `refactor(layout): remove obsolete per-page AppShell`

---

## Phase 3 verification gate

After all phase-3 PRs:

- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- Full Playwright suite passes.
- Manual light + dark mode walk of every route.
- No remaining `wk-*` utility classes in component code:

```bash
grep -rE "(bg|text|border|ring|fill|stroke)-wk-[a-z-]+" src --include="*.tsx" --include="*.ts" | wc -l
```
Expected: `0`.

- Final commit:
```bash
git commit --allow-empty -m "chore: phase 3 sweep complete — UI modernization done"
```

---

## Cross-cutting rules (karpathy + user preferences)

- **Surgical changes.** If a task says "modify button.tsx to add sm variant", do not also rename variables, refactor cva config, or reformat the file. Add the variant, ship.
- **No speculative features.** If Magic MCP output includes props beyond the spec (animations, variants, colors), strip them. Components match the plan's prop contract only.
- **No backwards compatibility.** When removing old `app-navbar.tsx` or old `app-shell.tsx`, delete outright. Do not leave re-export shims.
- **Verify before claim.** Never mark a task done without running the stated verification command and eyeballing the output.
- **Commits as checkpoints.** Every task ends with a commit. Don't let phases span multiple unrelated task commits — the task is the unit.
- **CARL rule 1.** Batch independent tool calls in parallel.
- **CARL rule 2.** Never mark tasks complete without validation.

## Done definition

- Two reference pages (`/kiosks`, `/analytics/portfolio`) use the new kit and look consistent with each other in both light and dark mode.
- Sidebar + top bar shell deployed on every `(app)` route.
- No `wk-*` utility classes in `src/**/*.{tsx,ts}` (only brand tokens in `globals.css`).
- Every `(app)` page renders in light and dark mode without visual regressions.
- Playwright happy-path + edge-case tests pass for both reference pages.
- Component kit (`PageHeader`, `DataTable`, `EmptyState`, `ChartCard`, `StatCard`, `SparklineCell`) in place and documented by their TSDoc headers.
