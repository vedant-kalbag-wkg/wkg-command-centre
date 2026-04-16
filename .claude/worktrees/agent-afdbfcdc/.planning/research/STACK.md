# Stack Research

**Domain:** Internal asset/kiosk management platform — data-heavy CRUD with multi-view (table, kanban, Gantt, calendar), RBAC, audit logging, reporting dashboards, Monday.com data migration
**Researched:** 2026-03-18
**Confidence:** MEDIUM-HIGH (most choices verified via official docs and multiple sources; specific version pins verified where possible)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.x (stable Oct 2025) | Full-stack React framework | App Router, Server Components, Server Actions, Turbopack default, built-in caching — eliminates need for a separate API server. Vercel-native. Most mature React metaframework for internal tools. |
| React | 19.2 | UI runtime | Required by Next.js 16 App Router; React Compiler (stable in 16) auto-memoises components, critical for large table/Gantt renders. |
| TypeScript | 5.x | Type safety | End-to-end type safety across DB schema → ORM → server actions → client components. Non-negotiable for a multi-team internal tool. |
| Tailwind CSS | 4.x | Utility-first styling | CSS-first config (`@theme` directive), Turbopack-compatible, CSS variables for We Know Group brand tokens. shadcn/ui v4 targets Tailwind 4. |
| shadcn/ui | CLI v4 (March 2026) | Component library | Copy-paste ownership model — components live in your codebase, fully overridable for Circular Pro font and WeKnow brand palette. No locked-in design system. Active development, Tailwind v4 + React 19 updated. |
| Drizzle ORM | 0.45.x (stable) | Database ORM | TypeScript-native schema-as-code, ~90% smaller bundle than Prisma, no Rust binary (critical for Vercel edge/serverless cold starts), raw SQL escape hatch for complex audit queries. Recommended for new projects in 2026. |
| PostgreSQL | 16.x | Primary database | ACID compliance, JSONB for flexible kiosk config fields, array types, strong trigger support for audit logging, supported by every managed host. |
| Neon (serverless PostgreSQL) | managed | Database host | Serverless Postgres with scale-to-zero (cost-efficient for internal tool traffic patterns), database branching for preview deployments, Vercel-native integration, acquired by Databricks with price cuts in 2025. |
| Better Auth | 1.5.x | Authentication + RBAC | Specifically recommended for new Next.js projects in 2026 (Auth.js team joined Better Auth; Lucia deprecated March 2025). Built-in RBAC via `createAccessControl`, Organization plugin supports custom roles, `hasPermission` server-side checks. Email/password without SSO complexity. |
| TanStack Query | 5.x | Server state management | Caching, background refetch, pagination for table/list views. Pairs with Drizzle server actions. Does NOT replace Zustand — handles async/server state only. |
| Zustand | 5.x | Client/UI state | Lightweight global client state: active view mode, filter state, column visibility, kanban drag state. Minimal boilerplate, works cleanly with Next.js hydration. |

### View Libraries

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| TanStack Table | 8.21.x (stable; v9 alpha) | Data grid / table view | Headless — gives full control over markup and styling for WeKnow brand. ~30KB real-world, React virtualization via TanStack Virtual for 1,000+ row datasets. Sorting, filtering, grouping, column visibility, multi-select built-in. |
| @svar-ui/react-gantt | 2.4.x | Gantt chart view | MIT-licensed, React 19 compatible, TypeScript, drag-and-drop timeline, task dependencies, customizable grid columns. The only credible open-source React-native Gantt library in 2026 (Bryntum/DHTMLX are paid). |
| react-big-calendar | 1.19.x | Calendar view | MIT-licensed, React-specific (not a wrapper), monthly/weekly/agenda views, drag-and-drop event support. More customisable than FullCalendar (no vendor lock-in or premium plugin costs). |
| dnd-kit | 6.x | Kanban drag-and-drop | Industry standard replacement for deprecated react-beautiful-dnd. Accessible, modular, TypeScript-native. Used across all reference kanban implementations with shadcn/ui + Tailwind. |

### Reporting & Charting

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| Recharts | 2.x | Reporting dashboard charts | SVG-based, Composable React API, excellent for time-series (kiosks live per month, activations). "Right at home in an admin panel" per community consensus. Smaller than Nivo, easier to theme with CSS variables. |

