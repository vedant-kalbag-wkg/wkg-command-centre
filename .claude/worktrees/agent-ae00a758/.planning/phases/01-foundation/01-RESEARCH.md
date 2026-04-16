# Phase 1: Foundation - Research

**Researched:** 2026-03-18
**Domain:** Next.js 16, Better Auth 1.5, Drizzle ORM + Neon PostgreSQL, Tailwind v4, shadcn/ui
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Auth Flow**
- Invite-only access — admin sends email invite, user sets password via link. No public signup.
- Long-lived sessions (30-day sliding window) — users rarely need to re-login
- Password reset via email link flow (enter email → receive link → set new password on dedicated page)
- Login page fully branded with WeKnow identity (logo, Azure/Graphite colours, Circular Pro font)
- Better Auth 1.5.x for auth/RBAC (pre-decided)

**User Management**
- Admin invites users with email + role only; user fills in their own name/details on first login
- User management lives in Settings > Users (not a separate admin area)
- Deactivate only — no permanent user deletion; records preserved for audit trail
- Admin can change a user's role anytime, with a confirmation warning about permission changes

**App Shell & Navigation**
- Collapsible left sidebar with icons + labels (Linear/ClickUp style), collapsible to icon-only
- Flat nav list: Kiosks, Locations, Settings — views (Table/Kanban/Gantt/Calendar) are tabs within the Kiosks page
- Default landing page after login: Kiosk table view (dashboard replaces this in Phase 5)
- Mobile/tablet: sidebar becomes hamburger menu overlay

**Role Permissions**
- Three roles: Admin, Member (full CRUD), Viewer (read-only)
- Admin is a distinct role, not a flag on other roles
- Member and Admin both have full CRUD on kiosks and locations
- Viewer can see everything except sensitive fields
- Sensitive fields = banking details + contract documents/values only (not maintenance fees or other financial fields)
- Sensitive field access: Admin + Member can see/edit; Viewer sees them as hidden/redacted
- Unauthorised controls: shown as disabled with tooltip explaining why (not hidden, not click-to-error)

**Database Schema (Pre-decided)**
- `kiosk_assignments` temporal join table for assignment history
- FLOAT8 for pipeline stage ordering positions
- Application-layer audit log with denormalized actor/entity names

### Claude's Discretion
- Loading skeleton and spinner design
- Exact spacing, typography scale, and component sizing
- Error state handling (toasts, inline errors, error pages)
- Session expiry redirect behaviour
- Sidebar animation and collapse behaviour
- Form validation approach

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can sign up and log in with email and password | Better Auth 1.5 email/password plugin; admin.createUser() for invite-only signup; disableSignUp prevents public registration |
| AUTH-02 | User session persists across browser refresh | Better Auth session config: expiresIn + updateAge; cookie-based session with 30-day sliding window |
| AUTH-03 | User can reset password via email link | Better Auth requestPasswordReset() + resetPassword() flow; sendResetPassword hook for email delivery |
| AUTH-04 | Admin can create and manage user accounts | Better Auth admin plugin: createUser(), listUsers(), setRole(), banUser() — ban replaces deletion |
| AUTH-05 | Sensitive fields (banking details, contracts) are restricted to authorized roles only | Better Auth access control plugin (createAccessControl + statements); server-side role checks before returning sensitive columns |
</phase_requirements>

---

## Summary

Phase 1 is a greenfield Next.js 16 project scaffold with Better Auth 1.5 providing authentication and RBAC, Drizzle ORM connected to Neon PostgreSQL for the database layer, and shadcn/ui on Tailwind v4 for the branded UI shell. All three technologies are actively maintained and well-documented with official integration guides.

The most important architectural decision already locked in is the **invite-only flow**: Better Auth's `emailAndPassword.disableSignUp: true` blocks public registration; the admin plugin's `createUser()` creates accounts programmatically; and Better Auth's password reset flow (`requestPasswordReset` + `resetPassword`) doubles as the "set your initial password" flow when the admin creates the account without a password, then triggers a reset link. This pattern is the recommended community workaround for invite-only + no-org-plugin flows in Better Auth 1.5.

The full database schema must be laid down in Plan 01-03 to be stable for downstream phases. Better Auth generates its own core tables (user, session, account, verification) — application tables (kiosks, locations, kiosk_assignments, pipeline_stages, audit_logs, user_views) are Drizzle schema-defined alongside them.

**Primary recommendation:** Scaffold with `create-next-app@latest`, integrate Better Auth 1.5 with the admin plugin and access control plugin, use Drizzle with the `@neondatabase/serverless` driver for Neon, and configure shadcn/ui with CSS variable overrides that map WeKnow brand tokens.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.x (latest) | Framework, routing, SSR | Locked decision; v16 is stable as of Oct 2025, Turbopack default |
| react / react-dom | 19.x | UI rendering | Bundled with Next.js 16 |
| better-auth | 1.5.x | Auth, session, RBAC | Locked decision; actively maintained, Drizzle adapter included |
| drizzle-orm | latest (^0.39+) | ORM, type-safe queries | Locked decision; pairs natively with Neon serverless driver |
| drizzle-kit | latest | Schema migrations, push | CLI tooling for schema management |
| @neondatabase/serverless | latest | Neon PostgreSQL driver | Serverless-optimised HTTP/WS PostgreSQL driver |
| tailwindcss | 4.x | Utility CSS | Locked decision; CSS-first config, no tailwind.config.js |
| @tailwindcss/postcss | 4.x | PostCSS plugin for v4 | Required for Tailwind v4 integration |
| shadcn/ui | latest CLI | Component library | Locked decision; copies components into project, full ownership |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @better-auth/drizzle-adapter | latest | Drizzle adapter (extracted in 1.5) | Required — adapters now in separate packages |
| lucide-react | latest | Icons (shadcn/ui default) | Used in sidebar, buttons, form icons |
| sonner | latest | Toast notifications | shadcn/ui 2025 default toast (replaces radix toast) |
| zod | latest | Schema validation | Form validation + server action input validation |
| react-hook-form | latest | Form state management | Pairs with zod resolver for auth forms |
| @hookform/resolvers | latest | Zod/form bridge | Required with react-hook-form + zod |
| nodemailer | latest | Email sending | Password reset + invite emails in development |
| @types/nodemailer | latest | TypeScript types | Dev dependency |
| dotenv | latest | Env loading in scripts | Required for drizzle.config.ts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Better Auth | Clerk, Auth.js | Better Auth is locked; Auth.js is security-only maintenance; Clerk is hosted paid |
| Drizzle ORM | Prisma | Drizzle is locked; Prisma adds schema.prisma indirection, less TypeScript-native |
| Neon PostgreSQL | Supabase, PlanetScale | Neon chosen for serverless PostgreSQL with Drizzle native support |
| shadcn/ui | MUI, Mantine | shadcn copies source; locked decision |
| Tailwind v4 | Tailwind v3 | v4 locked; CSS-first config, no JS config file needed |

**Installation:**

```bash
# Create project
npx create-next-app@latest kiosk-management --typescript --tailwind --app --src-dir --import-alias "@/*"

# Auth
npm install better-auth @better-auth/drizzle-adapter

# Database
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit dotenv

# UI
npx shadcn@latest init
npx shadcn@latest add sidebar button input label form card dropdown-menu tooltip badge avatar

# Forms + validation
npm install zod react-hook-form @hookform/resolvers

# Notifications
npm install sonner

# Email (dev/prod)
npm install nodemailer
npm install -D @types/nodemailer
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   ├── (auth)/              # Route group: unauthenticated pages
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── reset-password/
│   │   │   └── page.tsx
│   │   └── set-password/    # First-login password setup
│   │       └── page.tsx
│   ├── (app)/               # Route group: authenticated app shell
│   │   ├── layout.tsx       # App shell with sidebar
│   │   ├── kiosks/
│   │   │   └── page.tsx     # Default landing (table view + tabs)
│   │   ├── locations/
│   │   │   └── page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       └── users/
│   │           └── page.tsx # Settings > Users
│   ├── api/
│   │   └── auth/
│   │       └── [...all]/
│   │           └── route.ts # Better Auth catch-all handler
│   ├── layout.tsx
│   └── globals.css          # Tailwind v4 @theme + WeKnow tokens
├── db/
│   ├── index.ts             # Drizzle db instance
│   ├── schema.ts            # All table definitions
│   └── relations.ts         # Drizzle relation definitions
├── lib/
│   ├── auth.ts              # Better Auth server instance
│   ├── auth-client.ts       # Better Auth client instance
│   └── email.ts             # Email sending utilities
├── components/
│   ├── ui/                  # shadcn/ui components (auto-generated)
│   ├── layout/
│   │   ├── app-sidebar.tsx  # Main sidebar component
│   │   └── app-shell.tsx    # Layout wrapper
│   └── auth/
│       ├── login-form.tsx
│       ├── reset-password-form.tsx
│       └── set-password-form.tsx
└── proxy.ts                 # Next.js 16 proxy (replaces middleware.ts)
```