### Forms & Validation

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| React Hook Form | 7.x | Form state management | Uncontrolled inputs = high performance with complex forms (bulk edit, kiosk detail). Minimal re-renders. |
| Zod | 3.x | Schema validation | TypeScript-first, pairs with React Hook Form via `zodResolver`, reuse schemas between server actions and client forms for end-to-end type safety. |

### File Handling

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| AWS SDK v3 (`@aws-sdk/client-s3`) | 3.x | Contract/document file storage | Presigned URL upload pattern: client uploads direct to S3, bypasses 4.5MB Vercel payload limit, no file data touches Next.js server. 5GB limit per upload. |
| react-dropzone | 14.x | File upload UI | Accessible drag-and-drop file input, pairs with presigned URL pattern. |

### Data Migration

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `@mondaydotcomorg/api` | latest | Monday.com API client | Official SDK wrapping GraphQL API v2025-04. Node.js + browser compatible. Used for board/item exploration and data migration script. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Turbopack | Build & HMR | Default bundler in Next.js 16; 5-10x faster dev HMR than Webpack |
| ESLint (flat config) | Linting | Next.js 16 ships with ESLint 9 flat config by default |
| Prettier | Formatting | Standard — configure with Tailwind plugin for class sorting |
| Playwright | E2E testing | Per project mandate; `npx playwright test` headless |
| Vitest | Unit/integration testing | Fast, Vite-native, works with Next.js via `@vitejs/plugin-react` |
| drizzle-kit | DB migrations | CLI companion to Drizzle ORM: `drizzle-kit generate`, `drizzle-kit migrate` |

---

## Installation