### Pattern 1: Better Auth Server Setup

**What:** Configure the auth instance with email/password, admin plugin, and access control plugin.
**When to use:** Single source of truth for all auth config. Import `auth` server-side only.

```typescript
// src/lib/auth.ts
// Source: https://better-auth.com/docs/installation
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { sendPasswordResetEmail, sendInviteEmail } from "@/lib/email";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // No public registration — admin-only
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,  // 30 days
    updateAge: 60 * 60 * 24,        // Refresh daily (sliding window)
  },
  plugins: [
    admin({
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    nextCookies(), // Must be last — handles Set-Cookie in Server Actions
  ],
});
```

### Pattern 2: Better Auth Client Setup

**What:** Client-side auth instance for React components and hooks.
**When to use:** Import from this file in Client Components for sign-in, sign-out, session access.

```typescript
// src/lib/auth-client.ts
// Source: https://better-auth.com/docs/integrations/next
import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export const { signIn, signOut, useSession, getSession } = authClient;
```

### Pattern 3: Next.js 16 Proxy (Route Protection)

**What:** `proxy.ts` replaces `middleware.ts` in Next.js 16. Runs on Node.js runtime, can call Better Auth.
**When to use:** Redirect unauthenticated users. Runs before every matched request.

```typescript
// src/proxy.ts
// Source: https://nextjs.org/blog/next-16#proxyts-formerly-middlewarets
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/reset-password") ||
    request.nextUrl.pathname.startsWith("/set-password");

  if (!session && !isAuthRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && isAuthRoute) {
    return NextResponse.redirect(new URL("/kiosks", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

### Pattern 4: API Route Handler

**What:** Mount Better Auth's handler on the Next.js catch-all route.
**When to use:** Required — all auth API calls go through this handler.

```typescript
// src/app/api/auth/[...all]/route.ts
// Source: https://better-auth.com/docs/integrations/next
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

### Pattern 5: Invite-Only Flow (Admin Creates User)

**What:** Admin creates a user account, then triggers password reset email as the "set initial password" flow.
**When to use:** The locked invite-only pattern. No public signup; Better Auth 1.5 admin plugin supports optional password on createUser.

```typescript
// In Settings > Users — Server Action
"use server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function inviteUser(email: string, role: "admin" | "member" | "viewer") {
  // 1. Create user account (no password required in Better Auth 1.5)
  const user = await auth.api.createUser({
    body: { email, role, name: "" }, // user fills name on first login
    headers: await headers(),
  });

  // 2. Send password reset email — this IS the invite email
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: "/set-password" },
    headers: await headers(),
  });
}
```

### Pattern 6: Drizzle Schema Definition

**What:** TypeScript-first table definitions. Better Auth generates its own tables; app tables defined alongside.
**When to use:** Single schema.ts file for all tables, imported by both Drizzle and Better Auth adapter.

```typescript
// src/db/schema.ts — application tables (excerpt)
// Source: https://orm.drizzle.team/docs/column-types/pg
import {
  pgTable, text, timestamp, boolean, doublePrecision,
  uuid, integer, jsonb
} from "drizzle-orm/pg-core";

// Better Auth generates: user, session, account, verification tables
// (run: npx auth@latest generate)

// Application tables:
export const kiosks = pgTable("kiosks", {
  id: uuid("id").primaryKey().defaultRandom(),
  kioskId: text("kiosk_id").notNull().unique(),
  // ... fields
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Temporal join table — assignment history
export const kioskAssignments = pgTable("kiosk_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  kioskId: uuid("kiosk_id").notNull().references(() => kiosks.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }), // null = current
  reason: text("reason"),
  assignedBy: uuid("assigned_by").notNull(), // denormalized from user
  assignedByName: text("assigned_by_name").notNull(), // denormalized
});

// Pipeline stages — FLOAT8 for position to avoid batch-update race conditions
export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  position: doublePrecision("position").notNull(), // FLOAT8
  color: text("color"),
  isDefault: boolean("is_default").default(false).notNull(),
});

// Audit log — append-only with denormalized actor/entity names
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull(),
  actorName: text("actor_name").notNull(),        // denormalized
  entityType: text("entity_type").notNull(),      // "kiosk" | "location" | "user"
  entityId: uuid("entity_id").notNull(),
  entityName: text("entity_name").notNull(),      // denormalized
  action: text("action").notNull(),               // "create" | "update" | "delete"
  field: text("field"),                           // null for create/delete
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### Pattern 7: Tailwind v4 with WeKnow Brand Tokens

**What:** CSS-first Tailwind v4 configuration with WeKnow design tokens as `@theme` variables.
**When to use:** globals.css is the single source of truth for design tokens — no tailwind.config.js needed.

```css
/* src/app/globals.css */
/* Source: https://ui.shadcn.com/docs/tailwind-v4 */
@import "tailwindcss";

@theme inline {
  /* WeKnow brand colours */
  --color-wk-graphite: #121212;
  --color-wk-azure: #00A6D3;
  --color-wk-white: #FFFFFF;
  --color-wk-night-grey: #575A5C;
  --color-wk-mid-grey: #ADADAD;
  --color-wk-light-grey: #F4F4F4;
  --color-wk-sky-blue: #E5F1F9;
  --color-wk-sea-blue: #008BB2;
  --color-wk-night-blue: #0C2752;

  /* Azure tints */
  --color-wk-azure-80: rgba(0, 166, 211, 0.8);
  --color-wk-azure-60: rgba(0, 166, 211, 0.6);
  --color-wk-azure-40: rgba(0, 166, 211, 0.4);
  --color-wk-azure-20: rgba(0, 166, 211, 0.2);

  /* Typography */
  --font-sans: 'Circular Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* shadcn/ui CSS variables (semantic layer on top of brand tokens) */
:root {
  --background: var(--color-wk-white);
  --foreground: var(--color-wk-graphite);
  --primary: var(--color-wk-azure);
  --primary-foreground: var(--color-wk-white);
  --muted: var(--color-wk-light-grey);
  --muted-foreground: var(--color-wk-night-grey);
  --border: var(--color-wk-mid-grey);
  --sidebar-background: var(--color-wk-graphite);
  --sidebar-foreground: var(--color-wk-white);
  --sidebar-primary: var(--color-wk-azure);
  --sidebar-accent: rgba(0, 166, 211, 0.15);
}
```

### Pattern 8: shadcn/ui Sidebar with Collapse-to-Icon

**What:** shadcn/ui Sidebar component with `collapsible="icon"` for Linear/ClickUp-style sidebar.
**When to use:** App shell layout component wrapping all authenticated routes.

```tsx
// src/components/layout/app-sidebar.tsx
// Source: https://ui.shadcn.com/docs/components/radix/sidebar
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger, useSidebar
} from "@/components/ui/sidebar";
import { LayoutGrid, MapPin, Settings } from "lucide-react";