```bash
# Scaffold Next.js 16 with App Router, TypeScript, Tailwind v4, Turbopack
npx create-next-app@latest kiosk-management \
  --typescript --tailwind --app --turbopack

# ORM and database
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit

# Auth
npm install better-auth

# State management
npm install @tanstack/react-query zustand

# UI components (shadcn CLI — adds components individually)
npx shadcn@latest init

# Table
npm install @tanstack/react-table @tanstack/react-virtual

# Gantt
npm install @svar-ui/react-gantt

# Calendar
npm install react-big-calendar date-fns

# Kanban drag-and-drop
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Charts
npm install recharts

# Forms and validation
npm install react-hook-form zod @hookform/resolvers

# File uploads
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner react-dropzone

# Monday.com migration
npm install @mondaydotcomorg/api

# Dev dependencies
npm install -D vitest @vitejs/plugin-react @playwright/test
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Next.js 16 | Remix / SvelteKit | If the team has strong Remix experience and doesn't need Vercel-native features. Not recommended here — Next.js has the richest ecosystem for the required view types. |
| Drizzle ORM | Prisma 7 | Prisma 7 eliminated the Rust binary (its main weakness), so it's now viable. Choose Prisma if your team writes almost no SQL and prefers schema-file DX over TypeScript-as-schema. Both are production-grade. |
| Better Auth | Clerk | Clerk is excellent for B2B multi-tenant with org hierarchies. Overkill and expensive for a fixed 30-user internal tool with 3 roles. |
| Better Auth | Auth.js v5 | Auth.js receives only security patches — Auth.js dev team moved to Better Auth. Only choose Auth.js if you need an exotic OAuth provider not yet in Better Auth. |
| TanStack Table | AG Grid Community | AG Grid has more built-in features (grouping row UI, Excel export out-of-the-box) but ~200KB+ bundle and "configure-not-compose" approach fights with WeKnow brand customisation. TanStack Table + shadcn/ui gives full style control at lower cost. |
| @svar-ui/react-gantt | Bryntum Gantt | Bryntum is the gold standard for enterprise Gantt but commercial license starts at $999/dev. SVAR's free edition covers all requirements here. |
| react-big-calendar | FullCalendar | FullCalendar's premium plugins (timeline, resource management) require a commercial license. react-big-calendar covers month/week/day/agenda views free under MIT. |
| Neon | Supabase | Supabase is a good choice if you want built-in auth, realtime, and storage as a unified BaaS. Here, Better Auth handles auth and S3 handles storage separately — Neon as a pure Postgres host avoids vendor lock-in on application logic. |
| Neon | AWS RDS PostgreSQL | RDS is always-on billing with no scale-to-zero. For a 30-user internal tool, Neon's usage-based pricing is significantly cheaper. |
| Recharts | Nivo | Nivo produces more visually striking charts but has a heavier dependency tree. Recharts is simpler to theme for WeKnow brand tokens with CSS variables. |
| dnd-kit | react-beautiful-dnd | react-beautiful-dnd is unmaintained since 2022. dnd-kit is the community consensus replacement. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Lucia Auth | Officially deprecated March 2025. No longer maintained. | Better Auth |
| Auth.js (NextAuth) for new projects | Development team migrated to Better Auth (announced late 2025). Auth.js now on security-only maintenance mode. | Better Auth |
| react-beautiful-dnd | Unmaintained since 2022; known accessibility issues in React 18+ concurrent mode. | dnd-kit |
| Redux / Redux Toolkit | Extreme boilerplate for an internal tool. Overkill when Zustand (client state) + TanStack Query (server state) covers all use cases cleanly. | Zustand + TanStack Query |
| Prisma + Vercel Edge Runtime | Prisma 7 fixed the Rust binary issue but its query engine still doesn't run on Vercel Edge Functions. Use Neon's serverless driver directly or Drizzle if edge routes are needed. | Drizzle ORM |
| Next.js Pages Router | Legacy routing system. No Server Components, no native Server Actions, no Turbopack build. All new Next.js development in 2026 uses App Router. | Next.js App Router |
| moment.js | Deprecated, huge bundle (~70KB). | date-fns (used by react-big-calendar) |
| Bryntum / DHTMLX Gantt | Proprietary commercial license, not aligned with internal tool budget. | @svar-ui/react-gantt (MIT) |

---

## Stack Patterns by Variant

**For the Gantt view (deployment planning):**
- Use `@svar-ui/react-gantt` with task types mapped to lifecycle stages
- Store timeline data (start/end dates, dependencies) in Postgres — avoid storing in the Gantt library's format
- Sync Gantt mutations back through Drizzle server actions with optimistic updates via TanStack Query

**For the Kanban view (pipeline drag-and-drop):**
- Use dnd-kit `DndContext` + `SortableContext` for multi-column drag
- Render kiosk cards as shadcn/ui `Card` components inside each column
- Status column ordering stored in DB (configurable pipeline feature) — fetch with TanStack Query, update via server action on drop

**For bulk table editing:**
- TanStack Table row selection + controlled input cells
- Collect changed cells in Zustand store
- Single "Save changes" server action batch-updates all dirty rows in a DB transaction

**For audit logging:**
- Application-level audit log in Postgres (not DB triggers) for better context capture (user ID, request metadata)
- Drizzle middleware or a custom wrapper around mutations that writes to an `audit_log` table
- `audit_log` columns: `id`, `entity_type`, `entity_id`, `user_id`, `action` (CREATE/UPDATE/DELETE), `before_json` JSONB, `after_json` JSONB, `created_at`

**For the Monday.com migration script:**
- One-off Node.js script (not part of the app) using `@mondaydotcomorg/api`
- API version: 2025-04 (current) — all queries in request body, variables as JSON object
- Run locally against staging Neon branch before production import

**For WeKnow brand in Tailwind v4:**
```css
/* app/globals.css */
@import "tailwindcss";