const navItems = [
  { title: "Kiosks", href: "/kiosks", icon: LayoutGrid },
  { title: "Locations", href: "/locations", icon: MapPin },
  { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <a href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

### Anti-Patterns to Avoid

- **Using `middleware.ts` in Next.js 16:** It is deprecated. Use `proxy.ts` with `export function proxy()`.
- **Calling Better Auth from Edge Runtime:** Better Auth requires Node.js runtime. `proxy.ts` runs on Node.js by default in Next.js 16.
- **Storing sensitive session data in localStorage:** Better Auth uses HttpOnly cookies. Never touch session tokens client-side.
- **Building custom role checking logic:** Use Better Auth's access control plugin — hand-rolling RBAC is a maintenance burden.
- **Using `drizzle-kit push` in production:** Use `drizzle-kit generate` + `drizzle-kit migrate` for tracked migrations. Push is for prototyping only.
- **Defining `tailwind.config.js` with v4:** Tailwind v4 is CSS-first — all config lives in `globals.css` via `@theme`.
- **Importing `auth` in Client Components:** The Better Auth server instance must only run server-side. Use `authClient` on the client.
- **Nesting application tables inside Better Auth schema generation:** Run `npx auth@latest generate` for auth tables, then add application tables manually in `schema.ts`. Merge both into one Drizzle schema file.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session management | Custom JWT handling | Better Auth session plugin | Cookie rotation, sliding window, revocation are non-trivial |
| Password hashing | bcrypt calls | Better Auth built-in | Argon2/scrypt selection, timing attack prevention |
| CSRF protection | Custom token validation | Better Auth built-in | Session-based CSRF handled automatically |
| Email token generation | UUID + DB expiry | Better Auth verification tokens | Timing-safe comparison, expiry, single-use enforcement |
| Role permission checks | if/else role strings | Better Auth access control plugin | Centralised, type-safe, survives refactors |
| Form validation | Manual regex | Zod + react-hook-form | Type inference, async validation, error mapping |
| Toast/notification system | CSS + state | Sonner (shadcn default) | Accessible, stacked, auto-dismiss |
| Sidebar collapse state | useState + localStorage | SidebarProvider (shadcn) | Cookie-persisted state, mobile handling, ARIA |
| Database migrations | SQL files | drizzle-kit generate/migrate | Schema diffing, rollback tracking |

**Key insight:** Auth primitives (tokens, hashing, sessions) have security edge cases that take months to discover. Better Auth's 600+ commits in v1.5 represent that hard-won knowledge.

---

## Common Pitfalls

### Pitfall 1: middleware.ts vs proxy.ts in Next.js 16

**What goes wrong:** Developers use `middleware.ts` which is deprecated in Next.js 16 and will be removed. It runs on Edge runtime which cannot use Node.js APIs (no database calls).
**Why it happens:** All Next.js documentation prior to 2025 uses `middleware.ts`.
**How to avoid:** Use `proxy.ts` with `export function proxy()`. It runs on Node.js runtime and can call `auth.api.getSession()` directly.
**Warning signs:** Build warnings about deprecated middleware filename; database calls failing in middleware.

### Pitfall 2: Better Auth Session Not Refreshing in RSC

**What goes wrong:** Server Components read a stale session cookie that doesn't get refreshed because RSCs cannot set cookies.
**Why it happens:** Better Auth's sliding window requires a cookie write, which RSCs cannot do.
**How to avoid:** Use the `nextCookies()` plugin (place last in plugins array). It ensures cookie refresh happens via Server Actions and Route Handlers. Do not rely on RSC-only session reads for auth gates that need fresh session data.
**Warning signs:** Users getting logged out despite activity; session not refreshing.

### Pitfall 3: Better Auth Drizzle Adapter Schema Mismatch

**What goes wrong:** Better Auth CLI generates its schema; developer also defines tables manually. Columns get out of sync when plugins are added (e.g., admin plugin adds `role`, `banned` columns to user table).
**Why it happens:** Admin plugin adds columns at runtime; if schema doesn't include them, Drizzle queries fail.
**How to avoid:** Run `npx auth@latest generate` after adding each Better Auth plugin. Then copy generated columns into your `schema.ts`. Do NOT maintain two separate schema sources.
**Warning signs:** TypeScript errors on user object; missing column database errors.

### Pitfall 4: Invite Flow — createUser Without Password

**What goes wrong:** Pre-1.5 Better Auth required a password on `createUser`. Calling it without fails.
**Why it happens:** Better Auth 1.5 added optional password support; older examples show required password.
**How to avoid:** Use Better Auth 1.5.x (confirmed current). Use `createUser` then immediately call `requestPasswordReset` — the reset link IS the invite link. Customise the reset email copy to say "Set your password" rather than "Reset your password".
**Warning signs:** 400 error on createUser with no password; check Better Auth version.

### Pitfall 5: Tailwind v4 Breaking shadcn/ui Components

**What goes wrong:** Some shadcn/ui components installed via older CLI have v3-style config. OKLCH color conversion changes colours.
**Why it happens:** Tailwind v4 converts HSL colours to OKLCH internally. The `hsl()` wrapper must be removed from CSS variable references.
**How to avoid:** Use `npx shadcn@latest init` (not `npx shadcn-ui@latest`) which now defaults to Tailwind v4. Remove any `hsl()` wrappers from CSS variables in `globals.css`. Use `@theme inline` not `@theme`.
**Warning signs:** Colours look slightly off or washed out; CSS variable parsing errors in console.

### Pitfall 6: Neon Serverless Driver in Development vs Production

**What goes wrong:** `neon-http` driver fails locally when the Neon database is unreachable or when using the wrong import.
**Why it happens:** Neon offers two drivers: `neon-http` (HTTP-based, no WebSocket) and `neon-serverless` (WebSocket). Serverless/edge environments need http; local dev benefits from postgres pooling.
**How to avoid:** Use `drizzle-orm/neon-http` consistently. Add `.env.local` with `DATABASE_URL` pointing to a Neon branch (use Neon's branch feature for dev/prod separation). Do not use `pg` driver with Neon.
**Warning signs:** `ECONNREFUSED` on localhost; WebSocket connection errors in Vercel edge.

### Pitfall 7: FLOAT8 Position Gaps for Pipeline Stage Reordering

**What goes wrong:** Using integer positions (1, 2, 3) causes batch UPDATE race conditions when reordering stages — all rows need renumbering.
**Why it happens:** Adjacent integer positions have no room for insertion without renumbering.
**How to avoid:** Use `doublePrecision` (FLOAT8) as pre-decided. Insert between two stages by averaging their positions: `(stageA.position + stageB.position) / 2`. The binary fraction always has space until floating-point precision is exhausted (very rare; can renumber lazily).
**Warning signs:** Concurrent reorder requests causing inconsistent stage ordering.

---

## Code Examples

### Drizzle Config

```typescript
// drizzle.config.ts — project root
// Source: https://orm.drizzle.team/docs/tutorials/drizzle-nextjs-neon
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Drizzle DB Instance with Neon

```typescript
// src/db/index.ts
// Source: https://orm.drizzle.team/docs/tutorials/drizzle-nextjs-neon
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });
```

### Session Access in Server Component

```typescript
// src/app/(app)/layout.tsx
// Source: https://better-auth.com/docs/integrations/next
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar />
      <main>{children}</main>
    </SidebarProvider>
  );
}
```

### Role-Based Access Check (Server Action)

```typescript
// Role check pattern for sensitive fields
// Source: adapted from Better Auth admin plugin docs
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getLocationWithSensitiveFields(locationId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });

  // Redact sensitive fields for Viewer role
  if (session.user.role === "viewer") {
    return {
      ...location,
      bankingDetails: null,      // redacted
      contractValue: null,        // redacted
      contractDocuments: null,    // redacted
    };
  }

  return location;
}
```

### Migration Commands

```bash
# Generate Better Auth schema (run after changing plugins)
npx auth@latest generate

# Generate Drizzle migration from schema changes
npx drizzle-kit generate

# Apply migrations to database
npx drizzle-kit migrate

# Development only: push schema directly (no migration file)
npx drizzle-kit push
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` | Next.js 16 (Oct 2025) | Rename file, rename export — must use for Node.js runtime |
| `tailwind.config.js` | CSS `@theme` in globals.css | Tailwind v4 (2024) | All token definitions move to CSS |
| `import { drizzleAdapter } from "better-auth/adapters/drizzle"` | `import { drizzleAdapter } from "@better-auth/drizzle-adapter"` | Better Auth 1.5 (Feb 2026) | Adapter extracted; main package re-exports for backward compat |
| `npx shadcn-ui@latest` | `npx shadcn@latest` | shadcn CLI update (2024) | New CLI name; v4 support, new-york style default |
| Implicit Next.js caching | Opt-in `"use cache"` directive | Next.js 16 | All routes dynamic by default; explicit caching required |
| `experimental.ppr` config flag | `cacheComponents: true` | Next.js 16 | PPR concept evolved into Cache Components |

**Deprecated/outdated:**
- `middleware.ts` export: deprecated in Next.js 16, will be removed in a future version. Use `proxy.ts`.
- Auth.js (NextAuth): security-only maintenance mode since 2024. Do not use for new projects.
- Lucia Auth: deprecated since late 2023.
- `@better-auth/cli` package: deprecated in v1.5; use `npx auth@latest` instead.

---

## Open Questions

1. **Circular Pro font availability**
   - What we know: Circular Pro is the mandated WeKnow font per brand guidelines
   - What's unclear: Whether a web font file (WOFF2) is available for the project or if a system font fallback must be used for the internal tool
   - Recommendation: Request font files from WeKnow (Louise Vineeta). For Phase 1 scaffold, use CSS fallback stack. Self-host WOFF2 via `@font-face` in globals.css when files are available — do not use Google Fonts (Circular Pro is not available there).

2. **Email provider for password reset / invite emails**
   - What we know: Better Auth requires a `sendResetPassword` function to be implemented
   - What's unclear: Which email provider (Resend, Postmark, SMTP) is available for this WeKnow project
   - Recommendation: Implement with Nodemailer for development (local SMTP / Mailtrap). Wrap in an `email.ts` service layer so the provider can be swapped. For production, Resend is the 2025/2026 standard for Next.js projects.

3. **Neon database branch setup**
   - What we know: Neon supports branch-per-environment (main = prod, dev branches)
   - What's unclear: Whether a Neon project already exists or needs to be created
   - Recommendation: Create Neon project, create `dev` branch, set `DATABASE_URL` in `.env.local`. Use main branch for production.

---

## Validation Architecture

> nyquist_validation is enabled in .planning/config.json.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (latest) |
| Config file | `playwright.config.ts` — Wave 0 creation required |
| Quick run command | `npx playwright test --grep @smoke` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Admin can sign in with email and password | E2E | `npx playwright test tests/auth/login.spec.ts` | ❌ Wave 0 |
| AUTH-01 | Login form shows validation errors for invalid input | E2E | `npx playwright test tests/auth/login.spec.ts` | ❌ Wave 0 |
| AUTH-01 | Public signup is blocked (disableSignUp) | E2E | `npx playwright test tests/auth/signup-blocked.spec.ts` | ❌ Wave 0 |
| AUTH-02 | Session persists after browser refresh | E2E | `npx playwright test tests/auth/session-persistence.spec.ts` | ❌ Wave 0 |
| AUTH-03 | Password reset email is triggered | E2E (smoke) | `npx playwright test tests/auth/password-reset.spec.ts` | ❌ Wave 0 |
| AUTH-03 | User can set new password via reset link | E2E | `npx playwright test tests/auth/password-reset.spec.ts` | ❌ Wave 0 |
| AUTH-04 | Admin can invite (create) a user from Settings > Users | E2E | `npx playwright test tests/admin/invite-user.spec.ts` | ❌ Wave 0 |
| AUTH-04 | Admin can change a user's role | E2E | `npx playwright test tests/admin/change-role.spec.ts` | ❌ Wave 0 |
| AUTH-04 | Admin can deactivate (ban) a user | E2E | `npx playwright test tests/admin/deactivate-user.spec.ts` | ❌ Wave 0 |
| AUTH-05 | Viewer cannot see banking/contract fields | E2E | `npx playwright test tests/rbac/sensitive-fields.spec.ts` | ❌ Wave 0 |
| AUTH-05 | Viewer sees disabled controls with tooltip | E2E | `npx playwright test tests/rbac/viewer-controls.spec.ts` | ❌ Wave 0 |
| AUTH-05 | Member can see sensitive fields | E2E | `npx playwright test tests/rbac/sensitive-fields.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test --grep @smoke` (login + session persistence)
- **Per wave merge:** `npx playwright test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `playwright.config.ts` — configure baseURL, webServer, screenshot on failure, storageState for auth
- [ ] `tests/auth/login.spec.ts` — covers AUTH-01
- [ ] `tests/auth/signup-blocked.spec.ts` — covers AUTH-01 (invite-only enforcement)
- [ ] `tests/auth/session-persistence.spec.ts` — covers AUTH-02
- [ ] `tests/auth/password-reset.spec.ts` — covers AUTH-03
- [ ] `tests/admin/invite-user.spec.ts` — covers AUTH-04
- [ ] `tests/admin/change-role.spec.ts` — covers AUTH-04
- [ ] `tests/admin/deactivate-user.spec.ts` — covers AUTH-04
- [ ] `tests/rbac/sensitive-fields.spec.ts` — covers AUTH-05
- [ ] `tests/rbac/viewer-controls.spec.ts` — covers AUTH-05
- [ ] `tests/auth/setup.ts` — shared auth state setup (save logged-in state for reuse)
- [ ] Framework install: `npm init playwright@latest` if not already configured