@theme inline {
  --color-azure: #00A6D3;
  --color-graphite: #121212;
  --color-azure-80: color-mix(in srgb, #00A6D3 80%, white);
  --color-azure-60: color-mix(in srgb, #00A6D3 60%, white);
  --color-azure-40: color-mix(in srgb, #00A6D3 40%, white);
  --color-azure-20: color-mix(in srgb, #00A6D3 20%, white);
  --font-sans: "Circular Pro", system-ui, sans-serif;
}
```
- Use `font-sans` class for Circular Pro throughout; self-host via `next/font/local`
- shadcn/ui component tokens override in `:root` to map to WeKnow palette

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Next.js 16.x | React 19.2, Tailwind 4.x, shadcn/ui CLI v4 | All aligned for March 2026. shadcn CLI v4 officially targets Next.js 16. |
| Drizzle 0.45.x | @neondatabase/serverless, Next.js 16 | Neon's `neon()` HTTP driver used instead of `pg` pool for serverless/edge compatibility |
| Better Auth 1.5.x | Next.js 16 App Router, Drizzle | Better Auth has a Drizzle adapter — schema auto-generated via `better-auth generate` |
| TanStack Table 8.21.x | React 19 | v9 is alpha-only; use stable v8 for production |
| @svar-ui/react-gantt 2.4.x | React 19 | Explicitly tested against React 19 per SVAR release notes |
| react-big-calendar 1.19.x | React 18/19 | date-fns used as localizer (already a project dependency) |
| Tailwind v4 | shadcn/ui CLI v4 | `tailwindcss-animate` replaced by `tw-animate-css` in new installs |
| dnd-kit 6.x | React 19 | No known React 19 breaking changes; widely used with shadcn/ui Kanban examples |

---

## Sources

- [Next.js 16 official release post](https://nextjs.org/blog/next-16) — confirmed Turbopack stable default, React 19.2, React Compiler stable (HIGH confidence)
- [shadcn/ui changelog](https://ui.shadcn.com/docs/changelog) — confirmed CLI v4, Tailwind v4 + React 19 support (HIGH confidence)
- [Better Auth 1.4 blog](https://better-auth.com/blog/1-4) + [Organization plugin docs](https://better-auth.com/docs/plugins/organization) — confirmed RBAC, v1.5.5 on npm (HIGH confidence)
- [Better Auth vs Auth.js comparison — Wisp CMS](https://www.wisp.blog/blog/authjs-vs-betterauth-for-nextjs-a-comprehensive-comparison) — confirmed Auth.js team joined Better Auth (MEDIUM confidence — secondary source)
- [Drizzle vs Prisma — Makerkit](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma) — confirmed v0.45.x stable, v1 beta (MEDIUM confidence)
- [drizzle-orm npm](https://www.npmjs.com/package/drizzle-orm) — v0.45.1 stable (HIGH confidence)
- [TanStack Table docs](https://tanstack.com/table/latest) + GitHub releases — v8.21.3 stable, v9 alpha (HIGH confidence)
- [TanStack Table vs AG Grid 2025 — Simple Table](https://www.simple-table.com/blog/tanstack-table-vs-ag-grid-comparison) — bundle and licensing comparison (MEDIUM confidence)
- [SVAR React Gantt v2.4 release post](https://svar.dev/blog/react-gantt-pro-2-4-released/) — MIT license confirmed, React 19 support (HIGH confidence)
- [react-big-calendar npm](https://www.npmjs.com/package/react-big-calendar) — v1.19.4 stable (HIGH confidence)
- [FullCalendar vs react-big-calendar — Bryntum](https://bryntum.com/blog/react-fullcalendar-vs-big-calendar/) — licensing and feature comparison (MEDIUM confidence)
- [dnd-kit kanban recommendations — LogRocket](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) — community standard for React kanban (MEDIUM confidence)
- [Best React chart libraries 2025 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2025/) — Recharts for admin panel dashboards (MEDIUM confidence)
- [Neon vs Supabase — Bytebase](https://www.bytebase.com/blog/neon-vs-supabase/) — pricing and architecture comparison (MEDIUM confidence)
- [Neon pricing post-Databricks acquisition](https://neon.com/blog/new-usage-based-pricing) — confirmed price cuts, serverless model (HIGH confidence)
- [Monday.com API 2025-04 migration guide](https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04) — confirmed GraphQL v2025-04, `@mondaydotcomorg/api` SDK (HIGH confidence)
- [Tailwind v4 + shadcn/ui — official shadcn docs](https://ui.shadcn.com/docs/tailwind-v4) — CSS-first config, `@theme` directive, `tw-animate-css` (HIGH confidence)
- [State management in 2025 — Makers Den](https://makersden.io/blog/react-state-management-in-2025) — Zustand for client state, TanStack Query for server state pattern (MEDIUM confidence)

---

*Stack research for: Kiosk Management Platform — internal asset management web application*
*Researched: 2026-03-18*