---

## Sources

### Primary (HIGH confidence)

- [better-auth.com/docs/installation](https://better-auth.com/docs/installation) — installation, email/password config, session options
- [better-auth.com/docs/integrations/next](https://better-auth.com/docs/integrations/next) — Next.js App Router integration, proxy pattern, RSC session access
- [better-auth.com/docs/plugins/admin](https://better-auth.com/docs/plugins/admin) — admin plugin createUser, listUsers, setRole, banUser
- [better-auth.com/docs/adapters/drizzle](https://better-auth.com/docs/adapters/drizzle) — Drizzle adapter setup, schema generation
- [better-auth.com/docs/reference/options](https://better-auth.com/docs/reference/options) — session expiresIn, updateAge, disableSignUp
- [better-auth.com/blog/1-5](https://better-auth.com/blog/1-5) — Better Auth 1.5 release notes (Feb 2026), adapter extraction, optional password on createUser
- [nextjs.org/blog/next-16](https://nextjs.org/blog/next-16) — Next.js 16 release (Oct 2025), proxy.ts, breaking changes, turbopack default
- [orm.drizzle.team/docs/tutorials/drizzle-nextjs-neon](https://orm.drizzle.team/docs/tutorials/drizzle-nextjs-neon) — Drizzle + Neon installation, drizzle.config.ts, migration commands
- [orm.drizzle.team/docs/column-types/pg](https://orm.drizzle.team/docs/column-types/pg) — PostgreSQL column type API (timestamp, uuid, doublePrecision, jsonb)
- [ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4) — Tailwind v4 + shadcn/ui integration, @theme inline, CSS variables
- [ui.shadcn.com/docs/components/radix/sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) — Sidebar component, collapsible="icon", mobile behavior

### Secondary (MEDIUM confidence)

- [npmjs.com/package/better-auth](https://www.npmjs.com/package/better-auth) — confirmed v1.5.5 is current latest (as of research date)
- [nextjs.org/blog/next-15-5](https://nextjs.org/blog/next-15-5) — Node.js middleware stable (pre-Next.js 16 reference)
- [github.com/better-auth/better-auth — issue #4226](https://github.com/better-auth/better-auth/issues/4226) — admin plugin createUser without password: confirmed supported in 1.5

### Tertiary (LOW confidence)

- Community workaround for invite flow (createUser + requestPasswordReset as invite): confirmed in multiple GitHub discussions but no official Better Auth documentation entry for this exact pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — official docs and npm registry confirmed versions
- Architecture: HIGH — derived directly from official Next.js 16 and Better Auth 1.5 docs
- Invite-only pattern: MEDIUM — supported in 1.5, community-confirmed workaround, no official how-to page
- Pitfalls: HIGH — verified against official release notes and breaking changes
- Tailwind v4 / shadcn: HIGH — official shadcn docs explicitly cover v4 setup

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days; stable stack, but Better Auth releases frequently — re-check if planning delays)
